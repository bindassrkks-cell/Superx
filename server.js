const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Key: deviceModel, Value: { appSocket: ws, viewerSockets: Set }
const deviceTunnels = new Map();

app.get('/webcam', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(PORT, () => {
    console.log(`🚀 Telemetry Server running on port ${PORT}`);
});

const wss = new WebSocketServer({ server });

// Render Connection Drop Bypass
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.readyState === 1) ws.ping();
    });
}, 20000);

wss.on('connection', (ws) => {
    let clientType = null;
    let deviceModel = null;

    ws.on('message', (message, isBinary) => {
        try {
            if (!isBinary) {
                const data = JSON.parse(message.toString());

                // 1. Android App Auth Setup
                if (data.type === 'register_app') {
                    clientType = 'app';
                    deviceModel = data.deviceModel.toUpperCase();
                    
                    if (!deviceTunnels.has(deviceModel)) {
                        deviceTunnels.set(deviceModel, { appSocket: null, viewerSockets: new Set() });
                    }
                    deviceTunnels.get(deviceModel).appSocket = ws;
                    console.log(`📱 Hardware Terminal Registered: ${deviceModel}`);
                    
                    // Notify active viewers that app is online
                    const tunnel = deviceTunnels.get(deviceModel);
                    tunnel.viewerSockets.forEach(v => v.send(JSON.stringify({ status: "app_online" })));
                }

                // 2. Web Viewer Dashboard Setup
                if (data.type === 'register_viewer') {
                    clientType = 'viewer';
                    deviceModel = data.deviceModel.toUpperCase();
                    
                    if (!deviceTunnels.has(deviceModel)) {
                        deviceTunnels.set(deviceModel, { appSocket: null, viewerSockets: new Set() });
                    }
                    deviceTunnels.get(deviceModel).viewerSockets.add(ws);
                    console.log(`👀 Operator Viewer Registered for: ${deviceModel}`);
                    
                    const tunnel = deviceTunnels.get(deviceModel);
                    const isAppLive = tunnel.appSocket && tunnel.appSocket.readyState === 1;
                    ws.send(JSON.stringify({ 
                        status: "connected", 
                        deviceState: isAppLive ? "ONLINE" : "OFFLINE" 
                    }));
                }

                // 3. Web UI se Control Commands Router (Forward direct to Android)
                if (data.type === 'control_cmd') {
                    const targetModel = data.deviceModel.toUpperCase();
                    const tunnel = deviceTunnels.get(targetModel);
                    if (tunnel && tunnel.appSocket && tunnel.appSocket.readyState === 1) {
                        tunnel.appSocket.send(JSON.stringify({
                            action: data.action, // START_CAM, STOP_CAM, SWITCH_CAM
                            cameraFacing: data.cameraFacing // "FRONT" or "BACK"
                        }));
                        console.log(`📡 Forwarded Remote Command [${data.action}] to ${targetModel}`);
                    }
                }
            } 
            // 4. Binary Frame Matrix Pipeline (App to Viewer)
            else {
                if (clientType === 'app' && deviceModel) {
                    const tunnel = deviceTunnels.get(deviceModel);
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
            console.error("Pipeline Engine Exception:", error);
        }
    });

    ws.on('close', () => {
        if (clientType === 'app' && deviceModel) {
            const tunnel = deviceTunnels.get(deviceModel);
            if (tunnel) {
                tunnel.viewerSockets.forEach(v => v.send(JSON.stringify({ status: "offline" })));
                tunnel.appSocket = null;
            }
            console.log(`🔴 Hardware Node Offline: ${deviceModel}`);
        } else if (clientType === 'viewer' && deviceModel) {
            const tunnel = deviceTunnels.get(deviceModel);
            if (tunnel) tunnel.viewerSockets.delete(ws);
        }
    });
});
