const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Environment Variables se dynamically values uthayega (Render dashboard se)
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; 
const GITHUB_REPO = process.env.GITHUB_REPO; 
const FILE_PATH = 'key.json';

// Key Matrix Database
const keyDatabase = new Map();
const activeTunnels = new Map();

// --- GITHUB PERSISTENT STORAGE LOGIC ---

// GitHub se keys load karne ka function (Server start hote hi chalega)
async function loadKeysFromGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_REPO) {
        console.log("⚠️ Render Config Vars me GITHUB_TOKEN ya GITHUB_REPO nahi mila! Running without persistence.");
        return;
    }

    try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'NodeJS-App'
            }
        });

        if (response.status === 200) {
            const data = await response.json();
            const content = Buffer.from(data.content, 'base64').toString('utf-8');
            const parsedKeys = JSON.parse(content);
            
            keyDatabase.clear();
            Object.keys(parsedKeys).forEach(key => {
                parsedKeys[key].createdAt = new Date(parsedKeys[key].createdAt);
                parsedKeys[key].expiresAt = new Date(parsedKeys[key].expiresAt);
                keyDatabase.set(key, parsedKeys[key]);
            });
            console.log(`✅ GitHub se ${keyDatabase.size} keys successfully load ho gayi hain.`);
        } else if (response.status === 404) {
            console.log("ℹ️ GitHub par key.json pehle se nahi mili. Nayi file agli key generate hote hi ban jayegi.");
        } else {
            console.error("❌ GitHub se data fetch karne me error aayi. Status:", response.status);
        }
    } catch (error) {
        console.error("❌ GitHub Load Error:", error);
    }
}

// GitHub par data save/sync karne ka function
async function saveKeysToGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_REPO) return;

    try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}`;
        
        // Map ko plain object me convert kar rahe hain JSON file ke liye
        const dataObject = {};
        keyDatabase.forEach((value, key) => {
            dataObject[key] = value;
        });

        const newContentBase64 = Buffer.from(JSON.stringify(dataObject, null, 2)).toString('base64');

        // File ka current SHA fetch karna zaroori hai update karne ke liye
        let sha = null;
        const checkRes = await fetch(url, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'NodeJS-App'
            }
        });
        
        if (checkRes.status === 200) {
            const fileData = await checkRes.json();
            sha = fileData.sha;
        }

        // GitHub Repository pe file push kar rahe hain
        const updateRes = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Content-Type': 'application/json',
                'User-Agent': 'NodeJS-App'
            },
            body: JSON.stringify({
                message: 'system: live database update sync',
                content: newContentBase64,
                sha: sha || undefined
            })
        });

        if (updateRes.status === 200 || updateRes.status === 201) {
            console.log("💾 key.json GitHub repo par safely sync ho gaya hai.");
        } else {
            console.error("❌ GitHub sync failed. Status:", updateRes.status);
        }
    } catch (error) {
        console.error("❌ GitHub Save Error:", error);
    }
}


// --- HTTP ROUTING ENGINE ---

app.get('/webcam', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/key', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'key_manager.html'));
});

// API endpoint to generate new access tokens
app.post('/api/generate-key', async (req, res) => {
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

    // GitHub par asynchronous save trigger karein
    await saveKeysToGitHub();

    res.json({ success: true, key: newKey, expiresAt: expiresAt });
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


// --- CORE TELEMETRY SERVER ENGINE ---

const server = app.listen(PORT, async () => {
    console.log(`🚀 Core Secure Asset Manager deployed on port ${PORT}`);
    // Server start hote hi GitHub se purana data turant khinch lega
    await loadKeysFromGitHub();
});

const wss = new WebSocketServer({ server });

// Keep-alive connection loop to prevent Render from idling out
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.readyState === 1) ws.ping();
    });
}, 20000);

wss.on('connection', (ws) => {
    let clientType = null;
    let assignedKey = null;
    let deviceModel = null;

    ws.on('message', async (message, isBinary) => {
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

                            // Device connect hote hi uski state GitHub pe sync karein
                            await saveKeysToGitHub();

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

    ws.on('close', async () => {
        if (clientType === 'app' && assignedKey) {
            const tunnel = activeTunnels.get(assignedKey);
            if (tunnel) {
                tunnel.viewerSockets.forEach(v => v.send(JSON.stringify({ status: "offline" })));
                tunnel.appSocket = null;
            }
            const keyRecord = keyDatabase.get(assignedKey);
            if(keyRecord) {
                keyRecord.connectedDevice = "DISCONNECTED (STALE)";
                // Device disconnect par state update sync karein
                await saveKeysToGitHub();
            }
        } else if (clientType === 'viewer' && assignedKey) {
            const tunnel = activeTunnels.get(assignedKey);
            if (tunnel) tunnel.viewerSockets.delete(ws);
        }
    });
});
