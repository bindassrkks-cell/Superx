const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Active Devices Telemetry Tunnels Storage (In-Memory Only - No Keys Required)
// Structure: { deviceModel: { appSocket: ws, viewerSockets: Set(), status: String, lastSeen: Date } }
const deviceTunnels = new Map();

// --- HTTP ROUTING ENGINE ---

// Route 1: Main Live Preview Page
app.get('/webcam', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route 2: Device Hub Console Panel
app.get('/key', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'key_manager.html'));
});

// API endpoint to fetch all online/active hardware devices
app.get('/api/keys-status', (req, res) => {
    const statusArray = [];
    deviceTunnels.forEach((value, model) => {
        const isLive = value.appSocket && value.appSocket.readyState === 1;
        statusArray.push({
            key: model, // App functionality match karne ke liye model ko hi 'key' bana diya
            connectedDevice: model,
            status: isLive ? "ACTIVE_LOGIN" : "PENDING"
        });
    });
    res.json(statusArray);
});


// --- CORE TELEMETRY STREAMING SWITCHBOARD ---

const server = app.listen(PORT, () => {
    console.log(`🚀 Core Secure Device Hub deployed on port ${PORT}`);
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
    let assignedModel = null;

    ws.on('message', (message, isBinary) => {
        try {
            if (!isBinary) {
                const data = JSON.parse(message.toString());

                // 1. HARDWARE HANDSHAKE VIA DIRECT DEVICE MODEL NAME
                if (data.type === 'register_app') {
                    // Agar app purani authKey bhej rahi hai, toh hum use hi default model name maan lenge, 
                    // ya fir direct deviceModel variable ka use karenge.
                    const modelInput = (data.deviceModel || data.authKey || "UNKNOWN-DEVICE").toUpperCase();
                    
                    clientType = 'app';
                    assignedModel = modelInput;

                    // Initialize tunnel structure if not exists
                    if (!deviceTunnels.has(assignedModel)) {
                        deviceTunnels.set(assignedModel, { appSocket: ws, viewerSockets: new Set() });
                    } else {
                        deviceTunnels.get(assignedModel).appSocket = ws;
                    }

                    console.log(`📱 Hardware Node Connected directly via Model: [${assignedModel}]`);

                    // Alert waiting viewer consoles
                    const tunnel = deviceTunnels.get(assignedModel);
                    tunnel.viewerSockets.forEach(v => v.send(JSON.stringify({ status: "app_online" })));
                    return;
                }

                // 2. DASHBOARD VIEW INTERFACE REGISTRATION
                if (data.type === 'register_viewer') {
                    // Viewer dashboard directly device model name se connect hoga (authKey string me model name daalna hoga)
                    const targetModel = (data.authKey || "UNKNOWN-DEVICE").toUpperCase();
                    
                    clientType = 'viewer';
                    assignedModel = targetModel;

                    if (!deviceTunnels.has(assignedModel)) {
                        deviceTunnels.set(assignedModel, { appSocket: null, viewerSockets: new Set() });
                    }
                    deviceTunnels.get(assignedModel).viewerSockets.add(ws);

                    const tunnel = deviceTunnels.get(assignedModel);
                    const isLive = tunnel.appSocket && tunnel.appSocket.readyState === 1;

                    ws.send(JSON.stringify({ 
                        status: "connected", 
                        deviceState: isLive ? "ONLINE" : "OFFLINE" 
                    }));
                }

                // 3. REMOTE ADMINISTRATIVE COMMAND SWITCHBOARD
                if (data.type === 'control_cmd') {
                    if (clientType === 'viewer' && assignedModel) {
                        const tunnel = deviceTunnels.get(assignedModel);
                        if (tunnel && tunnel.appSocket && tunnel.appSocket.readyState === 1) {
                            tunnel.appSocket.send(JSON.stringify({
                                action: data.action, 
                                cameraFacing: data.cameraFacing
                            }));
                        }
                    }
                }
            } 
            // 4. PIPELINE BUFFER TRANSPORT MECHANISM (DIRECT STREAM PIPING)
            else {
                if (clientType === 'app' && assignedModel) {
                    const tunnel = deviceTunnels.get(assignedModel);
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
        if (clientType === 'app' && assignedModel) {
            const tunnel = deviceTunnels.get(assignedModel);
            if (tunnel) {
                tunnel.viewerSockets.forEach(v => v.send(JSON.stringify({ status: "offline" })));
                tunnel.appSocket = null;
            }
            console.log(`❌ Hardware Node Disconnected: [${assignedModel}]`);
            // Clean up empty tunnels to keep system fast
            if (tunnel && tunnel.viewerSockets.size === 0) {
                deviceTunnels.delete(assignedModel);
            }
        } else if (clientType === 'viewer' && assignedModel) {
            const tunnel = deviceTunnels.get(assignedModel);
            if (tunnel) {
                tunnel.viewerSockets.delete(ws);
                if (!tunnel.appSocket && tunnel.viewerSockets.size === 0) {
                    deviceTunnels.delete(assignedModel);
                }
            }
        }
    });
});
