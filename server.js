const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware for parsing JSON and serving static files
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Active device streams ko store karne ke liye Map
// Key: deviceModel (e.g., "RMX3870"), Value: Array of web viewer sockets
const activeStreams = new Map();

// HTTP Route: Live Webcam Page View
app.get('/webcam', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// HTTP Server start karne ke liye
const server = app.listen(PORT, () => {
    console.log(`🚀 Server is running flawlessly on port ${PORT}`);
});

// WebSocket Server Setup (Kyunki Render par ek hi port standard hai)
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
    let clientType = null; // 'app' ya 'viewer'
    let deviceModel = null;

    ws.on('message', (message) => {
        try {
            // Check agar data Text (JSON) hai ya Binary (Video Frame)
            if (typeof message === 'string' || Buffer.isBuffer(message) === false) {
                const data = JSON.parse(message);

                // 1. Android App Registration
                if (data.type === 'register_app') {
                    clientType = 'app';
                    deviceModel = data.deviceModel.toUpperCase();
                    
                    if (!activeStreams.has(deviceModel)) {
                        activeStreams.set(deviceModel, new Set());
                    }
                    console.log(`📱 Android App Connected for Model: ${deviceModel}`);
                }

                // 2. Web Viewer Registration
                if (data.type === 'register_viewer') {
                    clientType = 'viewer';
                    deviceModel = data.deviceModel.toUpperCase();
                    
                    if (activeStreams.has(deviceModel)) {
                        activeStreams.get(deviceModel).add(ws);
                        console.log(`👀 New Web Viewer connected for Model: ${deviceModel}`);
                        ws.send(JSON.stringify({ status: "connected", message: "Streaming started" }));
                    } else {
                        ws.send(JSON.stringify({ status: "error", message: "Device offline ya galat model number" }));
                    }
                }
            } 
            // 3. Binary Video Stream Data Handling (From App to Viewers)
            else if (Buffer.isBuffer(message)) {
                if (clientType === 'app' && deviceModel) {
                    const viewers = activeStreams.get(deviceModel);
                    if (viewers && viewers.size > 0) {
                        // Bina store kiye, video frame ko direct sabhi web viewers ko forward (pipe) karo
                        viewers.forEach((viewerSocket) => {
                            if (viewerSocket.readyState === 1) { // 1 means OPEN
                                viewerSocket.send(message);
                            }
                        });
                    }
                }
            }
        } catch (error) {
            console.error("Error processing message:", error);
        }
    });

    // Connection Close Handler
    ws.on('close', () => {
        if (clientType === 'app' && deviceModel) {
            console.log(`🔴 Android App Disconnected: ${deviceModel}`);
            const viewers = activeStreams.get(deviceModel);
            if (viewers) {
                viewers.forEach(v => v.send(JSON.stringify({ status: "offline", message: "Device went offline" })));
            }
            activeStreams.delete(deviceModel);
        } else if (clientType === 'viewer' && deviceModel) {
            const viewers = activeStreams.get(deviceModel);
            if (viewers) {
                viewers.delete(ws);
                console.log(`👋 A viewer left the stream for Model: ${deviceModel}`);
            }
        }
    });
});
