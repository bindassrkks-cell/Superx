const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Supabase Infrastructure Connection Target
const SUPABASE_URL = "https://ilnzqxlbvwqhdwjowmnc.supabase.co/rest/v1/key_matrix";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlsbnpxeGxidndxaGR3am93bW5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNTQzNDEsImV4cCI6MjA5NjkzMDM0MX0.8WVHK-NGPujWmNntI8lZkSuKQgrfv6N0vnfrBXmBoiE";

// Live WebSocket Active Tunnels Mapping Buffer
const activeTunnels = new Map();

// --- SUPABASE ENGINE CORE TRANSACTIONS ---

// 1. Direct Pull API: Reads rows from cloud infrastructure
async function getAllKeysFromSupabase() {
    try {
        const response = await fetch(`${SUPABASE_URL}?select=*`, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        if (response.ok) {
            const data = await response.json();
            console.log(`📡 [SUPABASE FETCH] Successfully downloaded ${data.length} records from cloud storage.`);
            return data;
        } else {
            const errText = await response.text();
            console.error(`❌ [SUPABASE FETCH ERROR] Status: ${response.status}. Msg: ${errText}`);
            return [];
        }
    } catch (error) {
        console.error("❌ [SUPABASE NETWORK CRASH]:", error);
        return [];
    }
}

// 2. Direct Push API: Writes a new token block into the cloud table cluster
async function insertKeyToSupabase(keyData) {
    try {
        const response = await fetch(SUPABASE_URL, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify(keyData)
        });
        if (response.ok || response.status === 201) {
            console.log(`✅ [SUPABASE SUCCESS] Token Block [${keyData.key_string}] committed successfully.`);
        } else {
            const errText = await response.text();
            console.error(`❌ [SUPABASE INSERT FAIL] Code: ${response.status}. Msg: ${errText}`);
        }
    } catch (error) {
        console.error("❌ [SUPABASE INSERT NETWORK ERROR]:", error);
    }
}

// 3. Mutation Patch API: Updates metadata or device links inside database rows
async function updateKeyInSupabase(keyString, updateData) {
    try {
        const response = await fetch(`${SUPABASE_URL}?key_string=eq.${keyString}`, {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updateData)
        });
        if (response.ok) {
            console.log(`🔄 [SUPABASE UPDATED] State synced for key: ${keyString}`);
        }
    } catch (error) {
        console.error("❌ [SUPABASE UPDATE ERROR]:", error);
    }
}


// --- HTTP ROUTING PORTS ---

app.get('/webcam', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/key', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'key_manager.html'));
});

// Endpoint to generate tokens and auto-commit to Supabase
app.post('/api/generate-key', async (req, res) => {
    const { durationHours } = req.body;
    const hours = parseInt(durationHours) || 24;

    const newKey = "CTX-" + Math.random().toString(36).substring(2, 10).toUpperCase();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + (hours * 60 * 60 * 1000));

    // Instant cloud write pipeline dispatch
    await insertKeyToSupabase({
        key_string: newKey,
        created_at: createdAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        connected_device: "NONE (NOT LINKED)",
        is_active: true
    });

    res.json({ success: true, key: newKey, expiresAt: expiresAt });
});

// Endpoint to fetch real-time statuses from Supabase cluster rows
app.get('/api/keys-status', async (req, res) => {
    const rows = await getAllKeysFromSupabase();
    if (!rows || !Array.isArray(rows)) {
        return res.json([]);
    }

    const statusArray = rows.map(row => {
        const expiresAtDate = new Date(row.expires_at);
        return {
            key: row.key_string,
            expiresAt: row.expires_at,
            connectedDevice: row.connected_device || "NONE (NOT LINKED)",
            status: new Date() > expiresAtDate ? "EXPIRED" : (row.connected_device !== "NONE (NOT LINKED)" && !row.connected_device.includes("DISCONNECTED") ? "ACTIVE_LOGIN" : "PENDING")
        };
    });
    res.json(statusArray);
});


// --- TELEMETRY CORE SIGNAL STREAMING SOCKET SYSTEM ---

const server = app.listen(PORT, () => {
    console.log(`🚀 Telemetry Interface Server operational on routing port: ${PORT}`);
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

    ws.on('message', async (message, isBinary) => {
        try {
            if (!isBinary) {
                const data = JSON.parse(message.toString());

                // 1. HARDWARE HANDSHAKE TERMINAL BINDING
                if (data.type === 'register_app') {
                    const clientKey = data.authKey;
                    const modelInput = data.deviceModel ? data.deviceModel.toUpperCase() : "UNKNOWN";

                    const rows = await getAllKeysFromSupabase();
                    const keyRecord = rows.find(r => r.key_string === clientKey);

                    if (keyRecord) {
                        const isExpired = new Date() > new Date(keyRecord.expires_at);

                        if (!isExpired && keyRecord.is_active) {
                            clientType = 'app';
                            assignedKey = clientKey;
                            deviceModel = modelInput;

                            await updateKeyInSupabase(assignedKey, { connected_device: deviceModel });

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

                // 2. VIEWER MANAGEMENT DESK REGISTER
                if (data.type === 'register_viewer') {
                    const targetKey = data.authKey;
                    
                    const rows = await getAllKeysFromSupabase();
                    const hasKey = rows.some(r => r.key_string === targetKey);

                    if (hasKey) {
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

                // 3. ADMINISTRATIVE INBOUND SWITCH CONTROL COMMANDS
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
            await updateKeyInSupabase(assignedKey, { connected_device: "DISCONNECTED (STALE)" });
        } else if (clientType === 'viewer' && assignedKey) {
            const tunnel = activeTunnels.get(assignedKey);
            if (tunnel) tunnel.viewerSockets.delete(ws);
        }
    });
});
