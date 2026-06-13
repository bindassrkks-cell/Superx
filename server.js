const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// UPDATE THIS: Aapki GitHub key.json ka direct raw URL
// Format: https://raw.githubusercontent.com/username/repo/main/key.json
const GITHUB_RAW_JSON_URL = "https://raw.githubusercontent.com/bindassrkks-cell/CTX-SERVER/main/key.json";

// Key Matrix Database
let keyDatabase = new Map();
const activeTunnels = new Map();

// --- GITHUB MANUAL LOAD LOGIC ---

// Server start hote hi GitHub se manual wali key.json load karega
async function loadKeysFromGitHub() {
    try {
        console.log("🔄 Fetching key.json from GitHub Raw URL...");
        const response = await fetch(GITHUB_RAW_JSON_URL);

        if (response.status === 200) {
            const parsedKeys = await response.json();
            
            keyDatabase.clear();
            Object.keys(parsedKeys).forEach(key => {
                parsedKeys[key].createdAt = new Date(parsedKeys[key].createdAt);
                parsedKeys[key].expiresAt = new Date(parsedKeys[key].expiresAt);
                keyDatabase.set(key, parsedKeys[key]);
            });
            console.log(`✅ GitHub se ${keyDatabase.size} keys successfully load ho gayi hain.`);
        } else {
            console.error(`❌ GitHub se file nahi mili (Status: ${response.status}). Khali database ke sath start ho raha hai.`);
        }
    } catch (error) {
        console.error("❌ GitHub Load Error (Shayad URL galat hai ya file khali hai):", error);
    }
}

// Map database ko plain object me badalne ka helper (Frontend ko bhejne ke liye)
function getDatabaseAsObject() {
    const dataObject = {};
    keyDatabase.forEach((value, key) => {
        dataObject[key] = value;
    });
    return dataObject;
}

// --- HTTP ROUTING ENGINE ---

app.get('/webcam', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/key', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'key_manager.html'));
});

// API endpoint to generate new access tokens
app.post('/api/generate-key', (req, res) => {
    const { durationHours } = req.body;
    const hours = parseInt(durationHours) || 24;

    const newKey = "CTX-" + Math.random().toString(36).substring(2, 10).toUpperCase();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + (hours * 60 * 60 * 1000));

    keyDatabase.set(newKey, {
        createdAt: createdAt,
        expiresAt: expiresAt,
        connectedDevice: "NONE (NOT LINKED)",
        isActive: true
    });

    // Response me key ke sath-sath poora updated backup data bhi bhej rahe hain
    res.json({ 
        success: true, 
        key: newKey, 
        expiresAt: expiresAt,
        fullBackup: getDatabaseAsObject() // Ise copy karke GitHub par daalna hoga
    });
});

// API endpoint to fetch current status of all keys
app.get('/api/keys-status', (req, res) => {
    const statusArray = [];
    keyDatabase.forEach((value, key) => {
        statusArray.push({
            key: key,
            expiresAt: value.expiresAt,
            connectedDevice: value.connectedDevice,
            status: new Date() > value.expiresAt ? "EXPIRED" : (value.connectedDevice !== "NONE (NOT LINKED)" ? "ACTIVE_LOGIN" : "PENDING")
        });
    });
    res.json(statusArray);
});

// Extra endpoint: Frontend se direct raw backup text copy karne ke liye
app.get('/api/get-backup', (req, res) => {
    res.json(getDatabaseAsObject());
});


// --- CORE TELEMETRY SERVER ENGINE ---

const server = app.listen(PORT, async () => {
    console.log(`🚀 Core Secure Asset Manager deployed on port ${PORT}`);
    await loadKeysFromGitHub();
});

const wss = new WebSocketServer({ server });

setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.readyState === 1) ws.ping();
    });
}, 20000);

wss.on('connection', (ws) => {
    let clientType = null;
    let assignedKey = null;
    let deviceModel = null;

    ws.on('message', (message, isBinary) => {
        try {
            if (!isBinary) {
                const data = JSON.parse(message.toString());

                // 1. SAFE APP HANDSHAKE REGISTRATION WITH TOKEN VALIDATION
                if (data.type === 'register_app') {
                    const clientKey = data.authKey;
                    const modelInput = data.deviceModel ? data.deviceModel.toUpperCase() : "UNKNOWN";

                    if (keyDatabase.has(clientKey)) {
                        const keyRecord = keyDatabase.get(clientKey);
                        const isExpired = new Date() > keyRecord.expiresAt;

                        if (!isExpired && keyRecord.isActive) {
                            clientType = 'app';
                            assignedKey = clientKey;
                            deviceModel = modelInput;

                            keyRecord.connectedDevice = deviceModel;

                            if (!activeTunnels.has(assignedKey)) {
                                activeTunnels.set(assignedKey, { appSocket: ws, viewerSockets: new Set() });
                            } else {
                                activeTunnels.get(assignedKey).appSocket = ws;
                            }

                            console.log(`📱 Hardware Node Connected securely via token [${assignedKey}] -> ${deviceModel}`);

                            const tunnel = activeTunnels.get(assignedKey);
                            tunnel.viewerSockets.forEach(v => v.send(JSON.stringify({ status: "app_online" })));
                            return;
                        }
                    }

                    ws.send(JSON.stringify({ error: "AUTH_FAILED", message: "Invalid or Expired System Key Blocked." }));
                    ws.close();
                }

                // 2. DASHBOARD VIEW INTERFACE REGISTRATION
                if (data.type === 'register_viewer') {
                    const targetKey = data.authKey;
                    if (keyDatabase.has(targetKey)) {
                        clientType = 'viewer';
                        assignedKey = targetKey;

                        if (!activeTunnels.has(assignedKey)) {
                            activeTunnels.set(assignedKey, { appSocket: null, viewerSockets: new Set() });
                        }
                        activeTunnels.get(assignedKey).viewerSockets.add(ws);

                        const tunnel = activeTunnels.get(assignedKey);
                        const isLive = tunnel.appSocket && tunnel.appSocket.readyState === 1;

                        ws.send(JSON.stringify({ 
                            status: "connected", 
                            deviceState: isLive ? "ONLINE" : "OFFLINE" 
                        }));
                    } else {
                        ws.send(JSON.stringify({ status: "error", message: "Dashboard access denied: Invalid token structure." }));
                    }
                }

                // 3. REMOTE ADMINISTRATIVE COMMAND SWITCHBOARD
                if (data.type === 'control_cmd') {
                    if (clientType === 'viewer' && assignedKey) {
                        const tunnel = activeTunnels.get(assignedKey);
                        if (tunnel && tunnel.appSocket && tunnel.appSocket.readyState === 1) {
                            tunnel.appSocket.send(JSON.stringify({
                                action: data.action, 
                                cameraFacing: data.cameraFacing
                            }));
                        }
                    }
                }
            } 
            else {
                if (clientType === 'app' && assignedKey) {
                    const tunnel = activeTunnels.get(assignedKey);
                    if (tunnel && tunnel.viewerSockets.size > 0) {
                        tunnel.viewerSockets.forEach((viewerSocket) => {
                            if (viewerSocket.readyState === 1) {
                                viewerSocket.send(message); 
                            }
                        });
                    }
                }
            }
        } catch (error) {
            console.error("Pipeline Engine Frame Interruption:", error);
        }
    });

    ws.on('close', () => {
        if (clientType === 'app' && assignedKey) {
            const tunnel = activeTunnels.get(assignedKey);
            if (tunnel) {
                tunnel.viewerSockets.forEach(v => v.send(JSON.stringify({ status: "offline" })));
                tunnel.appSocket = null;
            }
            const keyRecord = keyDatabase.get(assignedKey);
            if(keyRecord) keyRecord.connectedDevice = "DISCONNECTED (STALE)";
        } else if (clientType === 'viewer' && assignedKey) {
            const tunnel = activeTunnels.get(assignedKey);
            if (tunnel) tunnel.viewerSockets.delete(ws);
        }
    });
});
