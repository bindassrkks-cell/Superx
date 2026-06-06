const http = require('http');
const WebSocket = require('ws');

// 1. HTTP Server create karna (Render ke Health Check verification ke liye mandatory hai)
const server = http.createServer((req, res) => {
    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('🚀 BoomXs8 Mirroring Server is Running Online!');
    } else {
        res.writeHead(404);
        res.end();
    }
});

// 2. WebSocket Server ko HTTP Framework ke sath attach karna
const wss = new WebSocket.Server({ noServer: true });

// Connected clients ko track karne ke liye global dynamic variables
let streamerSocket = null;
let controllerSocket = null;

wss.on('connection', (ws, request) => {
    const path = request.url;
    ws.isAlive = true;

    // Heartbeat mechanism: Client connection status maintain rakhne ke liye ping listener
    ws.on('pong', () => {
        ws.isAlive = true;
    });

    // 🟢 CASE A: Target Phone (Streamer App) Connect Hua
    if (path === '/stream') {
        if (streamerSocket) {
            console.log('🔄 Overwriting existing streamer connection...');
            streamerSocket.close();
        }
        streamerSocket = ws;
        console.log('📱 [Target Phone] connected and ready to stream.');

        ws.on('message', (message, isBinary) => {
            // Streamer se aaya binary frame byte array direct Controller/Viewer ko push karein
            if (controllerSocket && controllerSocket.readyState === WebSocket.OPEN) {
                controllerSocket.send(message, { binary: isBinary });
            }
        });

        ws.on('close', () => {
            if (streamerSocket === ws) streamerSocket = null;
            console.log('❌ [Target Phone] disconnected.');
        });
    }

    // 🔵 CASE B: Controller Phone (Viewer App) Connect Hua
    if (path === '/control') {
        if (controllerSocket) {
            console.log('🔄 Overwriting existing controller connection...');
            controllerSocket.close();
        }
        controllerSocket = ws;
        console.log('🎮 [Controller App] connected and ready to monitor.');

        ws.on('message', (message) => {
            // Controller se aaya JSON click input coordinate text format me Streamer app ko pass karein
            if (streamerSocket && streamerSocket.readyState === WebSocket.OPEN) {
                streamerSocket.send(message.toString());
            }
        });

        ws.on('close', () => {
            if (controllerSocket === ws) controllerSocket = null;
            console.log('❌ [Controller App] disconnected.');
        });
    }
});

// 3. HTTP Upgrade request interceptor handler
server.on('upgrade', (request, socket, head) => {
    const pathname = request.url;

    if (pathname === '/stream' || pathname === '/control') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

// 4. Render ke environment check variables ke anusaar port dynamic bind karna
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`🚀 Production Signaling Engine deployed successfully on port ${PORT}`);
});

// 5. Ping Interval Engine: Har 30 seconds me dead links ko auto-terminate karna taaki RAM khali rahe
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(interval);
});
