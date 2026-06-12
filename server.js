const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Active device streams storage
// Key: deviceModel, Value: Set of viewer sockets
const activeStreams = new Map();

app.get('/webcam', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(PORT, () => {
    console.log(`🚀 Production Server running flawlessly on port ${PORT}`);
});

const wss = new WebSocketServer({ server });

// Keep-alive heartbeat loop to prevent Render from idling out
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.readyState === 1) {
            ws.ping();
        }
    });
}, 20000);

wss.on('connection', (ws) => {
    let clientType = null;
    let deviceModel = null;

    ws.on('message', (message, isBinary) => {
        try {
            // FIX: Agar binary data nahi hai, toh use decode karke JSON parse karo
            if (!isBinary) {
                const textData = message.toString();
                const data = JSON.parse(textData);

                // 1. Android App Registration
                if (data.type === 'register_app') {
                    clientType = 'app';
                    deviceModel = data.deviceModel.toUpperCase();
                    
                    if (!activeStreams.has(deviceModel)) {
                        activeStreams.set(deviceModel, new Set());
                    }
                    console.log(`📱 Android App Synced: ${deviceModel}`);
                }

                // 2. Viewer Registration
                if (data.type === 'register_viewer') {
                    clientType = 'viewer';
                    deviceModel = data.deviceModel.toUpperCase();
                    
                    if (!activeStreams.has(deviceModel)) {
                        activeStreams.set(deviceModel, new Set());
                    }
                    activeStreams.get(deviceModel).add(ws);
                    
                    console.log(`👀 Web Viewer Attached to: ${deviceModel}`);
                    ws.send(JSON.stringify({ status: "connected", message: "Tunnel Active" }));
                }
            } 
            // 3. Binary Frame Forwarding
            else {
                if (clientType === 'app' && deviceModel) {
                    const viewers = activeStreams.get(deviceModel);
                    if (viewers && viewers.size > 0) {
                        viewers.forEach((viewerSocket) => {
                            if (viewerSocket.readyState === 1) {
                                viewerSocket.send(message); // Forward frame to web client
                            }
                        });
                    }
                }
            }
        } catch (error) {
            console.error("Transmission Error:", error);
        }
    });

    ws.on('close', () => {
        if (clientType === 'app' && deviceModel) {
            console.log(`🔴 App disconnected: ${deviceModel}`);
            const viewers = activeStreams.get(deviceModel);
            if (viewers) {
                viewers.forEach(v => v.send(JSON.stringify({ status: "offline" })));
            }
            activeStreams.delete(deviceModel);
        } else if (clientType === 'viewer' && deviceModel) {
            const viewers = activeStreams.get(deviceModel);
            if (viewers) {
                viewers.delete(ws);
                console.log(`👋 Viewer left channel: ${deviceModel}`);
            }
        }
    });
});
