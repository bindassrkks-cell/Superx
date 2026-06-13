const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Key Matrix Database (In-Memory Testing Ke Liye)
// Structure: { keyString: { createdAt: Date, expiresAt: Date, connectedDevice: String, isActive: Boolean } }
const keyDatabase = new Map();

// Active Streaming Tunnels Storage
const activeTunnels = new Map();

// --- HTTP ROUTING ENGINE ---

// Route 1: Main Live Preview Page
app.get('/webcam', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route 2: Key Generator Management Panel Interface
app.get('/key', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'key_manager.html'));
});

// API endpoint to generate new access tokens
app.post('/api/generate-key', (req, res) => {
    const { durationHours } = req.body;
    const hours = parseInt(durationHours) || 24; // Default 24 hours validity
    
    // Simple secure random token generation string
    const newKey = "CTX-" + Math.random().toString(36).substring(2, 10).toUpperCase();
    
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + (hours * 60 * 60 * 1000));
    
    keyDatabase.set(newKey, {
        createdAt: createdAt,
        expiresAt: expiresAt,
        connectedDevice: "NONE (NOT LINKED)",
        isActive: true
    });
    
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

const server = app.listen(PORT, () => {
    console.log(`🚀 Core Secure Asset Manager deployed on port ${PORT}`);
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

    ws.on('message', (message, isBinary) => {
        try {
            if (!isBinary) {
                const data = JSON.parse(message.toString());

                // 1. SAFE APP HANDSHAKE REGISTRATION WITH TOKEN VALIDATION
                if (data.type === 'register_app') {
                    const clientKey = data.authKey;
                    const modelInput = data.deviceModel ? data.deviceModel.toUpperCase() : "UNKNOWN";
                    
                    // Validate if key exists and is not expired
                    if (keyDatabase.has(clientKey)) {
                        const keyRecord = keyDatabase.get(clientKey);
                        const isExpired = new Date() > keyRecord.expiresAt;
                        
                        if (!isExpired && keyRecord.isActive) {
                            clientType = 'app';
                            assignedKey = clientKey;
                            deviceModel = modelInput;
                            
                            // Update binding records in system database
                            keyRecord.connectedDevice = deviceModel;
                            
                            if (!activeTunnels.has(assignedKey)) {
                                activeTunnels.set(assignedKey, { appSocket: ws, viewerSockets: new Set() });
                            } else {
                                activeTunnels.get(assignedKey).appSocket = ws;
                            }
                            
                            console.log(`📱 Hardware Node Connected securely via token [${assignedKey}] -> ${deviceModel}`);
                            
                            // Alert waiting viewer consoles
                            const tunnel = activeTunnels.get(assignedKey);
                            tunnel.viewerSockets.forEach(v => v.send(JSON.stringify({ status: "app_online" })));
                            return;
                        }
                    }
                    
                    // Reject connection if validation parameters fail
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
                                action: data.action, // START_CAM, STOP_CAM
                                cameraFacing: data.cameraFacing
                            }));
                        }
                    }
                }
            } 
            // 4. PIPELINE BUFFER TRANSPORT MECHANISM
            else {
                if (clientType === 'app' && assignedKey) {
                    const tunnel = activeTunnels.get(assignedKey);
                    if (tunnel && tunnel.viewerSockets.size > 0) {
                        tunnel.viewerSockets.forEach((viewerSocket) => {
                            if (viewerSocket.readyState === 1) {
                                viewerSocket.send(message); // Pipe stream payload directly to screen
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
