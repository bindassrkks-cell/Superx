const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const activeStreams = new Map();

app.get('/webcam', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(PORT, () => {
    console.log(`🚀 Server running smoothly on port ${PORT}`);
});

// WebSocket Server Setup
const wss = new WebSocketServer({ server });

// Render Auto-Disconnect Bypass: Ping clients every 25 seconds
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.readyState === 1) {
            ws.ping(); // Keep-alive heartbeat
        }
    });
}, 25000);

wss.on('connection', (ws) => {
    let clientType = null;
    let deviceModel = null;

    ws.on('message', (message) => {
        try {
            if (typeof message === 'string' || !Buffer.isBuffer(message)) {
                const data = JSON.parse(message);

                if (data.type === 'register_app') {
                    clientType = 'app';
                    deviceModel = data.deviceModel.toUpperCase();
                    if (!activeStreams.has(deviceModel)) {
                        activeStreams.set(deviceModel, new Set());
                    }
                    console.log(`📱 App Registered: ${deviceModel}`);
                }

                if (data.type === 'register_viewer') {
                    clientType = 'viewer';
                    deviceModel = data.deviceModel.toUpperCase();
                    
                    if (!activeStreams.has(deviceModel)) {
                        activeStreams.set(deviceModel, new Set());
                    }
                    activeStreams.get(deviceModel).add(ws);
                    
                    console.log(`👀 Viewer Registered for: ${deviceModel}`);
                    ws.send(JSON.stringify({ status: "connected", message: "Streaming Tunnel Open" }));
                }
            } else if (Buffer.isBuffer(message)) {
                if (clientType === 'app' && deviceModel) {
                    const viewers = activeStreams.get(deviceModel);
                    if (viewers && viewers.size > 0) {
                        viewers.forEach((viewerSocket) => {
                            if (viewerSocket.readyState === 1) {
                                viewerSocket.send(message);
                            }
                        });
                    }
                }
            }
        } catch (error) {
            console.error("Payload error:", error);
        }
    });

    ws.on('close', () => {
        if (clientType === 'app' && deviceModel) {
            const viewers = activeStreams.get(deviceModel);
            if (viewers) {
                viewers.forEach(v => v.send(JSON.stringify({ status: "offline", message: "Device went offline" })));
            }
            activeStreams.delete(deviceModel);
        } else if (clientType === 'viewer' && deviceModel) {
            const viewers = activeStreams.get(deviceModel);
            if (viewers) viewers.delete(ws);
        }
    });
});
