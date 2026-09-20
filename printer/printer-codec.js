/**
 * MasterOrder Printer — codec IIFE
 * Canvas → ESC * 24-dot。日本語はビットマップのみ。GS v 0 / コードページは使わない。
 */
(function (global) {
    'use strict';

    var P = global.MasterOrderPrinter || (global.MasterOrderPrinter = {});
    var SDK_VERSION = '1.1.5';
    var RECEIPT_DOT_WIDTH = 384;
    var IMAGE_LINE_HEIGHT = 48;
    /** ESC * 24-dot バンド高さ。紙送りもこのドット数に合わせる。 */
    var ESC_STAR_BAND_DOTS = 24;

    var ESC = 0x1b;
    var GS = 0x1d;

    function formatYen(value) {
        var n = Number(value);
        if (!Number.isFinite(n)) {
            n = 0;
        }
        return '\u00A5' + Math.trunc(n).toLocaleString('ja-JP');
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

    function cmdFeed(lines) {
        var n = Math.max(0, Math.min(255, lines | 0));
        return new Uint8Array([ESC, 0x64, n]);
    }

    /** ESC J n — 印字位置を n ドット進める（ESC * バンド直後の紙送り用）。 */
    function cmdFeedDots(dots) {
        var n = Math.max(0, Math.min(255, dots | 0));
        return new Uint8Array([ESC, 0x4a, n]);
    }

    function cmdCut() {
        return new Uint8Array([GS, 0x56, 0x00]);
    }

    function supportsCanvasImagePrint() {
        try {
            return !!(global.document
                && typeof global.document.createElement === 'function'
                && typeof Uint8Array !== 'undefined');
        } catch (_e) {
            return false;
        }
    }

    function requireCanvasImagePrint() {
        if (!supportsCanvasImagePrint()) {
            throw new Error('レシート印字には Canvas が必要です');
        }
    }

    /**
     * 絵文字・記号類は 58mm ビットマップでは幅も処理も重いので落とす。
     * かな漢字・ASCII・顔文字に使う ´ω｀ などは残す。
     */
    function nextCodePoint(str, index) {
        var c = str.charCodeAt(index);
        if (c >= 0xD800 && c <= 0xDBFF && index + 1 < str.length) {
            var d = str.charCodeAt(index + 1);
            if (d >= 0xDC00 && d <= 0xDFFF) {
                return {
                    code: ((c - 0xD800) << 10) + (d - 0xDC00) + 0x10000,
                    size: 2
                };
            }
        }
        return { code: c, size: 1 };
    }

    function isReceiptGlyph(code) {
        if (code < 32 || code === 127) {
            return false;
        }
        if (code <= 0x7E) {
            return true;
        }
        if (code === 0x00A5 || code === 0x00B4) {
            return true;
        }
        if (code >= 0x0370 && code <= 0x03FF) {
            return true;
        }
        if (code >= 0x2010 && code <= 0x205E) {
            return true;
        }
        if (code === 0x203B || code === 0x2605 || code === 0x2606 || code === 0x266A || code === 0x3012) {
            return true;
        }
        if (code >= 0x3000 && code <= 0x30FF) {
            return true;
        }
        if (code >= 0x31F0 && code <= 0x31FF) {
            return true;
        }
        if (code >= 0x3400 && code <= 0x9FFF) {
            return true;
        }
        if (code >= 0xF900 && code <= 0xFAFF) {
            return true;
        }
        if (code >= 0xFF00 && code <= 0xFFEF) {
            return true;
        }
        return false;
    }

    function sanitizeReceiptText(text) {
        var s = String(text == null ? '' : text);
        var out = '';
        var i = 0;
        while (i < s.length) {
            var cp = nextCodePoint(s, i);
            if (cp.code !== 0xFE0E && cp.code !== 0xFE0F && cp.code !== 0x200D && cp.code !== 0x20E3
                && isReceiptGlyph(cp.code)) {
                out += s.substr(i, cp.size);
            }
            i += cp.size;
        }
        return out.replace(/[ \t]{2,}/g, ' ').replace(/^[ \t]+|[ \t]+$/g, '');
    }

    // Thermal heads thicken black dots; keep source strokes light and drop AA fringe.
    var IMAGE_INK_THRESHOLD = 168;

    /** 領収書プレビューと同じサンプル（テスト印刷・UIプレビュー共通） */
    function receiptFont(fontSize) {
        // MS Gothic: clear strokes for 203dpi bitmaps. Regular only — emphasize with size.
        return '400 ' + fontSize + 'px "MS Gothic", "Yu Gothic UI", Meiryo, sans-serif';
    }

    function createBandCanvas(width, height) {
        var canvas = global.document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
            throw new Error('Canvas 2D が利用できません');
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#000000';
        ctx.textBaseline = 'middle';
        return { canvas: canvas, ctx: ctx };
    }

    function measureCtx(fontSize) {
        var band = createBandCanvas(8, 8);
        band.ctx.font = receiptFont(fontSize);
        return band.ctx;
    }

    /**
     * 明示改行 + 印字幅での自動折り返し（プレビューと実機で同じロジック）。
     * @returns {string[]}
     */
    function wrapReceiptText(text, opts) {
        var options = opts || {};
        var width = options.width != null ? options.width : RECEIPT_DOT_WIDTH;
        var fontSize = options.fontSize != null ? options.fontSize : 26;
        var sidePad = options.pad != null ? options.pad : 6;
        var maxWidth = Math.max(24, width - sidePad * 2);
        var raw = sanitizeReceiptText(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        var paragraphs = raw.split('\n');
        var ctx = measureCtx(fontSize);
        var out = [];
        for (var pi = 0; pi < paragraphs.length; pi += 1) {
            var paragraph = paragraphs[pi];
            if (paragraph === '') {
                out.push('');
                continue;
            }
            var line = '';
            for (var i = 0; i < paragraph.length; i += 1) {
                var ch = paragraph.charAt(i);
                var trial = line + ch;
                if (line && ctx.measureText(trial).width > maxWidth) {
                    out.push(line);
                    line = ch;
                } else {
                    line = trial;
                }
            }
            if (line !== '' || paragraph === '') {
                out.push(line);
            }
        }
        return out.length ? out : [''];
    }

    function renderTextBand(text, opts) {
        var options = opts || {};
        var width = options.width != null ? options.width : RECEIPT_DOT_WIDTH;
        var fontSize = options.fontSize != null ? options.fontSize : 26;
        var align = options.align || 'left';
        var pad = options.pad != null ? options.pad : 6;
        var lineHeight = options.lineHeight != null
            ? options.lineHeight
            : (options.height != null ? options.height : Math.max(fontSize + 10, Math.ceil(fontSize * 1.4)));
        var lines = wrapReceiptText(text, {
            width: width,
            fontSize: fontSize,
            pad: pad
        });
        var height = Math.max(lineHeight, lines.length * lineHeight);
        height = Math.ceil(height / ESC_STAR_BAND_DOTS) * ESC_STAR_BAND_DOTS;
        var band = createBandCanvas(width, height);
        var ctx = band.ctx;
        ctx.font = receiptFont(fontSize);
        for (var i = 0; i < lines.length; i += 1) {
            var lineText = lines[i];
            var metrics = ctx.measureText(lineText);
            var x = pad;
            if (align === 'center') {
                x = Math.max(0, Math.floor((width - metrics.width) / 2));
            } else if (align === 'right') {
                x = Math.max(0, Math.floor(width - metrics.width - pad));
            }
            var y = Math.floor(i * lineHeight + lineHeight / 2);
            ctx.fillText(lineText, x, y);
        }
        return ctx.getImageData(0, 0, width, height);
    }

    function ellipsizeToWidth(ctx, text, maxWidth) {
        var s = String(text == null ? '' : text);
        if (ctx.measureText(s).width <= maxWidth) {
            return s;
        }
        var ellipsis = '…';
        var out = s;
        while (out.length > 0 && ctx.measureText(out + ellipsis).width > maxWidth) {
            out = out.slice(0, -1);
        }
        return out ? (out + ellipsis) : ellipsis;
    }

    /**
     * 商品名を印字幅で折り返す（1行目は金額列を避け、2行目以降は数量列の右から）。
     * @returns {string[]}
     */
    function wrapNameForItemColumns(ctx, name, firstMax, contMax) {
        var s = sanitizeReceiptText(name);
        var firstLimit = Math.max(24, firstMax | 0);
        var contLimit = Math.max(24, contMax | 0);
        var lines = [];
        var i = 0;
        while (i < s.length) {
            var limit = lines.length === 0 ? firstLimit : contLimit;
            var line = '';
            while (i < s.length) {
                var ch = s.charAt(i);
                var trial = line + ch;
                if (line && ctx.measureText(trial).width > limit) {
                    break;
                }
                line = trial;
                i += 1;
            }
            if (!line) {
                // 1 文字も入らない（極端に狭い）ときは強制 1 文字
                line = s.charAt(i);
                i += 1;
            }
            lines.push(line);
            if (lines.length >= 6) {
                if (i < s.length) {
                    lines[lines.length - 1] = ellipsizeToWidth(ctx, lines[lines.length - 1] + s.slice(i), limit);
                }
                break;
            }
        }
        return lines.length ? lines : [''];
    }

    function renderLabeledValueBand(label, value, opts) {
        var options = opts || {};
        var width = options.width != null ? options.width : RECEIPT_DOT_WIDTH;
        var height = options.height != null ? options.height : IMAGE_LINE_HEIGHT;
        height = Math.ceil(Math.max(ESC_STAR_BAND_DOTS, height) / ESC_STAR_BAND_DOTS) * ESC_STAR_BAND_DOTS;
        var fontSize = options.fontSize != null ? options.fontSize : 26;
        var pad = 6;
        var band = createBandCanvas(width, height);
        var ctx = band.ctx;
        var y = Math.floor(height / 2);
        var left = sanitizeReceiptText(label);
        var right = sanitizeReceiptText(value);
        ctx.font = receiptFont(fontSize);
        var rightWidth = ctx.measureText(right).width;
        var leftMax = Math.max(24, width - pad * 2 - rightWidth - 10);
        left = ellipsizeToWidth(ctx, left, leftMax);
        ctx.fillText(left, pad, y);
        ctx.fillText(right, Math.max(pad, Math.floor(width - rightWidth - pad)), y);
        return ctx.getImageData(0, 0, width, height);
    }

    /**
     * 左に数量・中央に折り返し商品名・右に金額（1行目）。
     * 長い名前は SDK 側で幅計測して改行する。
     */
    function renderQtyNamePriceBand(qtyText, name, price, opts) {
        var options = opts || {};
        var width = options.width != null ? options.width : RECEIPT_DOT_WIDTH;
        var fontSize = options.fontSize != null ? options.fontSize : 26;
        var lineHeight = options.height != null
            ? options.height
            : Math.max(fontSize + 10, Math.ceil(fontSize * 1.4));
        var pad = 6;
        var gap = 8;
        var qty = sanitizeReceiptText(qtyText).trim();
        var priceStr = sanitizeReceiptText(price);
        var probe = createBandCanvas(8, 8).ctx;
        probe.font = receiptFont(fontSize);
        var qtyCol = qty
            ? Math.ceil(Math.max(probe.measureText(qty).width, probe.measureText('x99').width)) + gap
            : 0;
        var priceWidth = priceStr ? Math.ceil(probe.measureText(priceStr).width) : 0;
        var firstNameMax = Math.max(24, width - pad * 2 - qtyCol - (priceWidth ? priceWidth + gap : 0));
        var contNameMax = Math.max(24, width - pad * 2 - qtyCol);
        var nameLines = wrapNameForItemColumns(probe, name, firstNameMax, contNameMax);
        var height = Math.max(lineHeight, nameLines.length * lineHeight);
        height = Math.ceil(height / ESC_STAR_BAND_DOTS) * ESC_STAR_BAND_DOTS;
        var band = createBandCanvas(width, height);
        var ctx = band.ctx;
        ctx.font = receiptFont(fontSize);
        for (var i = 0; i < nameLines.length; i += 1) {
            var y = Math.floor(i * lineHeight + lineHeight / 2);
            if (i === 0 && qty) {
                ctx.fillText(qty, pad, y);
            }
            ctx.fillText(nameLines[i], pad + qtyCol, y);
            if (i === 0 && priceStr) {
                ctx.fillText(priceStr, Math.max(pad, Math.floor(width - priceWidth - pad)), y);
            }
        }
        return ctx.getImageData(0, 0, width, height);
    }

    function renderSeparatorBand(opts) {
        var options = opts || {};
        var width = options.width != null ? options.width : RECEIPT_DOT_WIDTH;
        var height = options.height != null ? options.height : 24;
        height = Math.ceil(Math.max(ESC_STAR_BAND_DOTS, height) / ESC_STAR_BAND_DOTS) * ESC_STAR_BAND_DOTS;
        var band = createBandCanvas(width, height);
        var ctx = band.ctx;
        var y = Math.floor(height / 2);
        var x;
        // 2px dash / 2px gap — lighter than character "----".
        for (x = 6; x < width - 6; x += 4) {
            ctx.fillRect(x, y, 2, 1);
        }
        return ctx.getImageData(0, 0, width, height);
    }

    function loadHtmlImage(url) {
        return new Promise(function (resolve, reject) {
            var img = new global.Image();
            img.decoding = 'async';
            var isDataOrBlob = /^data:/i.test(String(url || '')) || /^blob:/i.test(String(url || ''));
            if (!isDataOrBlob) {
                try {
                    img.crossOrigin = 'anonymous';
                } catch (_e) {
                    // ignore
                }
            }
            img.onload = function () {
                resolve(img);
            };
            img.onerror = function () {
                reject(new Error('バナー画像の読み込みに失敗しました'));
            };
            img.src = String(url || '');
        });
    }

    async function urlToPrintableImageSource(url) {
        var src = String(url || '').trim();
        if (!src) {
            throw new Error('バナー URL が空です');
        }
        if (/^data:/i.test(src) || /^blob:/i.test(src)) {
            return src;
        }
        // CORS 付き fetch → data URL（canvas 汚染を避ける）
        if (typeof global.fetch === 'function' && typeof global.FileReader !== 'undefined') {
            try {
                var res = await global.fetch(src, {
                    mode: 'cors',
                    credentials: 'omit',
                    cache: 'force-cache'
                });
                if (!res.ok) {
                    throw new Error('HTTP ' + res.status);
                }
                var blob = await res.blob();
                var dataUrl = await new Promise(function (resolve, reject) {
                    var reader = new global.FileReader();
                    reader.onload = function () {
                        resolve(String(reader.result || ''));
                    };
                    reader.onerror = function () {
                        reject(new Error('バナーの data URL 変換に失敗しました'));
                    };
                    reader.readAsDataURL(blob);
                });
                if (dataUrl) {
                    return dataUrl;
                }
            } catch (fetchErr) {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('banner fetch fallback to <img>', fetchErr);
                }
            }
        }
        return src;
    }

    /**
     * バナー等を ESC * 白黒ビットマップへ（GS v 0 は 58E 互換外のため使わない）。
     * @returns {Promise<Uint8Array|null>}
     */
    async function renderBannerEscStar(url, opts) {
        var options = opts || {};
        var maxWidth = options.width != null ? options.width : RECEIPT_DOT_WIDTH;
        var maxHeight = options.maxHeight != null ? options.maxHeight : 180;
        if (!url || !supportsCanvasImagePrint()) {
            return null;
        }
        var printable = await urlToPrintableImageSource(url);
        var img = await loadHtmlImage(printable);
        var iw = img.naturalWidth || img.width || 0;
        var ih = img.naturalHeight || img.height || 0;
        if (iw < 1 || ih < 1) {
            return null;
        }
        var scale = Math.min(maxWidth / iw, maxHeight / ih, 1);
        var dw = Math.max(1, Math.floor(iw * scale));
        var dh = Math.max(1, Math.floor(ih * scale));
        // Height must be multiple of 24 for clean ESC * bands.
        var canvasH = Math.ceil(dh / 24) * 24;
        var band = createBandCanvas(maxWidth, canvasH);
        var ctx = band.ctx;
        var ox = Math.floor((maxWidth - dw) / 2);
        ctx.drawImage(img, ox, 0, dw, dh);
        return escStarRowsFromImageData(ctx.getImageData(0, 0, maxWidth, canvasH), 140);
    }

    function escStarRowsFromImageData(imageData, inkThreshold) {
        var width = imageData.width;
        var height = imageData.height;
        var data = imageData.data;
        var threshold = inkThreshold != null ? inkThreshold : IMAGE_INK_THRESHOLD;
        var chunks = [];
        var rowStart;

        function isInkAt(pixelIndex) {
            var a = data[pixelIndex + 3];
            if (a < 128) {
                return false;
            }
            // 輝度（R だけ見ると色付きロゴやアンチエイリアスで欠ける）
            var y = (data[pixelIndex] * 3 + data[pixelIndex + 1] * 4 + data[pixelIndex + 2]) >> 3;
            return y < threshold;
        }

        for (rowStart = 0; rowStart < height; rowStart += ESC_STAR_BAND_DOTS) {
            var nL = width & 0xff;
            var nH = (width >> 8) & 0xff;
            // m=33: 24-dot double-density。紙送りは LF ではなく ESC J 24 で正確に進める
            var row = [ESC, 0x2a, 33, nL, nH];
            var x;
            for (x = 0; x < width; x += 1) {
                var b0 = 0;
                var b1 = 0;
                var b2 = 0;
                var bit;
                for (bit = 0; bit < 8; bit += 1) {
                    var y0 = rowStart + bit;
                    var y1 = rowStart + 8 + bit;
                    var y2 = rowStart + 16 + bit;
                    if (y0 < height && isInkAt((y0 * width + x) * 4)) {
                        b0 |= (0x80 >> bit);
                    }
                    if (y1 < height && isInkAt((y1 * width + x) * 4)) {
                        b1 |= (0x80 >> bit);
                    }
                    if (y2 < height && isInkAt((y2 * width + x) * 4)) {
                        b2 |= (0x80 >> bit);
                    }
                }
                row.push(b0, b1, b2);
            }
            chunks.push(new Uint8Array(row));
            // デフォルト行間の LF だと 24dot 未満しか進まずバンドが重なり「二重」に見える
            chunks.push(cmdFeedDots(ESC_STAR_BAND_DOTS));
        }
        return concatBytes(chunks);
    }

    /** 203dpi ≒ 8 dot/mm。印刷調整の帯はこの高さ（約 10cm）。 */
    var LOAD_TEST_STRIP_DOTS = 816;
    /** 58E は 4 万バイトを一塊にすると死ぬので、約 1.2cm ずつ切る。 */
    var LOAD_TEST_CHUNK_DOTS = 96;
    var BAYER4 = [
        [0, 8, 2, 10],
        [12, 4, 14, 6],
        [3, 11, 1, 9],
        [15, 7, 13, 5]
    ];

    function makeGrayImageData(width, height, grayAt) {
        var imageData = new ImageData(width, height);
        var data = imageData.data;
        var y;
        var x;
        var i;
        var gray;
        for (y = 0; y < height; y += 1) {
            for (x = 0; x < width; x += 1) {
                gray = grayAt(x, y);
                if (gray < 0) {
                    gray = 0;
                }
                if (gray > 255) {
                    gray = 255;
                }
                i = (y * width + x) * 4;
                data[i] = gray;
                data[i + 1] = gray;
                data[i + 2] = gray;
                data[i + 3] = 255;
            }
        }
        return imageData;
    }

    function ditherInk(gray, x, y) {
        var level = (BAYER4[y & 3][x & 3] + 1) * 16;
        return gray <= level;
    }

    function sliceImageData(imageData, rowStart, rowCount) {
        var width = imageData.width;
        var height = Math.max(0, rowCount | 0);
        var start = Math.max(0, rowStart | 0);
        var out = new ImageData(width, height);
        if (!height) {
            return out;
        }
        var src = (start * width) * 4;
        out.data.set(imageData.data.subarray(src, src + height * width * 4));
        return out;
    }

    function imageDataToEscStarChunks(imageData, chunkDots) {
        var height = imageData.height;
        var chunk = Math.ceil((chunkDots || LOAD_TEST_CHUNK_DOTS) / ESC_STAR_BAND_DOTS) * ESC_STAR_BAND_DOTS;
        var parts = [];
        var y;
        for (y = 0; y < height; y += chunk) {
            var h = Math.min(chunk, height - y);
            parts.push(escStarRowsFromImageData(sliceImageData(imageData, y, h), 140));
        }
        return parts;
    }

    function renderLoadTestFade(heightDots) {
        return concatBytes(renderLoadTestFadeParts(heightDots));
    }

    function renderLoadTestFadeParts(heightDots) {
        var width = RECEIPT_DOT_WIDTH;
        var height = Math.ceil((heightDots || LOAD_TEST_STRIP_DOTS) / ESC_STAR_BAND_DOTS) * ESC_STAR_BAND_DOTS;
        var last = Math.max(1, height - 1);
        var imageData = makeGrayImageData(width, height, function (x, y) {
            return Math.round(255 * y / last);
        });
        var data = imageData.data;
        var y;
        var x;
        var i;
        var gray;
        for (y = 0; y < height; y += 1) {
            for (x = 0; x < width; x += 1) {
                i = (y * width + x) * 4;
                gray = data[i];
                if (ditherInk(gray, x, y)) {
                    data[i] = 0;
                    data[i + 1] = 0;
                    data[i + 2] = 0;
                } else {
                    data[i] = 255;
                    data[i + 1] = 255;
                    data[i + 2] = 255;
                }
            }
        }
        return imageDataToEscStarChunks(imageData, LOAD_TEST_CHUNK_DOTS);
    }

    function renderLoadTestGrid(heightDots) {
        return concatBytes(renderLoadTestGridParts(heightDots));
    }

    function renderLoadTestGridParts(heightDots) {
        var width = RECEIPT_DOT_WIDTH;
        var height = Math.ceil((heightDots || LOAD_TEST_STRIP_DOTS) / ESC_STAR_BAND_DOTS) * ESC_STAR_BAND_DOTS;
        var imageData = makeGrayImageData(width, height, function (x, y) {
            var line = (x % 16 < 2) || (y % 16 < 2);
            return line ? 0 : 255;
        });
        return imageDataToEscStarChunks(imageData, LOAD_TEST_CHUNK_DOTS);
    }

    function imageLine(text, opts) {
        requireCanvasImagePrint();
        return escStarRowsFromImageData(renderTextBand(String(text == null ? '' : text), opts));
    }

    function imageAmountLine(label, value, opts) {
        requireCanvasImagePrint();
        return escStarRowsFromImageData(renderLabeledValueBand(label, value, opts));
    }

    function imageItemLine(qtyText, name, price, opts) {
        requireCanvasImagePrint();
        return escStarRowsFromImageData(renderQtyNamePriceBand(qtyText, name, price, opts));
    }

    function imageSeparator() {
        requireCanvasImagePrint();
        return escStarRowsFromImageData(renderSeparatorBand({ height: 18 }));
    }

    P.VERSION = SDK_VERSION;
    P.RECEIPT_DOT_WIDTH = RECEIPT_DOT_WIDTH;
    P.formatYen = formatYen;
    P.sanitizeReceiptText = sanitizeReceiptText;
    P.wrapReceiptText = wrapReceiptText;
    P.concatBytes = concatBytes;
    P.cmdInit = cmdInit;
    P.cmdFeed = cmdFeed;
    P.cmdFeedDots = cmdFeedDots;
    P.cmdCut = cmdCut;
    P.supportsCanvasImagePrint = supportsCanvasImagePrint;
    P.renderBannerEscStar = renderBannerEscStar;
    P.imageLine = imageLine;
    P.imageAmountLine = imageAmountLine;
    P.imageItemLine = imageItemLine;
    P.imageSeparator = imageSeparator;
    P.LOAD_TEST_STRIP_DOTS = LOAD_TEST_STRIP_DOTS;
    P.LOAD_TEST_CHUNK_DOTS = LOAD_TEST_CHUNK_DOTS;
    P.renderLoadTestFade = renderLoadTestFade;
    P.renderLoadTestFadeParts = renderLoadTestFadeParts;
    P.renderLoadTestGrid = renderLoadTestGrid;
    P.renderLoadTestGridParts = renderLoadTestGridParts;
})(typeof window !== 'undefined' ? window : globalThis);
