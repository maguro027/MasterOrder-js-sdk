/**
 * MasterOrder Printer — transport IIFE
 * Web Serial は keep-open（毎回 close すると Windows CDC が死ぬ）。
 * writer を握ったまま待たない。最大 2 バースト。GS v 0 は使わない。
 * 依存: printer-codec.js（MasterOrderPrinter）
 */
(function (global) {
    'use strict';

    var P = global.MasterOrderPrinter;
    if (!P || typeof P.concatBytes !== 'function') {
        throw new Error('MasterOrderPrinter codec が先に読み込まれていません');
    }
    var SDK_VERSION = P.VERSION || '1.0.9';
    var concatBytes = P.concatBytes;

    var DEFAULT_PRINTER_KEY = 'mo.staff.defaultPrinter';
    var PACE_KEY = 'mo.staff.serialPace';
    var USB_CHUNK = 512;
    var SERIAL_CHUNK = 1024;
    var DEFAULT_TCP_PORT = 9100;
    /** マニュアルモードの入力バッファ（1 回に溜めるバイト）。大きいほうから一段下げて余裕を残す。 */
    var BUFFER_PRESETS = [512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];
    var PACE_MS_PRESETS = [50, 80, 100, 140, 180, 280, 400, 600];
    var DEFAULT_BUFFER_BYTES = 4096;
    var DEFAULT_PACE_MS = 100;
    /**
     * 実証済み搬送: keep-open / baud 9600 / 1024 書き / close しない。
     * 送信は最大 2 バースト（ロゴ → 本文）。大きい塊はバッファ単位で writer を離す。
     */
    var printBusy = false;
    var printQueueTail = Promise.resolve();
    var serialRecoverUntil = 0;

    function bufferPresetIndex(bytes) {
        var n = bytes | 0;
        var found = 0;
        var i;
        for (i = 0; i < BUFFER_PRESETS.length; i += 1) {
            if (BUFFER_PRESETS[i] <= n) {
                found = i;
            }
        }
        return found;
    }

    function snapBufferBytes(bytes) {
        return BUFFER_PRESETS[bufferPresetIndex(bytes == null ? DEFAULT_BUFFER_BYTES : bytes)];
    }

    function snapPaceMs(ms) {
        var n = ms | 0;
        var found = 0;
        var i;
        var bestDiff = 1e9;
        for (i = 0; i < PACE_MS_PRESETS.length; i += 1) {
            var diff = Math.abs(PACE_MS_PRESETS[i] - n);
            if (diff < bestDiff) {
                bestDiff = diff;
                found = i;
            }
        }
        return PACE_MS_PRESETS[found];
    }

    function defaultMsForBuffer(bytes) {
        var n = snapBufferBytes(bytes);
        if (n <= 1024) {
            return 180;
        }
        if (n <= 2048) {
            return 140;
        }
        if (n >= 32768) {
            return 50;
        }
        return DEFAULT_PACE_MS;
    }

    function formatBufferLabel(bytes) {
        var n = snapBufferBytes(bytes);
        if (n >= 1024 && n % 1024 === 0) {
            return (n / 1024) + 'KB';
        }
        return n + 'B';
    }

    function paceFromBytes(bytes, paceMsOpt) {
        var n = snapBufferBytes(bytes);
        var ms = paceMsOpt != null ? snapPaceMs(paceMsOpt) : defaultMsForBuffer(n);
        var digest = ms;
        var logo = ms >= 180 ? 1000 : (ms >= 140 ? 850 : 700);
        var recover = ms >= 180 ? 16000 : (ms >= 140 ? 12000 : 8000);
        var digestMax = ms >= 180 ? 20000 : (ms >= 140 ? 16000 : 12000);
        return {
            id: (n === DEFAULT_BUFFER_BYTES && ms === DEFAULT_PACE_MS) ? 0 : 1,
            label: formatBufferLabel(n) + '/' + ms + 'ms',
            paceBytes: n,
            paceMs: ms,
            digestPerKb: digest,
            logoPauseMs: logo,
            recoverMs: recover,
            digestMax: digestMax
        };
    }

    function emptyPaceState() {
        return {
            bufferBytes: DEFAULT_BUFFER_BYTES,
            paceBytes: DEFAULT_BUFFER_BYTES,
            candidateBytes: DEFAULT_BUFFER_BYTES,
            paceMs: DEFAULT_PACE_MS,
            calibrated: false,
            dleKnown: false,
            muteBytes: 0
        };
    }

    function readPaceState() {
        var fallback = emptyPaceState();
        try {
            var raw = global.localStorage && global.localStorage.getItem(PACE_KEY);
            if (!raw) {
                return fallback;
            }
            var parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') {
                return fallback;
            }
            var bytes = snapBufferBytes(
                parsed.bufferBytes || parsed.paceBytes || parsed.candidateBytes || DEFAULT_BUFFER_BYTES
            );
            var mapped = bytes;
            if (!(parsed.paceBytes || parsed.candidateBytes || parsed.bufferBytes) && parsed.profile != null) {
                mapped = [4096, 2048, 1024][parsed.profile | 0] || DEFAULT_BUFFER_BYTES;
            }
            var ms = parsed.paceMs != null ? snapPaceMs(parsed.paceMs) : defaultMsForBuffer(mapped);
            return {
                bufferBytes: mapped,
                paceBytes: mapped,
                candidateBytes: snapBufferBytes(parsed.candidateBytes || mapped),
                paceMs: ms,
                calibrated: !!parsed.calibrated,
                dleKnown: !!parsed.dleKnown,
                muteBytes: parsed.muteBytes | 0
            };
        } catch (_e) {
            return fallback;
        }
    }

    function writePaceState(state) {
        if (!global.localStorage) {
            return;
        }
        try {
            var bytes = snapBufferBytes(state && (state.bufferBytes || state.paceBytes));
            var ms = state && state.paceMs != null ? snapPaceMs(state.paceMs) : defaultMsForBuffer(bytes);
            global.localStorage.setItem(PACE_KEY, JSON.stringify({
                bufferBytes: bytes,
                paceBytes: bytes,
                candidateBytes: snapBufferBytes(state && state.candidateBytes || bytes),
                paceMs: ms,
                calibrated: !!(state && state.calibrated),
                dleKnown: !!(state && state.dleKnown),
                muteBytes: (state && state.muteBytes) | 0
            }));
        } catch (_e) {
            /* quota / private mode */
        }
    }

    function currentPace() {
        var state = readPaceState();
        var bytes = state.calibrated
            ? (state.bufferBytes || state.paceBytes)
            : (state.candidateBytes || state.bufferBytes || state.paceBytes || DEFAULT_BUFFER_BYTES);
        return paceFromBytes(bytes, state.paceMs);
    }

    function markDleKnown() {
        var state = readPaceState();
        if (state.dleKnown) {
            return;
        }
        state.dleKnown = true;
        writePaceState(state);
    }

    function stepDownCandidate(jobBytes) {
        var state = readPaceState();
        var from = state.calibrated
            ? (state.bufferBytes || state.paceBytes)
            : (state.candidateBytes || state.bufferBytes || state.paceBytes);
        var next = BUFFER_PRESETS[Math.max(0, bufferPresetIndex(from) - 1)];
        state.bufferBytes = next;
        state.candidateBytes = next;
        state.paceBytes = next;
        state.calibrated = false;
        state.dleKnown = true;
        state.muteBytes = jobBytes | 0;
        writePaceState(state);
        return paceFromBytes(next, state.paceMs);
    }

    function lockWithHeadroom(testedBytes) {
        var locked = BUFFER_PRESETS[Math.max(0, bufferPresetIndex(testedBytes) - 1)];
        var state = readPaceState();
        state.bufferBytes = locked;
        state.candidateBytes = locked;
        state.paceBytes = locked;
        state.calibrated = true;
        writePaceState(state);
        return paceFromBytes(locked, state.paceMs);
    }

    function describeSerialPace() {
        var state = readPaceState();
        var pace = currentPace();
        var buf = formatBufferLabel(pace.paceBytes);
        if (!state.calibrated) {
            return 'マニュアル送り: バッファ ' + buf + '、間隔 ' + pace.paceMs
                + 'ms。印刷調整で黒い帯と格子を出すと、成功サイズから一段余裕を残して固定します。';
        }
        return 'バッファ ' + buf + ' / 間隔 ' + pace.paceMs
            + 'ms で固定しています。測り直すと 4KB / 100ms からやり直しです。';
    }

    function isSerialPaceAdjusted() {
        var state = readPaceState();
        var pace = currentPace();
        return !!state.calibrated
            || pace.paceBytes !== DEFAULT_BUFFER_BYTES
            || pace.paceMs !== DEFAULT_PACE_MS;
    }

    function resetSerialPace() {
        var state = readPaceState();
        state.bufferBytes = DEFAULT_BUFFER_BYTES;
        state.paceBytes = DEFAULT_BUFFER_BYTES;
        state.candidateBytes = DEFAULT_BUFFER_BYTES;
        state.paceMs = DEFAULT_PACE_MS;
        state.calibrated = false;
        state.muteBytes = 0;
        writePaceState(state);
        return paceFromBytes(DEFAULT_BUFFER_BYTES, DEFAULT_PACE_MS);
    }

    function setManualBufferPace(bufferBytes, paceMs) {
        var state = readPaceState();
        var bytes = snapBufferBytes(bufferBytes == null ? state.bufferBytes : bufferBytes);
        var ms = snapPaceMs(paceMs == null ? state.paceMs : paceMs);
        state.bufferBytes = bytes;
        state.paceBytes = bytes;
        state.candidateBytes = bytes;
        state.paceMs = ms;
        state.calibrated = false;
        writePaceState(state);
        return paceFromBytes(bytes, ms);
    }

    function applyShopPrinterSettings(shop) {
        if (!shop || typeof shop !== 'object') {
            return currentPace();
        }
        if (shop.printerMode) {
            try {
                if (typeof P.setPrinterMode === 'function') {
                    P.setPrinterMode(shop.printerMode);
                }
            } catch (_e) {
                /* ignore unknown / storage */
            }
        }
        if (shop.printerLanUrl != null && typeof P.setPrinterLanUrl === 'function') {
            try {
                P.setPrinterLanUrl(shop.printerLanUrl);
            } catch (_e) {
                /* ignore */
            }
        }
        var hasBuffer = shop.printerBufferBytes != null;
        var hasPace = shop.printerPaceMs != null;
        if (!hasBuffer && !hasPace) {
            return currentPace();
        }
        var state = readPaceState();
        var bytes = hasBuffer ? snapBufferBytes(shop.printerBufferBytes) : state.bufferBytes;
        var ms = hasPace ? snapPaceMs(shop.printerPaceMs) : state.paceMs;
        state.bufferBytes = bytes;
        state.paceBytes = bytes;
        state.candidateBytes = bytes;
        state.paceMs = ms;
        state.calibrated = true;
        writePaceState(state);
        return paceFromBytes(bytes, ms);
    }

    function exportShopPrinterSettings() {
        var pace = currentPace();
        return {
            printerMode: typeof P.getPrinterMode === 'function' ? P.getPrinterMode() : 'escpos-manual',
            printerBufferBytes: pace.paceBytes,
            printerPaceMs: pace.paceMs,
            printerLanUrl: typeof P.getPrinterLanUrl === 'function' ? (P.getPrinterLanUrl() || '') : ''
        };
    }

    function shouldStepDownForError(err) {
        var text = errorText(err);
        if (/カバー|紙なし|復帰不能|印刷データが空|前のレシートを印字中|USB は繋がったまま本体が止まっています/.test(text)) {
            return false;
        }
        return true;
    }

    function defaultConfirmPrintSuccess(info) {
        if (typeof global.confirm !== 'function') {
            return true;
        }
        return global.confirm((info && info.message) || '印刷は成功しましたか？');
    }

    function beginSerialPaceCalibration() {
        var state = readPaceState();
        if (state.calibrated) {
            resetSerialPace();
        }
        return currentPace();
    }

    async function maybeConfirmAndLockPace(ctx) {
        if (!(ctx && ctx.calibrate)) {
            return;
        }
        var tested = currentPace().paceBytes;
        var ask = ctx && typeof ctx.confirmPrintSuccess === 'function'
            ? ctx.confirmPrintSuccess
            : defaultConfirmPrintSuccess;
        var message = (ctx && ctx.calibrateMessage)
            || '印刷は成功しましたか？\n\n紙が最後まで出てカットされているか見てください。\n途中で止まった・警告ランプが点いた・セルフテストが出た場合は「キャンセル」を押してください。';
        var ok = await Promise.resolve(ask({
            testedBytes: tested,
            message: message
        }));
        if (!ok) {
            var smaller = stepDownCandidate(0);
            throw new Error('紙面では失敗と回答されたので、バッファを ' + formatBufferLabel(smaller.paceBytes) + ' に下げました。印刷調整を再実行してください。');
        }
        if (ctx.lockPace === false) {
            return;
        }
        var locked = lockWithHeadroom(tested);
        if (typeof console !== 'undefined' && console.info) {
            console.info('[escpos] pace locked with headroom', 'tested=', tested, 'use=', locked.paceBytes);
        }
    }

    function enqueuePrintJob(task) {
        var run = printQueueTail.catch(function () {
            /* keep queue alive after failures */
        }).then(task);
        printQueueTail = run.catch(function () {
            /* swallow for queue continuity */
        });
        return run;
    }

    /**
     * 印字ヘッドが追いつくまでの待機。ジョブ全体のバイト数で見る。
     * ESC* ビットマップは USB 転送より遥かに遅い。2800ms だと連続 4 枚目で CDC が溢れた。
     * writer を離したあとに呼ぶこと。
     */
    function postWriteDigestMs(byteLength, paceOpt) {
        var pace = paceOpt || currentPace();
        var n = byteLength | 0;
        var ms = Math.ceil(n * pace.digestPerKb / 1000);
        if (ms < 500) {
            return 500;
        }
        if (ms > pace.digestMax) {
            return pace.digestMax;
        }
        return ms;
    }

    /**
     * page.close / F5 が効く理由と同じ：USB-CDC セッションを切らずに DTR だけ落とす。
     * port.close() は Windows CDC を殺すので使わない。
     */
    async function pulseSerialDtr(port) {
        if (!port || typeof port.setSignals !== 'function') {
            return false;
        }
        try {
            await port.setSignals({ dataTerminalReady: false, requestToSend: false });
            await sleepMs(300);
            await port.setSignals({ dataTerminalReady: true, requestToSend: true });
            if (typeof console !== 'undefined' && console.info) {
                console.info('[escpos] serial DTR pulse (MCU reset without page reload)');
            }
            return true;
        } catch (err) {
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('[escpos] serial DTR pulse failed', err && err.message);
            }
            return false;
        }
    }

    async function waitSerialRecover() {
        var left = serialRecoverUntil - Date.now();
        if (left > 0) {
            if (typeof console !== 'undefined' && console.info) {
                console.info('[escpos] serial recover wait', left, 'ms');
            }
            await sleepMs(left);
        }
    }

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

    function normalizePrintParts(input) {
        if (Array.isArray(input)) {
            return input.filter(function (part) {
                return part && part.length;
            });
        }
        if (input && typeof input === 'object' && Array.isArray(input.parts)) {
            return input.parts.filter(function (part) {
                return part && part.length;
            });
        }
        if (input instanceof Uint8Array) {
            return input.length ? [input] : [];
        }
        var data = new Uint8Array(input || []);
        return data.length ? [data] : [];
    }

    function keepManyBursts(ctx) {
        return !!(ctx && (ctx.calibrate || ctx.keepBursts));
    }

    /**
     * 細切れはバッファ溢れと二重送信の温床。ロゴ＋本文の 2 塊までに畳む。
     * 印刷調整は例外（塊ごとに生存確認する）。
     */
    function collapseToTwoBursts(parts) {
        var list = [];
        var i;
        for (i = 0; i < (parts || []).length; i += 1) {
            var part = parts[i] instanceof Uint8Array ? parts[i] : new Uint8Array(parts[i] || []);
            if (part.length) {
                list.push(part);
            }
        }
        if (list.length <= 2) {
            return list;
        }
        return [list[0], concatBytes(list.slice(1))];
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

    function supportsWebBluetooth() {
        return !!(global.navigator
            && global.navigator.bluetooth
            && typeof global.navigator.bluetooth.requestDevice === 'function');
    }

    /** Serial Port Profile。Windows はペアリング済み 58E などを COM ポートとして出す。 */
    var SERIAL_PORT_PROFILE_UUID = '00001101-0000-1000-8000-00805f9b34fb';

    function supportsBluetooth() {
        if (supportsNativePrinter() || supportsWebBluetooth()) {
            return true;
        }
        return !isNativePlatform() && supportsSerial();
    }

    function isBluetoothSerialPort(port) {
        var info = serialPortInfo(port);
        return !!(info && info.bluetoothServiceClassId);
    }

    /**
     * 安価な 58mm BLE レシート機でよく使う GATT サービス。
     * requestDevice の optionalServices に入れないと接続後に特性を読めない。
     */
    function blePrinterServiceUuids() {
        var list = [
            '000018f0-0000-1000-8000-00805f9b34fb',
            'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
            '49535343-fe7d-4ae5-8fa9-9fafd205e455',
            '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
            '0000ff00-0000-1000-8000-00805f9b34fb',
            '0000ffe0-0000-1000-8000-00805f9b34fb',
            '0000fff0-0000-1000-8000-00805f9b34fb',
            '0000ae30-0000-1000-8000-00805f9b34fb',
            '0000af00-0000-1000-8000-00805f9b34fb',
            '0000ff10-0000-1000-8000-00805f9b34fb'
        ];
        var i;
        for (i = 0; i <= 0x20; i += 1) {
            list.push('0000ff' + ('00' + i.toString(16)).slice(-2) + '-0000-1000-8000-00805f9b34fb');
        }
        return list;
    }

    function webBluetoothPrinterId(device) {
        return 'bluetooth:' + String(device && device.id != null ? device.id : '');
    }

    var bleWriteCache = {};
    var bleDeviceCache = {};

    function rememberBleDevice(device) {
        if (device && device.id) {
            bleDeviceCache[String(device.id)] = device;
        }
        return device;
    }

    function describeBleDevice(device) {
        var name = device && device.name ? String(device.name).trim() : '';
        return name || 'Bluetooth プリンタ';
    }

    function hex4(n) {
        return ('0000' + (Number(n) & 0xffff).toString(16)).slice(-4);
    }

    function usbPrinterId(device) {
        return 'usb:' + hex4(device.vendorId) + ':' + hex4(device.productId)
            + ':' + String(device.serialNumber || '');
    }

    function serialPortInfo(port) {
        try {
            return (port && typeof port.getInfo === 'function' ? (port.getInfo() || {}) : {}) || {};
        } catch (_ignored) {
            return {};
        }
    }

    function serialPrinterId(port, index) {
        var info = serialPortInfo(port);
        if (info.usbVendorId != null && info.usbProductId != null) {
            return 'serial:' + hex4(info.usbVendorId) + ':' + hex4(info.usbProductId);
        }
        if (info.bluetoothServiceClassId) {
            return 'serial:bt:' + String(info.bluetoothServiceClassId) + ':' + String(index != null ? index : 0);
        }
        return 'serial:port-' + String(index != null ? index : 0);
    }

    function isIndexOnlySerialId(id) {
        return /^serial:port-\d+$/i.test(String(id || ''));
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
        var info = serialPortInfo(port);
        if (info.bluetoothServiceClassId) {
            return 'Bluetooth プリンタ';
        }
        if (info.usbVendorId != null && info.usbProductId != null) {
            return 'シリアル ' + hex4(info.usbVendorId) + ':' + hex4(info.usbProductId);
        }
        return 'シリアルポート ' + String((index != null ? index : 0) + 1);
    }

    function serialEntryFromPort(port, index, labelOverride) {
        var info = serialPortInfo(port);
        var bluetoothSerial = isBluetoothSerialPort(port);
        return {
            id: serialPrinterId(port, index),
            transport: 'serial',
            bluetoothSerial: bluetoothSerial,
            label: labelOverride || describeSerialPort(port, index),
            vendorId: info.usbVendorId,
            productId: info.usbProductId,
            port: port
        };
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
            port: entry.port != null ? Number(entry.port) : undefined,
            bluetoothSerial: entry.bluetoothSerial ? true : undefined
        };
        global.localStorage.setItem(DEFAULT_PRINTER_KEY, JSON.stringify(saved));
        return saved;
    }

    function getDefaultPrinter() {
        return readDefaultPrinter();
    }

    function setDefaultPrinter(entry) {
        var saved = writeDefaultPrinter(entry);
        if (saved && saved.transport && typeof P.getPrinterMode === 'function'
            && typeof P.setPrinterMode === 'function'
            && P.getPrinterMode() === 'windows-driver') {
            try {
                P.setPrinterMode('escpos-manual');
            } catch (_mode) {
                /* モード切替に失敗してもデフォルト保存は残す */
            }
        }
        return saved;
    }

    function clearDefaultPrinter() {
        return writeDefaultPrinter(null);
    }

    /**
     * このブラウザの許可から外す。keep-open の例外で、削除時だけ close → forget。
     * @param {{id?:string,transport?:string,port?:*,device?:*}} target
     */
    async function forgetPrinter(target) {
        var row = target || {};
        if (row.transport === 'serial' && row.port) {
            try {
                if (row.port.writable && typeof row.port.close === 'function') {
                    await row.port.close();
                }
            } catch (_close) {
                /* forget を優先 */
            }
            if (typeof row.port.forget === 'function') {
                await row.port.forget();
            }
        } else if (row.transport === 'usb' && row.device) {
            try {
                if (row.device.opened && typeof row.device.close === 'function') {
                    await row.device.close();
                }
            } catch (_close) {
                /* forget を優先 */
            }
            if (typeof row.device.forget === 'function') {
                await row.device.forget();
            }
        } else if (row.transport === 'bluetooth') {
            var bleId = row.address || (row.id ? String(row.id).replace(/^bluetooth:/i, '') : '');
            if (bleId) {
                delete bleWriteCache[bleId];
                delete bleDeviceCache[bleId];
            }
            if (supportsNativePrinter()) {
                try {
                    var plugin = getNativeEscPosPlugin();
                    if (plugin && typeof plugin.disconnect === 'function') {
                        await plugin.disconnect();
                    }
                } catch (_discNative) {
                    /* forget を優先 */
                }
            }
            try {
                if (row.device && row.device.gatt && row.device.gatt.connected) {
                    row.device.gatt.disconnect();
                }
            } catch (_disc) {
                /* forget を優先 */
            }
            if (row.device && typeof row.device.forget === 'function') {
                await row.device.forget();
            } else if (supportsWebBluetooth() && bleId && global.navigator.bluetooth.getDevices) {
                try {
                    var granted = await global.navigator.bluetooth.getDevices();
                    for (var gi = 0; gi < granted.length; gi += 1) {
                        if (granted[gi] && granted[gi].id === bleId && typeof granted[gi].forget === 'function') {
                            await granted[gi].forget();
                            break;
                        }
                    }
                } catch (_forgetBle) {
                    /* ignore */
                }
            }
        }
        var def = readDefaultPrinter();
        if (def && row.id && def.id === row.id) {
            writeDefaultPrinter(null);
        }
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
            try {
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
            } catch (_usbList) {
                /* Permissions-Policy 欠落などで失敗してもシリアルは続ける */
            }
        }
        if (supportsSerial()) {
            try {
                var ports = await global.navigator.serial.getPorts();
                for (var j = 0; j < ports.length; j += 1) {
                    var serialRow = serialEntryFromPort(ports[j], j);
                    serialRow.isDefault = !!(def && def.id === serialRow.id);
                    out.push(serialRow);
                }
            } catch (_serialList) {
                /* ignore */
            }
        }
        if (supportsWebBluetooth()) {
            try {
                var bleDevices = typeof global.navigator.bluetooth.getDevices === 'function'
                    ? await global.navigator.bluetooth.getDevices()
                    : [];
                for (var bi = 0; bi < bleDevices.length; bi += 1) {
                    var bleDev = bleDevices[bi];
                    if (!bleDev || !bleDev.id) {
                        continue;
                    }
                    var bleId = webBluetoothPrinterId(bleDev);
                    rememberBleDevice(bleDev);
                    out.push({
                        id: bleId,
                        transport: 'bluetooth',
                        label: describeBleDevice(bleDev),
                        address: String(bleDev.id),
                        isDefault: !!(def && def.id === bleId),
                        device: bleDev
                    });
                }
            } catch (_bleList) {
                /* ignore list errors; still show saved default below */
            }
        }
        if (def && def.id) {
            var alreadySaved = out.some(function (row) {
                return row.id === def.id;
            });
            if (!alreadySaved) {
                out.push({
                    id: def.id,
                    transport: def.transport,
                    label: def.label || def.id,
                    vendorId: def.vendorId,
                    productId: def.productId,
                    serialNumber: def.serialNumber,
                    address: def.address,
                    host: def.host,
                    port: def.port,
                    bluetoothSerial: !!def.bluetoothSerial,
                    isDefault: true,
                    disconnected: true
                });
            }
        }
        return out;
    }

    async function requestWebBluetoothPrinter(address, name) {
        if (!supportsWebBluetooth()) {
            throw new Error('このブラウザは Web Bluetooth に対応していません。PC では Windows でプリンタをペアリングしてから「Bluetooth を追加」を使うか、Android の Chrome / Staff アプリを使ってください。');
        }
        var want = String(address || '').trim();
        if (want && typeof global.navigator.bluetooth.getDevices === 'function') {
            var granted = await global.navigator.bluetooth.getDevices();
            var gi;
            for (gi = 0; gi < granted.length; gi += 1) {
                if (granted[gi] && (granted[gi].id === want || webBluetoothPrinterId(granted[gi]) === want)) {
                    rememberBleDevice(granted[gi]);
                    return {
                        id: webBluetoothPrinterId(granted[gi]),
                        transport: 'bluetooth',
                        label: name ? String(name) : describeBleDevice(granted[gi]),
                        address: String(granted[gi].id),
                        device: granted[gi]
                    };
                }
            }
        }
        var device = await global.navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: blePrinterServiceUuids()
        });
        if (!device || !device.id) {
            throw new Error('プリンタが選択されませんでした');
        }
        rememberBleDevice(device);
        return {
            id: webBluetoothPrinterId(device),
            transport: 'bluetooth',
            label: name ? String(name) : describeBleDevice(device),
            address: String(device.id),
            device: device
        };
    }

    async function requestBluetoothSerialPrinter() {
        if (!supportsSerial()) {
            throw new Error('このブラウザは Web Serial に対応していません（Chrome / Edge 推奨）');
        }
        var port;
        try {
            port = await global.navigator.serial.requestPort({
                filters: [{ bluetoothServiceClassId: SERIAL_PORT_PROFILE_UUID }]
            });
        } catch (err) {
            if (err && (err.name === 'TypeError' || err.name === 'NotFoundError')) {
                port = await global.navigator.serial.requestPort({ filters: [] });
            } else {
                throw err;
            }
        }
        var ports = await global.navigator.serial.getPorts();
        var index = ports.indexOf(port);
        if (index < 0) {
            index = ports.length;
        }
        var entry = serialEntryFromPort(port, index, 'Bluetooth プリンタ');
        entry.bluetoothSerial = true;
        return entry;
    }

    async function requestBluetoothPrinter(address, name, opts) {
        if (supportsNativePrinter()) {
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
        if (opts && opts.ble) {
            return requestWebBluetoothPrinter(address, name);
        }
        if (String(address || '').trim()) {
            return requestWebBluetoothPrinter(address, name);
        }
        if (supportsSerial()) {
            return requestBluetoothSerialPrinter();
        }
        return requestWebBluetoothPrinter(address, name);
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
            filters: []
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
        return serialEntryFromPort(port, index);
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

    function sleepMs(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    function hexBytes(bytes) {
        var data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
        var out = [];
        var i;
        for (i = 0; i < data.length; i += 1) {
            out.push(('0' + data[i].toString(16)).slice(-2));
        }
        return out.join(' ');
    }

    function isLikelyDleEotByte(b) {
        return (b & 0x12) === 0x12 && (b & 0x81) === 0;
    }

    function decodeDleEotNotes(kind, b) {
        var notes = [];
        if (kind === 1) {
            if (b & 0x08) {
                notes.push('オフライン');
            }
        } else if (kind === 2) {
            if (b & 0x04) {
                notes.push('カバーオープン');
            }
            if (b & 0x20) {
                notes.push('紙なしで印字停止');
            }
            if (b & 0x40) {
                notes.push('エラーで停止');
            }
        } else if (kind === 3) {
            if (b & 0x04) {
                notes.push('復帰可能なメカエラー');
            }
            if (b & 0x08) {
                notes.push('オートカッターエラー');
            }
            if (b & 0x20) {
                notes.push('復帰不能エラー');
            }
            if (b & 0x40) {
                notes.push('ヘッド温度エラー（自動復帰待ち）');
            }
        } else if (kind === 4) {
            if (b & 0x0c) {
                notes.push('紙残りわずか');
            }
            if (b & 0x60) {
                notes.push('紙なし');
            }
        }
        return notes;
    }

    /**
     * 読み取りは keep-open のまま。cancel しない（stream を殺す）。
     * timeout 中の pending read は releaseLock で切る。
     */
    async function readSerialAvailable(port, waitMs) {
        if (!port || !port.readable) {
            return new Uint8Array(0);
        }
        var reader = port.readable.getReader();
        var chunks = [];
        try {
            var deadline = Date.now() + Math.max(40, waitMs | 0);
            while (Date.now() < deadline) {
                var left = deadline - Date.now();
                var timedOut = false;
                var result = await Promise.race([
                    reader.read().catch(function () {
                        return { done: true, value: null };
                    }),
                    sleepMs(left).then(function () {
                        timedOut = true;
                        return null;
                    })
                ]);
                if (timedOut || !result) {
                    break;
                }
                if (result.done) {
                    break;
                }
                if (result.value && result.value.length) {
                    chunks.push(result.value instanceof Uint8Array
                        ? result.value
                        : new Uint8Array(result.value));
                    deadline = Math.min(deadline, Date.now() + 50);
                }
            }
        } finally {
            try {
                reader.releaseLock();
            } catch (_release) {
                /* ignore */
            }
        }
        return chunks.length ? concatBytes(chunks) : new Uint8Array(0);
    }

    async function querySerialPrinterStatus(port, phase) {
        var report = {
            phase: phase || 'status',
            replies: [],
            notes: [],
            noReply: true
        };
        if (!port) {
            return report;
        }
        try {
            if (typeof port.getSignals === 'function') {
                var signals = await port.getSignals();
                if (typeof console !== 'undefined' && console.info) {
                    console.info(
                        '[escpos] serial signals',
                        phase,
                        'CTS=' + !!signals.clearToSend,
                        'DSR=' + !!signals.dataSetReady,
                        '(USB-CDC はフロー制御なしが多い)'
                    );
                }
            }
        } catch (_sig) {
            /* 非対応機種 */
        }
        await readSerialAvailable(port, 40);
        var kinds = [
            { n: 1, name: 'printer' },
            { n: 2, name: 'offline' },
            { n: 3, name: 'error' },
            { n: 4, name: 'paper' }
        ];
        var k;
        for (k = 0; k < kinds.length; k += 1) {
            await writeSerialBytes(port, new Uint8Array([0x10, 0x04, kinds[k].n]));
            var reply = await readSerialAvailable(port, 300);
            var entry = {
                name: kinds[k].name,
                n: kinds[k].n,
                hex: hexBytes(reply),
                notes: []
            };
            if (reply.length) {
                report.noReply = false;
                var bi;
                for (bi = 0; bi < reply.length; bi += 1) {
                    var b = reply[bi];
                    if (!isLikelyDleEotByte(b)) {
                        entry.notes.push('未対応応答 0x' + ('0' + b.toString(16)).slice(-2));
                        continue;
                    }
                    var decoded = decodeDleEotNotes(kinds[k].n, b);
                    if (decoded.length) {
                        entry.notes = entry.notes.concat(decoded);
                    } else {
                        entry.notes.push('正常');
                    }
                }
            } else {
                entry.notes.push('応答なし');
            }
            report.replies.push(entry);
            report.notes = report.notes.concat(entry.notes.filter(function (note) {
                return note !== '正常' && note !== '応答なし';
            }));
        }
        if (typeof console !== 'undefined' && console.info) {
            var parts = [];
            var ri;
            for (ri = 0; ri < report.replies.length; ri += 1) {
                var entryLog = report.replies[ri];
                parts.push(entryLog.name + '=' + (entryLog.hex || '-') + ' ' + (entryLog.notes || []).join(','));
            }
            console.info(
                '[escpos] printer status',
                phase,
                report.noReply ? 'no-reply' : (report.notes.join(' / ') || 'ok'),
                parts.join(' | ')
            );
        }
        return report;
    }

    function serialStatusErrorMessage(report) {
        if (!report || report.noReply) {
            return '';
        }
        var serious = (report.notes || []).filter(function (note) {
            return note.indexOf('紙残りわずか') < 0 && note.indexOf('未対応応答') < 0;
        });
        if (!serious.length) {
            return '';
        }
        return 'プリンタ状態: ' + serious.join('、');
    }

    function errorText(err) {
        if (!err) {
            return '';
        }
        var name = err.name ? String(err.name) : '';
        var msg = err.message ? String(err.message) : String(err);
        return (name + ' ' + msg).trim();
    }

    function mapUsbTransportError(err) {
        var text = errorText(err);
        if (/access denied/i.test(text)) {
            return new Error('USB プリンタを開けません（Access denied）。アプリ設定で「シリアル」接続に切り替えるか、Windows のプリンタ登録を解除してください。');
        }
        if (/device state is in progress/i.test(text)) {
            return new Error('USB プリンタの接続処理がまだ終わっていません。数秒待ってから再試行してください。');
        }
        if (/unknown system error|device has been lost|NetworkError|NotFoundError/i.test(text)) {
            return new Error('プリンタ接続が不安定です。USB を抜き 10 秒待って差し直し、ページを再読み込みしてから再試行してください。');
        }
        return err instanceof Error ? err : new Error(text || 'USB 印刷に失敗しました');
    }

    function mapSerialTransportError(err) {
        var text = errorText(err);
        if (/already in progress|Failed to open serial port/i.test(text)) {
            return new Error('シリアルポートの接続処理がまだ終わっていません。数秒待ってから再試行してください。');
        }
        if (/unknown system error|device has been lost|NetworkError|NotFoundError|InvalidStateError/i.test(text)) {
            return new Error('プリンタ接続が不安定です。前のレシートの印字が終わるまで待ってから再試行してください。まだ出る場合はページ再読み込みしてください。');
        }
        return err instanceof Error ? err : new Error(text || 'シリアル印刷に失敗しました');
    }

    /**
     * 1 バーストを 1024 バイトずつ書く。
     * 大きい塊はプロファイル単位で releaseLock してから待つ（握ったまま待たない）。
     * port.close() もしない。keep-open。
     */
    async function writeSerialBytes(port, data, ctx) {
        if (!data || !data.length) {
            return;
        }
        var pace = currentPace();
        var sliceWait = (ctx && ctx.calibrate) ? Math.max(pace.paceMs, 280) : pace.paceMs;
        var offset = 0;
        while (offset < data.length) {
            var end = Math.min(offset + pace.paceBytes, data.length);
            var slice = data.subarray(offset, end);
            var writer = port.writable.getWriter();
            try {
                var i;
                for (i = 0; i < slice.length; i += SERIAL_CHUNK) {
                    await writer.write(slice.subarray(i, Math.min(i + SERIAL_CHUNK, slice.length)));
                }
            } finally {
                writer.releaseLock();
            }
            offset = end;
            if (offset < data.length) {
                await sleepMs(sliceWait);
            }
        }
    }

    async function ensureSerialOpen(port) {
        if (port.writable) {
            return;
        }
        if (typeof console !== 'undefined' && console.info) {
            console.info('[escpos] serial open baud=9600');
        }
        try {
            await port.open({ baudRate: 9600 });
        } catch (openErr) {
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('[escpos] serial open retry', openErr && openErr.name, openErr && openErr.message);
            }
            await sleepMs(600);
            if (!port.writable) {
                await port.open({ baudRate: 9600 });
            }
        }
        if (!port.writable) {
            throw new Error('シリアルポートを開けませんでした');
        }
        try {
            if (typeof port.setSignals === 'function') {
                await port.setSignals({ dataTerminalReady: true, requestToSend: true });
            }
        } catch (_signals) {
            /* CDC によっては非対応 */
        }
    }

    function skipSerialStatusQuery(port) {
        if (isBluetoothSerialPort(port)) {
            return true;
        }
        var info = serialPortInfo(port);
        if (info && info.usbVendorId != null) {
            return false;
        }
        var def = readDefaultPrinter();
        return !!(def && def.bluetoothSerial && def.transport === 'serial');
    }

    async function serialSendOnce(port, parts, ctx) {
        var list = keepManyBursts(ctx) ? normalizePrintParts(parts) : collapseToTwoBursts(parts);
        var i;
        var totalBytes = 0;
        if (!list.length) {
            throw new Error('印刷データが空です');
        }
        for (i = 0; i < list.length; i += 1) {
            totalBytes += list[i].length;
        }
        var stepped = false;
        try {
            await ensureSerialOpen(port);
            await waitSerialRecover();
            var pace = currentPace();
            if (typeof console !== 'undefined' && console.info) {
                console.info('[escpos] serial pace', pace.label, pace.paceBytes + 'B/' + pace.paceMs + 'ms');
            }
            var skipStatus = skipSerialStatusQuery(port);
            var before = skipStatus
                ? { noReply: true }
                : await querySerialPrinterStatus(port, 'before');
            if (!skipStatus && before.noReply && readPaceState().dleKnown) {
                await pulseSerialDtr(port);
                await sleepMs(1500);
                before = await querySerialPrinterStatus(port, 'before-reset');
                if (before.noReply) {
                    throw new Error('プリンタが応答しません。USB は繋がったまま本体が止まっています。ページ再読み込みか USB 抜き差しをしてください。');
                }
            }
            if (!before.noReply) {
                markDleKnown();
            }
            var beforeErr = serialStatusErrorMessage(before);
            if (beforeErr && /カバー|紙なし|復帰不能/.test(beforeErr)) {
                throw new Error(beforeErr);
            }
            for (i = 0; i < list.length; i += 1) {
                if (typeof console !== 'undefined' && console.info) {
                    console.info('[escpos] serial burst', i + 1, '/', list.length, 'bytes=', list[i].length);
                }
                await writeSerialBytes(port, list[i], ctx);
                var waitMs = Math.max(
                    (i < list.length - 1) ? pace.logoPauseMs : 0,
                    postWriteDigestMs(list[i].length, pace)
                );
                if (ctx && ctx.calibrate) {
                    waitMs = Math.max(waitMs, 1200);
                }
                if (typeof console !== 'undefined' && console.info) {
                    console.info('[escpos] serial burst done; wait', waitMs, 'ms');
                }
                await sleepMs(waitMs);
                if (!skipStatus && !before.noReply) {
                    var mid = await querySerialPrinterStatus(port, 'burst-' + (i + 1));
                    var midErr = serialStatusErrorMessage(mid);
                    if (midErr && /カバー|紙なし|復帰不能/.test(midErr)) {
                        throw new Error(midErr);
                    }
                    if (mid.noReply) {
                        if (!(ctx && ctx.skipPaceAdjust)) {
                            stepDownCandidate(list[i].length);
                            stepped = true;
                        }
                        await pulseSerialDtr(port);
                        await sleepMs(1500);
                        throw new Error('印字の途中（' + (i + 1) + '/' + list.length + '）でプリンタが応答しなくなりました。受信バッファ溢れです。送りを小さくして再実行します。');
                    }
                }
            }
            if (skipStatus) {
                if (typeof console !== 'undefined' && console.info) {
                    console.info('[escpos] skip DLE status on Bluetooth serial');
                }
            } else {
            var after = await querySerialPrinterStatus(port, 'after');
            var afterErr = serialStatusErrorMessage(after);
            if (afterErr) {
                throw new Error(afterErr + '（PC側の送信は完了しています。紙が途中で止まっているならプリンタ本体の状態です）');
            }
            if (after.noReply && !before.noReply) {
                var skipAdjust = !!(ctx && ctx.skipPaceAdjust);
                var nextPace = skipAdjust ? currentPace() : stepDownCandidate(totalBytes);
                if (!skipAdjust) {
                    stepped = true;
                }
                await pulseSerialDtr(port);
                await sleepMs(1500);
                after = await querySerialPrinterStatus(port, 'after-reset');
                serialRecoverUntil = Date.now() + currentPace().recoverMs;
                var paceNote = skipAdjust ? '' : (' 次回は ' + nextPace.paceBytes + 'B で送ります。');
                if (after.noReply) {
                    throw new Error('印字後にプリンタが応答しません。受信バッファ溢れです。' + paceNote + '警告ランプを確認し、まだ点灯していればページ再読み込みか USB 抜き差しをしてください。');
                }
                throw new Error('印字が途中で止まった可能性があります。' + paceNote + '紙を確認してから再印刷してください。');
            }
            if (after.noReply && before.noReply && typeof console !== 'undefined' && console.warn) {
                console.warn('[escpos] printer status no-reply before and after — DLE EOT 非対応の可能性');
            }
            }
        } catch (err) {
            if (!stepped && !(ctx && ctx.skipPaceAdjust) && shouldStepDownForError(err)) {
                stepDownCandidate(totalBytes);
                stepped = true;
            }
            serialRecoverUntil = Date.now() + currentPace().recoverMs;
            if (typeof console !== 'undefined' && console.error) {
                console.error('[escpos] serial raw error', err && err.name, err && err.message, err);
            }
            throw mapSerialTransportError(err);
        }
    }

    async function usbSendOnce(device, parts) {
        var list = collapseToTwoBursts(parts);
        var i;
        var totalBytes = 0;
        if (!list.length) {
            throw new Error('印刷データが空です');
        }
        for (i = 0; i < list.length; i += 1) {
            totalBytes += list[i].length;
        }
        var claimedIface = null;
        try {
            if (!device.opened) {
                await device.open();
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
            var pace = currentPace();
            for (i = 0; i < list.length; i += 1) {
                var data = list[i];
                var offset = 0;
                while (offset < data.length) {
                    var sliceEnd = Math.min(offset + pace.paceBytes, data.length);
                    while (offset < sliceEnd) {
                        var chunk = data.subarray(offset, Math.min(offset + USB_CHUNK, sliceEnd));
                        var result = await device.transferOut(ep.endpointNumber, chunk);
                        if (result.status !== 'ok') {
                            throw new Error('USB 転送に失敗しました (' + result.status + ')');
                        }
                        offset += chunk.length;
                    }
                    if (offset < data.length) {
                        await sleepMs(pace.paceMs);
                    }
                }
                var waitMs = (i < list.length - 1) ? pace.logoPauseMs : postWriteDigestMs(totalBytes, pace);
                await sleepMs(waitMs);
            }
        } catch (err) {
            if (typeof console !== 'undefined' && console.error) {
                console.error('[escpos] usb raw error', err && err.name, err && err.message, err);
            }
            throw mapUsbTransportError(err);
        } finally {
            try {
                if (claimedIface != null) {
                    await device.releaseInterface(claimedIface);
                }
            } catch (_release) {
                /* ignore */
            }
        }
    }

    async function resolvePrinterTarget(preferred) {
        var want = preferred || readDefaultPrinter();
        if (want && (want.transport === 'bluetooth' || want.transport === 'tcp')) {
            return want;
        }
        var list = await listConnectedPrinters();
        var serialList = [];
        for (var si = 0; si < list.length; si += 1) {
            if (list[si].transport === 'serial' && list[si].port) {
                serialList.push(list[si]);
            }
        }
        if (want && want.id) {
            var exact = null;
            for (var i = 0; i < list.length; i += 1) {
                if (list[i].id === want.id) {
                    exact = list[i];
                    break;
                }
            }
            /* 番号だけの serial:port-N は再起動で別COMを指す。複数あるときは信用しない */
            if (exact && !(want.transport === 'serial' && isIndexOnlySerialId(want.id) && serialList.length > 1)) {
                return exact;
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
            if (want.transport === 'serial') {
                var btSerialList = [];
                for (var bs = 0; bs < serialList.length; bs += 1) {
                    if (serialList[bs].bluetoothSerial) {
                        btSerialList.push(serialList[bs]);
                    }
                }
                if (want.bluetoothSerial && btSerialList.length === 1) {
                    return btSerialList[0];
                }
                if (serialList.length === 1) {
                    if (typeof console !== 'undefined' && console.info) {
                        console.info('[escpos] serial fallback to the only granted port', serialList[0].id);
                    }
                    return serialList[0];
                }
                throw new Error('再起動後にシリアルポートの割り当てが変わっています。アプリ設定で「シリアルを追加」からプリンタを選び直してください');
            }
            throw new Error('デフォルトプリンタに接続できません。アプリ設定でプリンタを選び直してください');
        }
        if (list.length === 1) {
            return list[0];
        }
        if (serialList.length === 1 && (!want || want.transport === 'serial')) {
            return serialList[0];
        }
        if (list.length === 0) {
            throw new Error('プリンタが接続されていません。アプリ設定でプリンタを追加してください');
        }
        throw new Error('デフォルトプリンタが未設定です。アプリ設定で選択してください');
    }

    async function resolveWebBluetoothDevice(target) {
        if (target && target.device && target.device.gatt) {
            return rememberBleDevice(target.device);
        }
        var want = String((target && (target.address || target.id)) || '').replace(/^bluetooth:/i, '').trim();
        if (!want) {
            return null;
        }
        if (bleDeviceCache[want] && bleDeviceCache[want].gatt) {
            return bleDeviceCache[want];
        }
        if (!supportsWebBluetooth() || typeof global.navigator.bluetooth.getDevices !== 'function') {
            return null;
        }
        var granted = await global.navigator.bluetooth.getDevices();
        var i;
        for (i = 0; i < granted.length; i += 1) {
            if (granted[i] && granted[i].id === want) {
                return rememberBleDevice(granted[i]);
            }
        }
        return null;
    }

    function bleCharIsPreferred(char) {
        var uuid = String(char && char.uuid || '').toLowerCase();
        return /2af1|ffe1|fff2|ff02|ae01|6e400002|8841|bef8d6c9/.test(uuid);
    }

    async function discoverBleWriteCharacteristic(server) {
        var services;
        try {
            services = await server.getPrimaryServices();
        } catch (_svc) {
            throw new Error('Bluetooth サービスを読めません。Classic SPP 機（58E など）は、PC なら Windows でペアリングして「Bluetooth を追加」、スマホなら Staff アプリを使ってください。');
        }
        var preferred = [];
        var fallback = [];
        var si;
        var ci;
        var chars;
        var char;
        var props;
        for (si = 0; si < (services || []).length; si += 1) {
            try {
                chars = await services[si].getCharacteristics();
            } catch (_chars) {
                continue;
            }
            for (ci = 0; ci < (chars || []).length; ci += 1) {
                char = chars[ci];
                props = char.properties || {};
                if (!props.write && !props.writeWithoutResponse) {
                    continue;
                }
                if (bleCharIsPreferred(char)) {
                    preferred.push(char);
                } else {
                    fallback.push(char);
                }
            }
        }
        if (preferred.length) {
            return preferred[0];
        }
        if (fallback.length) {
            return fallback[0];
        }
        throw new Error('書き込み可能な Bluetooth 特性がありません。Classic SPP 機は PC の「Bluetooth を追加」（Windows ペアリング）か Staff アプリを使ってください。');
    }

    async function writeBleChunks(characteristic, data, ctx) {
        var props = characteristic.properties || {};
        var without = !!props.writeWithoutResponse;
        var pace = currentPace();
        var gapMs = pace && pace.paceMs ? Math.min(Math.max(pace.paceMs, 20), 80) : 20;
        var sizes = [512, 256, 128, 20];
        var chunk = sizes[0];
        var offset = 0;
        var bytes = data instanceof Uint8Array ? data : new Uint8Array(data || []);
        while (offset < bytes.length) {
            var end = Math.min(offset + chunk, bytes.length);
            var slice = bytes.subarray(offset, end);
            try {
                if (without) {
                    await characteristic.writeValueWithoutResponse(slice);
                } else {
                    await characteristic.writeValue(slice);
                }
            } catch (err) {
                var next = 0;
                var si;
                for (si = 0; si < sizes.length; si += 1) {
                    if (sizes[si] < chunk) {
                        next = sizes[si];
                        break;
                    }
                }
                if (next && /GATT|Invalid|too long|exceeds|length/i.test(String(err && (err.message || err.name) || ''))) {
                    chunk = next;
                    continue;
                }
                throw err;
            }
            offset = end;
            if (offset < bytes.length && gapMs) {
                await sleepMs(gapMs);
            }
        }
        if (ctx && ctx.calibrate) {
            return;
        }
        var digest = pace && typeof pace.digestPerKb === 'number'
            ? Math.ceil(bytes.length * pace.digestPerKb / 1000)
            : 500;
        if (digest > 0) {
            await sleepMs(Math.min(digest, 4000));
        }
    }

    async function printViaWebBluetooth(target, parts, ctx) {
        var device = await resolveWebBluetoothDevice(target);
        if (!device) {
            throw new Error('Bluetooth プリンタに接続できません。アプリ設定で「Bluetooth を追加」から選び直してください。');
        }
        var cacheKey = String(device.id);
        var server;
        try {
            if (device.gatt && device.gatt.connected) {
                server = device.gatt;
            } else {
                server = await device.gatt.connect();
            }
        } catch (err) {
            throw new Error('Bluetooth プリンタへ接続できませんでした: ' + (err && err.message ? err.message : String(err)));
        }
        var characteristic = bleWriteCache[cacheKey];
        if (!characteristic || !characteristic.service) {
            characteristic = await discoverBleWriteCharacteristic(server);
            bleWriteCache[cacheKey] = characteristic;
        }
        var data = concatBytes(parts);
        try {
            await writeBleChunks(characteristic, data, ctx);
        } catch (firstErr) {
            delete bleWriteCache[cacheKey];
            try {
                characteristic = await discoverBleWriteCharacteristic(server);
                bleWriteCache[cacheKey] = characteristic;
                await writeBleChunks(characteristic, data, ctx);
            } catch (err) {
                delete bleWriteCache[cacheKey];
                throw new Error('Bluetooth 印刷に失敗しました: ' + (err && err.message ? err.message : String(firstErr && firstErr.message ? firstErr.message : err)));
            }
        }
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
        await plugin.print({ dataBase64: bytesToBase64(data) });
    }

    /**
     * デフォルト（または指定）プリンタへ ESC/POS を送信。失敗時は例外。
     * 端末全体で直列化。シリアル/USB は実証済みの keep-open（close しない）。
     * @param {Uint8Array|Uint8Array[]|{parts:Uint8Array[]}} bytesOrParts
     * @param {object} [ctx]
     * @returns {Promise<void>}
     */
    async function printOfficialReceipt(bytesOrParts, ctx) {
        var mode = (ctx && ctx.mode) || (typeof P.getPrinterMode === 'function' ? P.getPrinterMode() : 'escpos-manual');
        if (typeof P.isPrinterModeReady === 'function' && !P.isPrinterModeReady(mode)) {
            throw new Error(typeof P.describePrinterMode === 'function'
                ? P.describePrinterMode(mode)
                : 'この印刷方式はまだ使えません');
        }
        var parts = keepManyBursts(ctx)
            ? normalizePrintParts(bytesOrParts)
            : collapseToTwoBursts(normalizePrintParts(bytesOrParts));
        if (!parts.length) {
            throw new Error('印刷データが空です');
        }
        var totalBytes = 0;
        for (var ti = 0; ti < parts.length; ti += 1) {
            totalBytes += parts[ti].length;
        }
        if (printBusy) {
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('[escpos] duplicate print suppressed (busy)', 'sdk=', SDK_VERSION);
            }
            throw new Error('前のレシートを印字中です。紙が出終わるまで待ってから再試行してください。');
        }
        printBusy = true;
        if (typeof console !== 'undefined' && console.info) {
            console.info('[escpos] print parts=', parts.length, 'bytes=', totalBytes, 'sdk=', SDK_VERSION);
        }
        var preferred = null;
        if (ctx && ctx.printer && typeof ctx.printer === 'object') {
            preferred = ctx.printer;
        }

        try {
            await enqueuePrintJob(async function () {
                var target = await resolvePrinterTarget(preferred);
                if (typeof console !== 'undefined' && console.info) {
                    console.info('[escpos] target', target.transport, target.label || target.id, 'open=', !!(target.port && (target.port.readable || target.port.writable)));
                }
                if (target.transport === 'bluetooth' || target.transport === 'tcp') {
                    if (supportsNativePrinter()) {
                        await printViaNative(target, concatBytes(parts));
                        return;
                    }
                    if (target.transport === 'bluetooth' && supportsWebBluetooth()) {
                        await printViaWebBluetooth(target, parts, ctx);
                        return;
                    }
                    if (target.transport === 'tcp') {
                        throw new Error('LAN/TCP 印刷は Android アプリでのみ利用できます');
                    }
                    throw new Error('このブラウザでは Bluetooth 印刷に対応していません。PC の Chrome / Edge で「Bluetooth を追加」するか、Android の Staff アプリを使ってください。');
                }
                if (isNativePlatform()) {
                    throw new Error('Android では Bluetooth / LAN(TCP) プリンタを設定してください');
                }
                if (target.transport === 'usb') {
                    if (!target.device) {
                        throw new Error('USB プリンタデバイスが見つかりません');
                    }
                    await usbSendOnce(target.device, parts);
                    return;
                }
                if (target.transport === 'serial') {
                    if (!target.port) {
                        throw new Error('シリアルポートが見つかりません');
                    }
                    await serialSendOnce(target.port, parts, ctx);
                    await maybeConfirmAndLockPace(ctx);
                    return;
                }
                throw new Error('未対応のプリンタ種別です: ' + target.transport);
            });
        } finally {
            printBusy = false;
        }
    }

    P.DEFAULT_PRINTER_KEY = DEFAULT_PRINTER_KEY;
    P.SERIAL_PACE_KEY = PACE_KEY;
    P.BUFFER_PRESETS = BUFFER_PRESETS;
    P.PACE_MS_PRESETS = PACE_MS_PRESETS;
    P.describeSerialPace = describeSerialPace;
    P.resetSerialPace = resetSerialPace;
    P.setManualBufferPace = setManualBufferPace;
    P.applyShopPrinterSettings = applyShopPrinterSettings;
    P.exportShopPrinterSettings = exportShopPrinterSettings;
    P.getManualBufferBytes = function () {
        return currentPace().paceBytes;
    };
    P.getManualPaceMs = function () {
        return currentPace().paceMs;
    };
    P.beginSerialPaceCalibration = beginSerialPaceCalibration;
    P.isSerialPaceAdjusted = isSerialPaceAdjusted;
    P.getSerialPaceId = function () {
        return currentPace().id;
    };
    P.bytesToBase64 = bytesToBase64;
    P.downloadReceiptBytes = downloadReceiptBytes;
    P.isNativePlatform = isNativePlatform;
    P.supportsNativePrinter = supportsNativePrinter;
    P.supportsUsb = supportsUsb;
    P.supportsSerial = supportsSerial;
    P.supportsBluetooth = supportsBluetooth;
    P.supportsWebBluetooth = supportsWebBluetooth;
    P.listConnectedPrinters = listConnectedPrinters;
    P.requestUsbPrinter = requestUsbPrinter;
    P.requestSerialPrinter = requestSerialPrinter;
    P.requestBluetoothSerialPrinter = requestBluetoothSerialPrinter;
    P.requestWebBluetoothPrinter = requestWebBluetoothPrinter;
    P.requestBluetoothPrinter = requestBluetoothPrinter;
    P.requestTcpPrinter = requestTcpPrinter;
    P.getDefaultPrinter = getDefaultPrinter;
    P.setDefaultPrinter = setDefaultPrinter;
    P.clearDefaultPrinter = clearDefaultPrinter;
    P.forgetPrinter = forgetPrinter;
    P.printOfficialReceipt = printOfficialReceipt;
})(typeof window !== 'undefined' ? window : globalThis);
