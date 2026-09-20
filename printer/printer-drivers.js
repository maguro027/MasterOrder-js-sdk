/**
 * MasterOrder Printer — brand drivers IIFE
 * Windows ドライバ（OS 印刷）/ スター WebPRNT / Epson ePOS。
 * シリアル・USB・Android は transport のマニュアル送りを再利用する。
 * 依存: printer-transport.js（MasterOrderPrinter.printOfficialReceipt）
 */
(function (global) {
    'use strict';

    var P = global.MasterOrderPrinter;
    if (!P || typeof P.printOfficialReceipt !== 'function') {
        throw new Error('MasterOrderPrinter transport が先に読み込まれていません');
    }

    var sendManual = P.printOfficialReceipt;
    var concatBytes = P.concatBytes;
    var bytesToBase64 = P.bytesToBase64;

    function modeId(ctx) {
        if (ctx && ctx.mode) {
            return ctx.mode === 'escpos-cdc' ? 'escpos-manual' : String(ctx.mode);
        }
        if (typeof P.getPrinterMode === 'function') {
            return P.getPrinterMode();
        }
        return 'escpos-manual';
    }

    function lanInput(ctx) {
        if (ctx && ctx.lanUrl) {
            return String(ctx.lanUrl).trim();
        }
        return typeof P.getPrinterLanUrl === 'function' ? P.getPrinterLanUrl() : '';
    }

    function normalizeLanUrl(raw, kind) {
        var s = String(raw || '').trim();
        if (!s) {
            return '';
        }
        if (!/^https?:\/\//i.test(s)) {
            s = 'http://' + s;
        }
        s = s.replace(/\/+$/, '');
        if (/StarWebPRNT|epos\/service\.cgi/i.test(s)) {
            return s;
        }
        if (kind === 'star') {
            return s + '/StarWebPRNT/SendMessage';
        }
        if (kind === 'epson') {
            return s + '/cgi-bin/epos/service.cgi?devid=local_printer&timeout=60000';
        }
        return s;
    }

    function partsToBytes(parts) {
        if (parts instanceof Uint8Array) {
            return parts;
        }
        return concatBytes(parts);
    }

    function bytesToHex(bytes) {
        var out = '';
        var i;
        for (i = 0; i < bytes.length; i += 1) {
            out += ('0' + bytes[i].toString(16)).slice(-2);
        }
        return out;
    }

    function mixedContentHint(url) {
        try {
            if (global.location && global.location.protocol === 'https:' && /^http:\/\//i.test(url)) {
                return 'ブラウザは HTTPS ページから LAN の http プリンタへ送れません。USB シリアルか Android アプリの TCP を使ってください。';
            }
        } catch (_e) {
            /* ignore */
        }
        return '';
    }

    function decodeEscPosToCanvas(bytes) {
        var width = P.RECEIPT_DOT_WIDTH || 384;
        var data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
        var rows = [];
        var i = 0;

        function blank(count) {
            var n = Math.max(0, count | 0);
            var r;
            for (r = 0; r < n; r += 1) {
                rows.push(new Uint8Array(width));
            }
        }

        while (i < data.length) {
            var b = data[i];
            if (b === 0x1b && i + 1 < data.length && data[i + 1] === 0x2a && i + 4 < data.length) {
                var m = data[i + 2];
                var cols = data[i + 3] + (data[i + 4] << 8);
                var bytesPerCol = (m === 0 || m === 1) ? 1 : 3;
                var bandH = bytesPerCol * 8;
                var start = rows.length;
                blank(bandH);
                i += 5;
                var col;
                for (col = 0; col < cols; col += 1) {
                    var x = col < width ? col : width - 1;
                    var k;
                    for (k = 0; k < bytesPerCol; k += 1) {
                        var v = i < data.length ? data[i] : 0;
                        i += 1;
                        var bit;
                        for (bit = 0; bit < 8; bit += 1) {
                            if (v & (0x80 >> bit)) {
                                rows[start + k * 8 + bit][x] = 1;
                            }
                        }
                    }
                }
                continue;
            }
            if (b === 0x1b && i + 1 < data.length && data[i + 1] === 0x40) {
                i += 2;
                continue;
            }
            if (b === 0x1b && i + 2 < data.length && data[i + 1] === 0x4a) {
                blank(data[i + 2]);
                i += 3;
                continue;
            }
            if (b === 0x1b && i + 2 < data.length && data[i + 1] === 0x64) {
                blank((data[i + 2] | 0) * 24);
                i += 3;
                continue;
            }
            if (b === 0x1d && i + 1 < data.length && data[i + 1] === 0x56) {
                i += (i + 2 < data.length && data[i + 2] >= 65) ? 4 : 3;
                continue;
            }
            if (b === 0x0a || b === 0x0d) {
                blank(24);
                i += 1;
                continue;
            }
            i += 1;
        }

        var height = Math.max(rows.length, 8);
        var canvas = global.document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext('2d');
        var image = ctx.createImageData(width, height);
        var y;
        var x;
        for (y = 0; y < height; y += 1) {
            var row = rows[y] || new Uint8Array(width);
            for (x = 0; x < width; x += 1) {
                var off = (y * width + x) * 4;
                var ink = row[x] ? 0 : 255;
                image.data[off] = ink;
                image.data[off + 1] = ink;
                image.data[off + 2] = ink;
                image.data[off + 3] = 255;
            }
        }
        ctx.putImageData(image, 0, 0);
        return canvas;
    }

    function isMobileBrowser() {
        try {
            if (typeof P.isNativePlatform === 'function' && P.isNativePlatform()) {
                return false;
            }
            var ua = (global.navigator && global.navigator.userAgent) || '';
            return /Android|iPhone|iPad|iPod/i.test(ua);
        } catch (_e) {
            return false;
        }
    }

    function printSheetHtml() {
        return '<!doctype html><html><head><title>レシート</title><style>'
            + '@page{size:58mm auto;margin:0}'
            + 'html,body{margin:0;padding:0;background:#fff}'
            + 'img{display:block;width:58mm;height:auto}'
            + '</style></head><body></body></html>';
    }

    function printViaHiddenIframe(dataUrl) {
        return new Promise(function (resolve, reject) {
            var iframe = global.document.createElement('iframe');
            iframe.setAttribute('aria-hidden', 'true');
            iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
            global.document.body.appendChild(iframe);
            var win = iframe.contentWindow;
            var doc = iframe.contentDocument || (win && win.document);
            if (!win || !doc) {
                iframe.remove();
                reject(new Error('印刷プレビューを開けませんでした'));
                return;
            }
            doc.open();
            doc.write(printSheetHtml());
            doc.close();
            var img = doc.createElement('img');
            img.alt = 'レシート';
            img.onload = function () {
                try {
                    win.focus();
                    win.print();
                    resolve();
                } catch (err) {
                    reject(err instanceof Error ? err : new Error(String(err)));
                } finally {
                    global.setTimeout(function () {
                        try {
                            iframe.remove();
                        } catch (_rm) {
                            /* ignore */
                        }
                    }, 1500);
                }
            };
            img.onerror = function () {
                iframe.remove();
                reject(new Error('レシート画像の生成に失敗しました'));
            };
            img.src = dataUrl;
            doc.body.appendChild(img);
        });
    }

    function printViaVisiblePreview(dataUrl) {
        return new Promise(function (resolve, reject) {
            var overlay = global.document.createElement('div');
            overlay.className = 'mo-os-print-overlay';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.setAttribute('aria-label', 'レシート印刷');
            overlay.innerHTML = ''
                + '<div class="mo-os-print-overlay__card">'
                + '<div class="mo-os-print-overlay__title">レシートを印刷</div>'
                + '<p class="mo-os-print-overlay__hint">プリンタを選ぶ画面が開きます。AirPrint や端末に登録したプリンタから選択してください。</p>'
                + '<div class="mo-os-print-overlay__preview"><img alt="レシート"></div>'
                + '<div class="mo-os-print-overlay__actions">'
                + '<button type="button" class="btn-primary mo-os-print-overlay__print">印刷する</button>'
                + '<button type="button" class="btn-secondary mo-os-print-overlay__cancel">キャンセル</button>'
                + '</div></div>';
            var img = overlay.querySelector('img');
            var printBtn = overlay.querySelector('.mo-os-print-overlay__print');
            var cancelBtn = overlay.querySelector('.mo-os-print-overlay__cancel');
            var settled = false;

            function finish(ok, err) {
                if (settled) {
                    return;
                }
                settled = true;
                overlay.remove();
                if (ok) {
                    resolve();
                } else {
                    reject(err || new Error('印刷がキャンセルされました'));
                }
            }

            function runPrint() {
                var host = global.document.createElement('div');
                host.className = 'mo-receipt-print-root';
                var printImg = global.document.createElement('img');
                printImg.alt = 'レシート';
                printImg.src = dataUrl;
                host.appendChild(printImg);
                global.document.body.appendChild(host);
                var cleaned = false;
                function cleanup() {
                    if (cleaned) {
                        return;
                    }
                    cleaned = true;
                    global.removeEventListener('afterprint', onAfter);
                    try {
                        host.remove();
                    } catch (_rm) {
                        /* ignore */
                    }
                }
                function onAfter() {
                    cleanup();
                    finish(true);
                }
                global.addEventListener('afterprint', onAfter);
                try {
                    global.print();
                } catch (err) {
                    cleanup();
                    finish(false, err instanceof Error ? err : new Error(String(err)));
                    return;
                }
                global.setTimeout(function () {
                    if (!cleaned) {
                        cleanup();
                        finish(true);
                    }
                }, 2500);
            }

            printBtn.addEventListener('click', function () {
                runPrint();
            });
            cancelBtn.addEventListener('click', function () {
                finish(false, new Error('印刷がキャンセルされました'));
            });
            overlay.addEventListener('click', function (ev) {
                if (ev.target === overlay) {
                    finish(false, new Error('印刷がキャンセルされました'));
                }
            });
            img.onerror = function () {
                finish(false, new Error('レシート画像の生成に失敗しました'));
            };
            img.src = dataUrl;
            global.document.body.appendChild(overlay);
        });
    }

    function printViaWindowsDriver(parts) {
        if (!global.document) {
            throw new Error('OS 印刷にはブラウザの文書が必要です');
        }
        var canvas = decodeEscPosToCanvas(partsToBytes(parts));
        var dataUrl = canvas.toDataURL('image/png');
        if (isMobileBrowser()) {
            return printViaVisiblePreview(dataUrl);
        }
        return printViaHiddenIframe(dataUrl);
    }

    function shouldFallbackToOsPrint(err, ctx) {
        if (ctx && (ctx.calibrate || ctx.keepBursts || ctx.mode === 'windows-driver')) {
            return false;
        }
        if (typeof P.isNativePlatform === 'function' && P.isNativePlatform()) {
            return false;
        }
        if (!isMobileBrowser()) {
            return false;
        }
        var msg = String(err && err.message ? err.message : err || '');
        return /プリンタが接続されていません|デフォルトプリンタが未設定|デフォルトプリンタに接続できません/.test(msg);
    }

    async function postLanXml(url, body, contentType) {
        var mixed = mixedContentHint(url);
        if (mixed) {
            throw new Error(mixed);
        }
        var res;
        try {
            res = await global.fetch(url, {
                method: 'POST',
                mode: 'cors',
                headers: {
                    'Content-Type': contentType || 'text/xml; charset=utf-8'
                },
                body: body
            });
        } catch (err) {
            throw new Error('LAN プリンタに届きませんでした。IP と CORS、または USB シリアルを確認してください。' + (err && err.message ? ' (' + err.message + ')' : ''));
        }
        if (!res.ok) {
            throw new Error('LAN プリンタがエラーを返しました（HTTP ' + res.status + '）');
        }
    }

    async function printViaStarLan(bytes, url) {
        var payload = '<root><raw>' + bytesToBase64(bytes) + '</raw></root>';
        await postLanXml(url, payload, 'text/xml; charset=utf-8');
    }

    async function printViaEpsonLan(bytes, url) {
        var hex = bytesToHex(bytes);
        var xml = '<?xml version="1.0" encoding="utf-8"?>'
            + '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">'
            + '<s:Body>'
            + '<epos-print xmlns="http://www.epson-pos.com/schemas/xml/epos-print">'
            + '<command>' + hex + '</command>'
            + '</epos-print></s:Body></s:Envelope>';
        await postLanXml(url, xml, 'text/xml; charset=utf-8');
    }

    async function printOfficialReceipt(bytesOrParts, ctx) {
        var info = getActivePrintPath(ctx);
        if (typeof console !== 'undefined' && console.info) {
            console.info('[escpos] driver=', info.mode, 'path=', info.path, info.url || '');
        }
        var mode = info.mode;
        if (mode === 'windows-driver') {
            var def = typeof P.getDefaultPrinter === 'function' ? P.getDefaultPrinter() : null;
            if (def && (def.transport === 'usb' || def.transport === 'serial' || def.transport === 'bluetooth')) {
                if (typeof console !== 'undefined' && console.info) {
                    console.info('[escpos] windows-driver skipped; default ESC/POS printer is set');
                }
                return sendManual(bytesOrParts, ctx);
            }
            return printViaWindowsDriver(bytesOrParts);
        }
        if (mode === 'star-prnt') {
            if (info.path === 'star-webprnt') {
                await printViaStarLan(partsToBytes(bytesOrParts), info.url);
                return;
            }
            return sendManual(bytesOrParts, ctx);
        }
        if (mode === 'epson-epos') {
            if (info.path === 'epson-epos') {
                await printViaEpsonLan(partsToBytes(bytesOrParts), info.url);
                return;
            }
            return sendManual(bytesOrParts, ctx);
        }
        try {
            return await sendManual(bytesOrParts, ctx);
        } catch (err) {
            if (shouldFallbackToOsPrint(err, ctx)) {
                if (typeof console !== 'undefined' && console.info) {
                    console.info('[escpos] mobile fallback to OS print dialog');
                }
                return printViaWindowsDriver(bytesOrParts);
            }
            throw err;
        }
    }

    function getActivePrintPath(ctx) {
        var mode = modeId(ctx);
        if (mode === 'windows-driver') {
            return { mode: mode, path: 'windows-dialog', label: 'OS 印刷ダイアログ' };
        }
        if (mode === 'star-prnt') {
            var starUrl = normalizeLanUrl(lanInput(ctx), 'star');
            if (starUrl && !P.isNativePlatform()) {
                return { mode: mode, path: 'star-webprnt', label: 'スター WebPRNT', url: starUrl };
            }
            return { mode: mode, path: 'serial-escpos', label: 'USB シリアル ESC/POS' };
        }
        if (mode === 'epson-epos') {
            var epsonUrl = normalizeLanUrl(lanInput(ctx), 'epson');
            if (epsonUrl && !P.isNativePlatform()) {
                return { mode: mode, path: 'epson-epos', label: 'Epson ePOS', url: epsonUrl };
            }
            return { mode: mode, path: 'serial-escpos', label: 'USB シリアル ESC/POS' };
        }
        return { mode: mode || 'escpos-manual', path: 'serial-escpos', label: 'USB シリアル ESC/POS' };
    }

    function describeActivePrintPath(ctx) {
        var info = getActivePrintPath(ctx);
        if (info.path === 'windows-dialog') {
            return '実際の送り先: OS の印刷ダイアログ。USB シリアルへは直接送りません。スマホではプリンタ一覧から選べます。';
        }
        if (info.path === 'star-webprnt') {
            return '実際の送り先: スター WebPRNT（LAN） ' + info.url;
        }
        if (info.path === 'epson-epos') {
            return '実際の送り先: Epson ePOS（LAN） ' + info.url;
        }
        if (info.mode === 'star-prnt') {
            return '実際の送り先: USB シリアルへ通常の ESC/POS。LAN IP が空なのでスター WebPRNT には切り替わっていません。';
        }
        if (info.mode === 'epson-epos') {
            return '実際の送り先: USB シリアルへ通常の ESC/POS。LAN IP が空なので Epson ePOS には切り替わっていません。';
        }
        return '実際の送り先: USB シリアルへ ESC/POS（マニュアルのバッファと間隔）。';
    }

    P.decodeEscPosToCanvas = decodeEscPosToCanvas;
    P.printViaWindowsDriver = printViaWindowsDriver;
    P.getActivePrintPath = getActivePrintPath;
    P.describeActivePrintPath = describeActivePrintPath;
    P.printOfficialReceipt = printOfficialReceipt;
})(typeof window !== 'undefined' ? window : globalThis);
