const noble = require('@abandonware/noble');

module.exports = function(RED) {

    function BLEController(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.peripherals = {};  // cache by id
        node._scanning = false;
        node._nobleReady = false;

        noble.on('stateChange', (state) => {
            node._nobleReady = (state === 'poweredOn');
            node.log('BLE state: ' + state);
        });

        noble.on('discover', (peripheral) => {
            node.peripherals[peripheral.id] = peripheral;
            node.emit('discover', {
                topic: 'discover',
                payload: {
                    id:   peripheral.id,
                    name: peripheral.advertisement.localName || '',
                    rssi: peripheral.rssi
                }
            });
        });

        // Start scanning (called by ble-scan nodes)
        node.startScan = async function() {
            if (node._scanning) return;
            try {
                await noble.startScanningAsync([], true);
                node._scanning = true;
                node.log('BLE scan started');
            } catch (err) {
                node.error('Failed to start scanning: ' + err.message);
            }
        };

        // Stop scanning (called by ble-scan nodes or before connecting)
        node.stopScan = function() {
            if (!node._scanning) return;
            noble.stopScanning();
            node._scanning = false;
            node.log('BLE scan stopped');
        };

        // Connect to a peripheral by id, returns the peripheral
        node.connect = async function(deviceId) {
            const peripheral = node.peripherals[deviceId];
            if (!peripheral) {
                throw new Error('Peripheral not found in cache: ' + deviceId + '. Run BLE Scan first.');
            }
            if (peripheral.state !== 'connected') {
                node.stopScan();  // noble requires scanning to be stopped before connecting
                await peripheral.connectAsync();
            }
            return peripheral;
        };

        node.on('close', (done) => {
            node.stopScan();
            noble.removeAllListeners();
            done();
        });
    }

    RED.nodes.registerType('ble-controller', BLEController);
};
