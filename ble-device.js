module.exports = function(RED) {

    function BLEDevice(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        const controller = RED.nodes.getNode(config.controller);
        if (!controller) {
            node.error('No BLE Controller configured');
            node.status({ fill: 'red', shape: 'ring', text: 'no controller' });
            return;
        }

        // ─── State ────────────────────────────────────────────────────────────
        let peripheral = null;
        let serviceMap  = {};   // uuid -> noble service
        let charMap     = {};   // uuid -> noble characteristic
        let subscriptions = new Set();   // char uuids currently subscribed

        // ─── Helpers ──────────────────────────────────────────────────────────

        function setStatus(fill, shape, text) {
            node.status({ fill, shape, text });
        }

        async function ensureConnected() {
            peripheral = await controller.connect(config.deviceId);

            const { services } = await peripheral.discoverAllServicesAndCharacteristicsAsync();
            serviceMap = {};
            charMap    = {};

            for (const s of services) {
                serviceMap[s.uuid] = s;
                for (const c of s.characteristics) {
                    charMap[c.uuid] = c;
                }
            }

            // Output 1 — services/characteristics map
            const servicesSummary = services.map(s => ({
                serviceUuid: s.uuid,
                characteristics: s.characteristics.map(c => ({
                    uuid:       c.uuid,
                    properties: c.properties
                }))
            }));

            node.send([
                { topic: 'services', device: config.deviceId, payload: servicesSummary },
                null,
                null
            ]);

            setStatus('green', 'dot', 'connected');

            // Re-subscribe to any characteristics that were configured
            for (const charUuid of (config.subscribeChars || [])) {
                await subscribeChar(charUuid);
            }

            peripheral.once('disconnect', async () => {
                setStatus('red', 'ring', 'disconnected');
                node.warn('Peripheral disconnected');
                subscriptions.clear();
                if (config.autoReconnect) {
                    node.log('Auto-reconnecting in 5s...');
                    setTimeout(async () => {
                        try { await ensureConnected(); }
                        catch (err) { node.error('Reconnect failed: ' + err.message); }
                    }, 5000);
                }
            });
        }

        async function subscribeChar(charUuid) {
            const c = charMap[charUuid];
            if (!c) {
                node.warn('Characteristic not found for subscribe: ' + charUuid);
                return;
            }
            if (subscriptions.has(charUuid)) return;   // already subscribed

            await c.subscribeAsync();
            subscriptions.add(charUuid);

            c.on('data', (data) => {
                // Output 2 — notifications
                node.send([
                    null,
                    {
                        topic:   'notification',
                        device:  config.deviceId,
                        char:    charUuid,
                        payload: data   // raw Buffer — parse downstream
                    },
                    null
                ]);
            });
        }

        async function writeChar(charUuid, data, withoutResponse) {
            if (!peripheral || peripheral.state !== 'connected') {
                throw new Error('Not connected — send a "connect" command first');
            }
            const c = charMap[charUuid];
            if (!c) throw new Error('Characteristic not found: ' + charUuid);

            let buf;
            if (Buffer.isBuffer(data)) {
                buf = data;
            } else if (Array.isArray(data)) {
                buf = Buffer.from(data);
            } else if (typeof data === 'string') {
                buf = Buffer.from(data, 'utf8');
            } else {
                throw new Error('payload must be a Buffer, byte array or string');
            }

            await c.writeAsync(buf, withoutResponse === true);

            // Output 3 — write ack
            node.send([
                null,
                null,
                { topic: 'write-ack', device: config.deviceId, char: charUuid, payload: buf }
            ]);
        }

        // ─── Input handler ────────────────────────────────────────────────────
        //
        // Commands via msg:
        //   msg.command = 'connect'                   → connect + discover
        //   msg.command = 'subscribe', msg.char = uuid → subscribe to notifications
        //   msg.command = 'write',    msg.char = uuid,
        //                             msg.payload     → write to characteristic
        //                             msg.withoutResponse (optional bool)
        //   msg.command = 'disconnect'                → disconnect

        node.on('input', async (msg) => {
            const cmd = (msg.command || 'connect').toLowerCase();

            try {
                if (cmd === 'connect') {
                    if (!config.deviceId) {
                        node.error('deviceId is required in node config');
                        return;
                    }
                    setStatus('yellow', 'ring', 'connecting...');
                    await ensureConnected();

                } else if (cmd === 'subscribe') {
                    const charUuid = msg.char || config.defaultChar;
                    if (!charUuid) { node.error('msg.char is required for subscribe'); return; }
                    await subscribeChar(charUuid);
                    setStatus('green', 'dot', 'subscribed: ' + charUuid);

                } else if (cmd === 'write') {
                    const charUuid = msg.char || config.defaultChar;
                    if (!charUuid) { node.error('msg.char is required for write'); return; }
                    setStatus('yellow', 'ring', 'writing...');
                    await writeChar(charUuid, msg.payload, msg.withoutResponse);
                    setStatus('green', 'dot', 'written: ' + charUuid);

                } else if (cmd === 'disconnect') {
                    if (peripheral && peripheral.state === 'connected') {
                        await peripheral.disconnectAsync();
                    }
                    setStatus('grey', 'ring', 'disconnected');

                } else {
                    node.warn('Unknown command: ' + cmd + ' (use connect / subscribe / write / disconnect)');
                }

            } catch (err) {
                node.error('BLE Device error: ' + err.message, msg);
                setStatus('red', 'ring', err.message);
            }
        });

        // ─── Cleanup ──────────────────────────────────────────────────────────
        node.on('close', async (done) => {
            subscriptions.clear();
            if (peripheral && peripheral.state === 'connected') {
                try { await peripheral.disconnectAsync(); } catch(_) {}
            }
            done();
        });
    }

    RED.nodes.registerType('ble-device', BLEDevice);
};
