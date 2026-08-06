/**
 * MasterOrder Staff ESC/POS SDK — 公式レシートテンプレ + 印刷搬送。
 *
 * ブロック ① Banner 画像は未実装（スキップ）。②〜⑧ のテキストのみ。
 * Web: WebUSB / Web Serial。Native (Capacitor): Bluetooth SPP / TCP 9100。
 * デフォルトプリンタはブラウザ localStorage に端末単位で保存。
 * グローバル: MasterOrderStaffEscPosSdk
 */
(function (global) {
    'use strict';

    var SDK_VERSION = '0.3.0';
    var DEFAULT_PRINTER_KEY = 'mo.staff.defaultPrinter';
    var USB_CHUNK = 512;
    var DEFAULT_TCP_PORT = 9100;

    function isNativePlatform() {
        try {
            return !!(global.Capacitor
                && typeof global.Capacitor.isNativePlatform === 'function'
                && global.Capacitor.isNativePlatform());
        } catch (_e) {
            return false;
        }
    }

    function getNativeEscPosPlugin() {
        if (global.MasterOrderNativeBridge && typeof global.MasterOrderNativeBridge.getEscPosPrinter === 'function') {
            var viaBridge = global.MasterOrderNativeBridge.getEscPosPrinter();
            if (viaBridge) {
                return viaBridge;
            }
        }
        if (global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.EscPosPrinter) {
            return global.Capacitor.Plugins.EscPosPrinter;
        }
        return null;
    }

    function supportsNativePrinter() {
        return isNativePlatform() && !!getNativeEscPosPlugin();
    }

    function bytesToBase64(bytes) {
        var data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
        var CHUNK = 0x8000;
        var binary = '';
        for (var i = 0; i < data.length; i += CHUNK) {
            var slice = data.subarray(i, Math.min(i + CHUNK, data.length));
            binary += String.fromCharCode.apply(null, slice);
        }
        return global.btoa(binary);
    }

    var ESC = 0x1b;
    var GS = 0x1d;
    var LF = 0x0a;

    function formatYen(value) {
        var n = Number(value);
        if (!Number.isFinite(n)) {
            n = 0;
        }
        return '\u00A5' + Math.trunc(n).toLocaleString('ja-JP');
    }

    function encodeText(text) {
        var s = text == null ? '' : String(text);
        try {
            if (typeof TextEncoder !== 'undefined') {
                try {
                    return new TextEncoder('shift_jis').encode(s);
                } catch (_sjis) {
                    return new TextEncoder('utf-8').encode(s);
                }
            }
        } catch (_ignored) {
            /* fall through */
        }
        var out = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i += 1) {
            out[i] = s.charCodeAt(i) & 0xff;
        }
        return out;
    }

    function concatBytes(chunks) {
        var total = 0;
        for (var i = 0; i < chunks.length; i += 1) {
            total += chunks[i].length;
        }
        var out = new Uint8Array(total);
        var offset = 0;
        for (var j = 0; j < chunks.length; j += 1) {
            out.set(chunks[j], offset);
            offset += chunks[j].length;
        }
        return out;
    }

    function cmdInit() {
        return new Uint8Array([ESC, 0x40]);
    }

    function cmdAlign(mode) {
        // 0=left, 1=center, 2=right
        return new Uint8Array([ESC, 0x61, mode & 0xff]);
    }

    function cmdFeed(lines) {
        var n = Math.max(0, Math.min(255, lines | 0));
        return new Uint8Array([ESC, 0x64, n]);
    }

    function cmdCut() {
        return new Uint8Array([GS, 0x56, 0x00]);
    }

    function line(text) {
        return concatBytes([encodeText(text), new Uint8Array([LF])]);
    }

    function separator() {
        return line('--------------------------------');
    }

    function formatDateTime(value) {
        if (!value) {
            return '';
        }
        var d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) {
            return String(value);
        }
        return d.toLocaleString('ja-JP');
    }

    /**
     * 公式テンプレ ②〜⑧ の ESC/POS バイト列を返す（① 画像はスキップ）。
     * @param {object} payload
     * @returns {Uint8Array}
     */
    function buildOfficialReceiptBytes(payload) {
        var p = payload || {};
        var shop = p.shop || {};
        var session = p.session || {};
        var payment = p.payment || {};
        var lines = Array.isArray(p.lines) ? p.lines : [];
        var chunks = [cmdInit(), cmdAlign(1)];

        // ② 店舗名
        chunks.push(line('ご利用明細'));
        if (shop.name) {
            chunks.push(line(String(shop.name)));
        }
        chunks.push(cmdFeed(1));
        chunks.push(cmdAlign(0));

        // ③ 店の一言
        if (shop.receiptGreeting) {
            chunks.push(line(String(shop.receiptGreeting)));
            chunks.push(cmdFeed(1));
        }

        // ④ 注文内容
        var tableLabel = session.tableNumber != null ? '席 ' + session.tableNumber : '';
        var when = formatDateTime(session.checkedOutAt || session.endTime || session.startTime || p.printedAt);
        if (tableLabel || when) {
            chunks.push(line([tableLabel, when].filter(Boolean).join('  ')));
        }
        chunks.push(separator());
        for (var i = 0; i < lines.length; i += 1) {
            var item = lines[i] || {};
            if (item.cancelled && shop.receiptPrintCancelledLines === false) {
                continue;
            }
            var name = String(item.name || item.menuName || '');
            if (item.cancelled) {
                name = '[取消] ' + name;
            }
            var qty = item.quantity != null ? ' x' + item.quantity : '';
            var price = item.lineTotal != null
                ? formatYen(item.lineTotal)
                : (item.unitPrice != null ? formatYen(item.unitPrice) : '');
            chunks.push(line(name + qty));
            if (price) {
                chunks.push(line('  ' + price));
            }
        }
        chunks.push(separator());
        var total = session.totalAmount != null ? session.totalAmount : p.totalAmount;
        chunks.push(line('合計  ' + formatYen(total)));
        var method = String(payment.paymentMethod || payment.method || 'CASH').toUpperCase();
        if (method === 'CARD') {
            chunks.push(line('支払  カード'));
        } else {
            chunks.push(line('支払  現金'));
            if (payment.cashReceived != null || payment.tenderedYen != null) {
                chunks.push(line('お預かり  ' + formatYen(payment.cashReceived != null
                    ? payment.cashReceived
                    : payment.tenderedYen)));
            }
            if (payment.changeYen != null) {
                chunks.push(line('お釣り  ' + formatYen(payment.changeYen)));
            }
        }
        chunks.push(cmdFeed(1));

        // ⑤ 末尾一言
        if (shop.receiptFooter) {
            chunks.push(cmdAlign(1));
            chunks.push(line(String(shop.receiptFooter)));
            chunks.push(cmdAlign(0));
            chunks.push(cmdFeed(1));
        }

        // ⑥ HP QR — 骨格では URL テキストのみ（QR 画像は未実装）
        if (shop.homepageUrl) {
            chunks.push(cmdAlign(1));
            chunks.push(line(String(shop.homepageUrl)));
            chunks.push(cmdAlign(0));
            chunks.push(cmdFeed(1));
        }

        // ⑦ Archive ID
        if (session.archiveId || session.sessionId || p.archiveId) {
            chunks.push(line('Archive: ' + String(session.archiveId || p.archiveId || session.sessionId)));
        }

        // ⑧ 連絡先
        chunks.push(cmdFeed(1));
        chunks.push(cmdAlign(1));
        if (shop.address) {
            chunks.push(line(String(shop.address)));
        }
        if (shop.phone || shop.phoneNumber) {
            chunks.push(line('TEL ' + String(shop.phone || shop.phoneNumber)));
        }
        chunks.push(cmdFeed(3));
        chunks.push(cmdCut());

        return concatBytes(chunks);
    }

    function downloadReceiptBytes(bytes, filename) {
        var data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
        var name = filename || ('receipt-' + Date.now() + '.bin');
        var blob = new Blob([data], { type: 'application/octet-stream' });
        var url = URL.createObjectURL(blob);
        try {
            var a = document.createElement('a');
            a.href = url;
            a.download = name;
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            a.remove();
        } finally {
            setTimeout(function () {
                try {
                    URL.revokeObjectURL(url);
                } catch (_ignored) {
                    /* ignore */
                }
            }, 1000);
        }
    }

    function supportsUsb() {
        return !!(global.navigator && global.navigator.usb && typeof global.navigator.usb.getDevices === 'function');
    }

    function supportsSerial() {
        return !!(global.navigator && global.navigator.serial && typeof global.navigator.serial.getPorts === 'function');
    }

    function hex4(n) {
        return ('0000' + (Number(n) & 0xffff).toString(16)).slice(-4);
    }

    function usbPrinterId(device) {
        return 'usb:' + hex4(device.vendorId) + ':' + hex4(device.productId)
            + ':' + String(device.serialNumber || '');
    }

    function serialPrinterId(port, index) {
        var info = {};
        try {
            info = typeof port.getInfo === 'function' ? (port.getInfo() || {}) : {};
        } catch (_ignored) {
            info = {};
        }
        if (info.usbVendorId != null && info.usbProductId != null) {
            return 'serial:' + hex4(info.usbVendorId) + ':' + hex4(info.usbProductId);
        }
        return 'serial:port-' + String(index != null ? index : 0);
    }

    function describeUsbDevice(device) {
        var parts = [];
        if (device.productName) {
            parts.push(String(device.productName));
        } else {
            parts.push('USB プリンタ');
        }
        if (device.manufacturerName) {
            parts.push('(' + String(device.manufacturerName) + ')');
        }
        parts.push(hex4(device.vendorId) + ':' + hex4(device.productId));
        return parts.join(' ');
    }

    function describeSerialPort(port, index) {
        var info = {};
        try {
            info = typeof port.getInfo === 'function' ? (port.getInfo() || {}) : {};
        } catch (_ignored) {
            info = {};
        }
        if (info.usbVendorId != null && info.usbProductId != null) {
            return 'シリアル ' + hex4(info.usbVendorId) + ':' + hex4(info.usbProductId);
        }
        return 'シリアルポート ' + String((index != null ? index : 0) + 1);
    }

    function readDefaultPrinter() {
        try {
            var raw = global.localStorage && global.localStorage.getItem(DEFAULT_PRINTER_KEY);
            if (!raw) {
                return null;
            }
            var parsed = JSON.parse(raw);
            if (!parsed || !parsed.id || !parsed.transport) {
                return null;
            }
            return parsed;
        } catch (_ignored) {
            return null;
        }
    }

    function writeDefaultPrinter(entry) {
        if (!global.localStorage) {
            throw new Error('このブラウザではプリンタ設定を保存できません');
        }
        if (!entry) {
            global.localStorage.removeItem(DEFAULT_PRINTER_KEY);
            return null;
        }
        var saved = {
            id: String(entry.id),
            transport: String(entry.transport),
            label: String(entry.label || entry.id),
            vendorId: entry.vendorId != null ? Number(entry.vendorId) : undefined,
            productId: entry.productId != null ? Number(entry.productId) : undefined,
            serialNumber: entry.serialNumber != null ? String(entry.serialNumber) : undefined,
            address: entry.address != null ? String(entry.address) : undefined,
            host: entry.host != null ? String(entry.host) : undefined,
            port: entry.port != null ? Number(entry.port) : undefined
        };
        global.localStorage.setItem(DEFAULT_PRINTER_KEY, JSON.stringify(saved));
        return saved;
    }

    function getDefaultPrinter() {
        return readDefaultPrinter();
    }

    function setDefaultPrinter(entry) {
        return writeDefaultPrinter(entry);
    }

    function clearDefaultPrinter() {
        return writeDefaultPrinter(null);
    }

    /**
     * 接続済み（権限済み）プリンタ一覧。
     * @returns {Promise<Array<{id:string,transport:string,label:string,isDefault:boolean,device?:*,port?:*}>>}
     */
    async function listConnectedPrinters() {
        var def = readDefaultPrinter();
        var out = [];
        if (supportsNativePrinter()) {
            var plugin = getNativeEscPosPlugin();
            try {
                if (plugin && typeof plugin.requestPermissions === 'function') {
                    await plugin.requestPermissions();
                }
                var listed = plugin && typeof plugin.listBluetoothDevices === 'function'
                    ? await plugin.listBluetoothDevices()
                    : { devices: [] };
                var devices = (listed && listed.devices) || [];
                for (var bi = 0; bi < devices.length; bi += 1) {
                    var bt = devices[bi] || {};
                    var address = String(bt.address || '');
                    if (!address) {
                        continue;
                    }
                    var bid = 'bluetooth:' + address;
                    out.push({
                        id: bid,
                        transport: 'bluetooth',
                        label: String(bt.name || address),
                        address: address,
                        isDefault: !!(def && def.id === bid)
                    });
                }
            } catch (_btList) {
                /* ignore list errors; still show saved default below */
            }
            if (def && (def.transport === 'tcp' || def.transport === 'bluetooth')) {
                var already = out.some(function (row) { return row.id === def.id; });
                if (!already) {
                    out.push({
                        id: def.id,
                        transport: def.transport,
                        label: def.label || def.id,
                        address: def.address,
                        host: def.host,
                        port: def.port != null ? def.port : DEFAULT_TCP_PORT,
                        isDefault: true
                    });
                }
            }
            return out;
        }
        if (supportsUsb()) {
            var usbDevices = await global.navigator.usb.getDevices();
            for (var i = 0; i < usbDevices.length; i += 1) {
                var device = usbDevices[i];
                var id = usbPrinterId(device);
                out.push({
                    id: id,
                    transport: 'usb',
                    label: describeUsbDevice(device),
                    vendorId: device.vendorId,
                    productId: device.productId,
                    serialNumber: device.serialNumber || '',
                    isDefault: !!(def && def.id === id),
                    device: device
                });
            }
        }
        if (supportsSerial()) {
            var ports = await global.navigator.serial.getPorts();
            for (var j = 0; j < ports.length; j += 1) {
                var port = ports[j];
                var sid = serialPrinterId(port, j);
                out.push({
                    id: sid,
                    transport: 'serial',
                    label: describeSerialPort(port, j),
                    isDefault: !!(def && def.id === sid),
                    port: port
                });
            }
        }
        return out;
    }

    async function requestBluetoothPrinter(address, name) {
        if (!supportsNativePrinter()) {
            throw new Error('Bluetooth 印刷は Android アプリでのみ利用できます');
        }
        var addr = String(address || '').trim();
        if (!addr) {
            throw new Error('Bluetooth アドレスが必要です');
        }
        return {
            id: 'bluetooth:' + addr,
            transport: 'bluetooth',
            label: String(name || addr),
            address: addr
        };
    }

    function requestTcpPrinter(host, port) {
        if (!supportsNativePrinter()) {
            throw new Error('LAN/TCP 印刷は Android アプリでのみ利用できます');
        }
        var h = String(host || '').trim();
        if (!h) {
            throw new Error('プリンタのホスト（IP）が必要です');
        }
        var p = port != null && port !== '' ? Number(port) : DEFAULT_TCP_PORT;
        if (!Number.isFinite(p) || p <= 0 || p > 65535) {
            throw new Error('ポート番号が不正です');
        }
        return {
            id: 'tcp:' + h + ':' + p,
            transport: 'tcp',
            label: 'TCP ' + h + ':' + p,
            host: h,
            port: p
        };
    }

    async function requestUsbPrinter() {
        if (!supportsUsb()) {
            throw new Error('このブラウザは WebUSB に対応していません（Chrome / Edge 推奨）');
        }
        var device = await global.navigator.usb.requestDevice({
            filters: [
                { classCode: 7 },
                { vendorId: 0x04b8 },
                { vendorId: 0x0519 },
                { vendorId: 0x0fe6 },
                { vendorId: 0x1fc9 }
            ]
        });
        return {
            id: usbPrinterId(device),
            transport: 'usb',
            label: describeUsbDevice(device),
            vendorId: device.vendorId,
            productId: device.productId,
            serialNumber: device.serialNumber || '',
            device: device
        };
    }

    async function requestSerialPrinter() {
        if (!supportsSerial()) {
            throw new Error('このブラウザは Web Serial に対応していません（Chrome / Edge 推奨）');
        }
        var port = await global.navigator.serial.requestPort({ filters: [] });
        var ports = await global.navigator.serial.getPorts();
        var index = ports.indexOf(port);
        if (index < 0) {
            index = ports.length;
        }
        var info = {};
        try {
            info = typeof port.getInfo === 'function' ? (port.getInfo() || {}) : {};
        } catch (_ignored) {
            info = {};
        }
        return {
            id: serialPrinterId(port, index),
            transport: 'serial',
            label: describeSerialPort(port, index),
            vendorId: info.usbVendorId,
            productId: info.usbProductId,
            port: port
        };
    }

    function findUsbOutEndpoint(device) {
        var config = device.configuration;
        if (!config) {
            return null;
        }
        var interfaces = config.interfaces || [];
        var i;
        for (i = 0; i < interfaces.length; i += 1) {
            var iface = interfaces[i];
            var alt = iface.alternate || (iface.alternates && iface.alternates[0]);
            if (!alt || !alt.endpoints) {
                continue;
            }
            var endpoints = alt.endpoints;
            for (var e = 0; e < endpoints.length; e += 1) {
                if (endpoints[e].direction === 'out') {
                    return {
                        interfaceNumber: iface.interfaceNumber,
                        endpointNumber: endpoints[e].endpointNumber
                    };
                }
            }
        }
        return null;
    }

    async function writeUsb(device, bytes) {
        var data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
        var openedHere = false;
        var claimedIface = null;
        try {
            if (!device.opened) {
                await device.open();
                openedHere = true;
            }
            if (!device.configuration) {
                await device.selectConfiguration(1);
            }
            var ep = findUsbOutEndpoint(device);
            if (!ep) {
                throw new Error('プリンタの出力エンドポイントが見つかりません');
            }
            await device.claimInterface(ep.interfaceNumber);
            claimedIface = ep.interfaceNumber;
            for (var offset = 0; offset < data.length; offset += USB_CHUNK) {
                var chunk = data.subarray(offset, Math.min(offset + USB_CHUNK, data.length));
                var result = await device.transferOut(ep.endpointNumber, chunk);
                if (result.status !== 'ok') {
                    throw new Error('USB 転送に失敗しました (' + result.status + ')');
                }
            }
        } finally {
            try {
                if (claimedIface != null) {
                    await device.releaseInterface(claimedIface);
                }
            } catch (_release) {
                /* ignore */
            }
            try {
                if (openedHere && device.opened) {
                    await device.close();
                }
            } catch (_close) {
                /* ignore */
            }
        }
    }

    async function writeSerial(port, bytes) {
        var data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
        var openedHere = false;
        try {
            if (!port.writable) {
                await port.open({ baudRate: 9600 });
                openedHere = true;
            }
            var writer = port.writable.getWriter();
            try {
                await writer.write(data);
            } finally {
                writer.releaseLock();
            }
        } finally {
            if (openedHere) {
                try {
                    await port.close();
                } catch (_close) {
                    /* ignore */
                }
            }
        }
    }

    async function resolvePrinterTarget(preferred) {
        var want = preferred || readDefaultPrinter();
        if (want && (want.transport === 'bluetooth' || want.transport === 'tcp')) {
            return want;
        }
        var list = await listConnectedPrinters();
        if (want && want.id) {
            for (var i = 0; i < list.length; i += 1) {
                if (list[i].id === want.id) {
                    return list[i];
                }
            }
            if (want.transport === 'usb' && want.vendorId != null && want.productId != null) {
                for (var j = 0; j < list.length; j += 1) {
                    if (list[j].transport === 'usb'
                        && list[j].vendorId === want.vendorId
                        && list[j].productId === want.productId
                        && (!want.serialNumber || list[j].serialNumber === want.serialNumber)) {
                        return list[j];
                    }
                }
            }
            throw new Error('デフォルトプリンタに接続できません。アプリ設定でプリンタを選び直してください');
        }
        if (list.length === 1) {
            return list[0];
        }
        if (list.length === 0) {
            throw new Error('プリンタが接続されていません。アプリ設定でプリンタを追加してください');
        }
        throw new Error('デフォルトプリンタが未設定です。アプリ設定で選択してください');
    }

    async function printViaNative(target, data) {
        var plugin = getNativeEscPosPlugin();
        if (!plugin) {
            throw new Error('ネイティブ印刷プラグインが利用できません');
        }
        if (target.transport === 'bluetooth') {
            if (!target.address) {
                throw new Error('Bluetooth アドレスが未設定です');
            }
            await plugin.connectBluetooth({ address: String(target.address) });
        } else if (target.transport === 'tcp') {
            if (!target.host) {
                throw new Error('TCP ホストが未設定です');
            }
            await plugin.connectTcp({
                host: String(target.host),
                port: target.port != null ? Number(target.port) : DEFAULT_TCP_PORT
            });
        } else {
            throw new Error('Android では Bluetooth / LAN(TCP) のみ対応です');
        }
        try {
            await plugin.print({ dataBase64: bytesToBase64(data) });
        } finally {
            try {
                if (typeof plugin.disconnect === 'function') {
                    await plugin.disconnect();
                }
            } catch (_disc) {
                /* ignore */
            }
        }
    }

    /**
     * デフォルト（または指定）プリンタへ ESC/POS を送信。失敗時は例外。
     * @param {Uint8Array} bytes
     * @param {object} [ctx]
     * @returns {Promise<void>}
     */
    async function printOfficialReceipt(bytes, ctx) {
        var data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
        if (!data.length) {
            throw new Error('印刷データが空です');
        }
        var preferred = ctx && ctx.printer ? ctx.printer : null;
        var target = await resolvePrinterTarget(preferred);
        if (target.transport === 'bluetooth' || target.transport === 'tcp') {
            await printViaNative(target, data);
            return;
        }
        if (isNativePlatform()) {
            throw new Error('Android では Bluetooth / LAN(TCP) プリンタを設定してください');
        }
        if (target.transport === 'usb') {
            if (!target.device) {
                throw new Error('USB プリンタデバイスが見つかりません');
            }
            await writeUsb(target.device, data);
            return;
        }
        if (target.transport === 'serial') {
            if (!target.port) {
                throw new Error('シリアルポートが見つかりません');
            }
            await writeSerial(target.port, data);
            return;
        }
        throw new Error('未対応のプリンタ種別です: ' + target.transport);
    }

    global.MasterOrderStaffEscPosSdk = {
        VERSION: SDK_VERSION,
        DEFAULT_PRINTER_KEY: DEFAULT_PRINTER_KEY,
        formatYen: formatYen,
        encodeText: encodeText,
        buildOfficialReceiptBytes: buildOfficialReceiptBytes,
        downloadReceiptBytes: downloadReceiptBytes,
        isNativePlatform: isNativePlatform,
        supportsNativePrinter: supportsNativePrinter,
        supportsUsb: supportsUsb,
        supportsSerial: supportsSerial,
        listConnectedPrinters: listConnectedPrinters,
        requestUsbPrinter: requestUsbPrinter,
        requestSerialPrinter: requestSerialPrinter,
        requestBluetoothPrinter: requestBluetoothPrinter,
        requestTcpPrinter: requestTcpPrinter,
        getDefaultPrinter: getDefaultPrinter,
        setDefaultPrinter: setDefaultPrinter,
        clearDefaultPrinter: clearDefaultPrinter,
        printOfficialReceipt: printOfficialReceipt
    };
})(typeof window !== 'undefined' ? window : globalThis);
