module.exports = function(RED) {

    function BLEScan(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        const controller = RED.nodes.getNode(config.controller);
        if (!controller) {
            node.error('No BLE Controller configured');
            node.status({ fill: 'red', shape: 'ring', text: 'no controller' });
            return;
        }

        let scanning = false;

        function setScanning(active) {
            scanning = active;
            if (active) {
                controller.startScan();
                node.status({ fill: 'green', shape: 'dot', text: 'scanning...' });
            } else {
                controller.stopScan();
                node.status({ fill: 'grey', shape: 'ring', text: 'stopped' });
            }
        }

        // Input message: msg.payload = 'start' | 'stop' | 'toggle'
        node.on('input', (msg) => {
            const cmd = (msg.payload || '').toString().toLowerCase().trim();
            if (cmd === 'start')       setScanning(true);
            else if (cmd === 'stop')   setScanning(false);
            else if (cmd === 'toggle') setScanning(!scanning);
            else node.warn('Unknown command: ' + cmd + ' (use start / stop / toggle)');
        });

        const onDiscover = (msg) => {
            node.status({ fill: 'green', shape: 'dot', text: (msg.payload.name || msg.payload.id) + ' [' + msg.payload.rssi + 'dBm]' });
            node.send(msg);
        };

        controller.on('discover', onDiscover);

        // Start scanning automatically if configured
        if (config.autoStart) {
            setScanning(true);
        } else {
            node.status({ fill: 'grey', shape: 'ring', text: 'stopped' });
        }

        node.on('close', (done) => {
            controller.removeListener('discover', onDiscover);
            if (scanning) controller.stopScan();
            done();
        });
    }

    RED.nodes.registerType('ble-scan', BLEScan);
};
