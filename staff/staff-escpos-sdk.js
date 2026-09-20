/**
 * GENERATED from js-sdk/core/consumption-tax.js + js-sdk/printer/{printer-codec,printer-receipt,printer-modes,printer-transport,printer-drivers,printer-sdk}.js — do not edit.
 * Rebuild: node scripts/bundle-staff-js.mjs
 */

;/* --- core/consumption-tax.js --- */
/**
 * インボイス制度対応の消費税計算（ブラウザ SDK）。
 */
(function (global) {
    'use strict';

    var RATE_8 = 0.08;
    var RATE_10 = 0.10;

    var TaxCategory = {
        STANDARD: 'STANDARD',
        REDUCED: 'REDUCED',
        CUSTOM: 'CUSTOM'
    };

    var ServiceSessionType = {
        DINE_IN: 'DINE_IN',
        TAKEOUT: 'TAKEOUT'
    };

    function normalizeTaxCategory(value) {
        var raw = String(value || TaxCategory.STANDARD).trim().toUpperCase();
        if (raw === TaxCategory.CUSTOM) {
            return TaxCategory.CUSTOM;
        }
        return raw === TaxCategory.REDUCED ? TaxCategory.REDUCED : TaxCategory.STANDARD;
    }

    function sanitizeCustomTaxRatePercent(value) {
        var n = Math.round(Number(value) || 0);
        if (n < 1) {
            return 1;
        }
        if (n > 100) {
            return 100;
        }
        return n;
    }

    function normalizeSessionType(value) {
        var raw = String(value || ServiceSessionType.DINE_IN).trim().toUpperCase();
        return raw === ServiceSessionType.TAKEOUT ? ServiceSessionType.TAKEOUT : ServiceSessionType.DINE_IN;
    }

    function resolveEffectiveRate(taxCategory, sessionType, customTaxRatePercent) {
        var category = normalizeTaxCategory(taxCategory);
        var session = normalizeSessionType(sessionType);
        if (category === TaxCategory.CUSTOM) {
            return sanitizeCustomTaxRatePercent(customTaxRatePercent) / 100;
        }
        if (category === TaxCategory.REDUCED && session === ServiceSessionType.TAKEOUT) {
            return RATE_8;
        }
        return RATE_10;
    }

    function deriveBaseFromTaxInclusive(taxInclusivePrice, taxCategory, referenceSessionType, customTaxRatePercent) {
        var price = Number(taxInclusivePrice) || 0;
        if (price <= 0) {
            return 0;
        }
        var rate = resolveEffectiveRate(taxCategory, referenceSessionType, customTaxRatePercent);
        return Math.round(price / (1 + rate));
    }

    function deriveTaxInclusiveFromBase(basePrice, taxCategory, sessionType, customTaxRatePercent) {
        var base = Number(basePrice) || 0;
        if (base <= 0) {
            return 0;
        }
        var rate = resolveEffectiveRate(taxCategory, sessionType, customTaxRatePercent);
        return Math.round(base * (1 + rate));
    }

    function migrateLegacyTaxInclusivePrice(legacyPrice) {
        return deriveBaseFromTaxInclusive(legacyPrice, TaxCategory.STANDARD, ServiceSessionType.DINE_IN);
    }

    function floorTax(baseAmount, rate) {
        var base = Number(baseAmount) || 0;
        if (base <= 0) {
            return 0;
        }
        return Math.floor(base * rate);
    }

    /**
     * @param {Array<{basePrice:number,taxCategory:string,quantity:number}>} cartItems
     * @param {string} sessionType DINE_IN | TAKEOUT
     */
    function calculateOrderTotals(cartItems, sessionType) {
        var session = normalizeSessionType(sessionType);
        var baseByRate = { 0.08: 0, 0.10: 0 };
        var baseTotal = 0;

        (Array.isArray(cartItems) ? cartItems : []).forEach(function (line) {
            if (!line) {
                return;
            }
            var qty = Number(line.quantity) || 0;
            if (qty <= 0) {
                return;
            }
            var unitBase = Number(line.basePrice) || 0;
            var lineBase = unitBase * qty;
            baseTotal += lineBase;
            var rate = resolveEffectiveRate(line.taxCategory, session, line.customTaxRatePercent);
            baseByRate[rate] = (baseByRate[rate] || 0) + lineBase;
        });

        var tax8 = floorTax(baseByRate[RATE_8], RATE_8);
        var tax10 = floorTax(baseByRate[RATE_10], RATE_10);
        var totalTax = 0;
        var taxByRate = [];
        Object.keys(baseByRate).forEach(function (rateKey) {
            var rate = Number(rateKey);
            var base = baseByRate[rateKey] || 0;
            if (!Number.isFinite(rate) || base <= 0) {
                return;
            }
            var tax = floorTax(base, rate);
            totalTax += tax;
            taxByRate.push({
                percent: Math.round(rate * 100),
                rate: rate,
                base: base,
                tax: tax
            });
        });
        taxByRate.sort(function (a, b) {
            return b.percent - a.percent;
        });
        return {
            baseTotal: baseTotal,
            tax8: tax8,
            tax10: tax10,
            totalTax: totalTax,
            taxByRate: taxByRate,
            grandTotal: baseTotal + totalTax
        };
    }

    /**
     * カート合計（税込）。明細に basePrice が無い場合は priceAtOrder を店内10%標準で逆算。
     */
    function calculateCartGrandTotal(cartItems, sessionType) {
        var session = normalizeSessionType(sessionType);
        var lines = (Array.isArray(cartItems) ? cartItems : []).map(function (item) {
            if (!item) {
                return null;
            }
            var qty = Number(item.quantity) || 0;
            if (qty <= 0) {
                return null;
            }
            var base = Number(item.basePrice);
            if (!Number.isFinite(base) || base <= 0) {
                var unitInclusive = Number(item.priceAtOrder || item.unitPrice || 0)
                    + Number(item.toppingPrice || 0);
                base = deriveBaseFromTaxInclusive(
                    unitInclusive,
                    item.taxCategory || TaxCategory.STANDARD,
                    ServiceSessionType.DINE_IN,
                    item.customTaxRatePercent
                );
            } else {
                base += Number(item.toppingBasePrice || item.toppingPrice || 0);
            }
            return {
                basePrice: base,
                taxCategory: item.taxCategory || TaxCategory.STANDARD,
                customTaxRatePercent: item.customTaxRatePercent,
                quantity: qty
            };
        }).filter(function (line) { return !!line; });
        return calculateOrderTotals(lines, session).grandTotal;
    }

    var api = {
        TaxCategory: TaxCategory,
        ServiceSessionType: ServiceSessionType,
        RATE_8: RATE_8,
        RATE_10: RATE_10,
        resolveEffectiveRate: resolveEffectiveRate,
        deriveBaseFromTaxInclusive: deriveBaseFromTaxInclusive,
        deriveTaxInclusiveFromBase: deriveTaxInclusiveFromBase,
        sanitizeCustomTaxRatePercent: sanitizeCustomTaxRatePercent,
        migrateLegacyTaxInclusivePrice: migrateLegacyTaxInclusivePrice,
        calculateOrderTotals: calculateOrderTotals,
        calculateCartGrandTotal: calculateCartGrandTotal
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    global.MasterOrderConsumptionTax = api;
}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this));

;/* --- printer/printer-codec.js --- */
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

;/* --- printer/printer-receipt.js --- */
/**
 * MasterOrder Printer — receipt IIFE
 * ロゴ一気 → 本文一気。日本語は codec の ESC * ビットマップに任せる。
 * 依存: printer-codec.js（MasterOrderPrinter）
 */
(function (global) {
    'use strict';

    var P = global.MasterOrderPrinter;
    if (!P || typeof P.concatBytes !== 'function') {
        throw new Error('MasterOrderPrinter codec が先に読み込まれていません');
    }
    var concatBytes = P.concatBytes;
    var cmdInit = P.cmdInit;
    var cmdFeed = P.cmdFeed;
    var cmdCut = P.cmdCut;
    var formatYen = P.formatYen;
    var supportsCanvasImagePrint = P.supportsCanvasImagePrint;
    var renderBannerEscStar = P.renderBannerEscStar;
    var imageLine = P.imageLine;
    var imageAmountLine = P.imageAmountLine;
    var imageItemLine = P.imageItemLine;
    var imageSeparator = P.imageSeparator;
    var renderLoadTestFade = P.renderLoadTestFade;
    var renderLoadTestGrid = P.renderLoadTestGrid;
    var renderLoadTestFadeParts = P.renderLoadTestFadeParts;
    var renderLoadTestGridParts = P.renderLoadTestGridParts;
    var LOAD_TEST_STRIP_DOTS = P.LOAD_TEST_STRIP_DOTS || 816;
    var RECEIPT_TYPE = {
        // height は ESC * 24dot の倍数にしてバンド境界で切れないようにする
        title: { fontSize: 30, height: 48 },
        shop: { fontSize: 28, height: 48 },
        body: { fontSize: 26, height: 48 },
        meta: { fontSize: 26, height: 48 },
        item: { fontSize: 26, height: 48 },
        topping: { fontSize: 24, height: 48 },
        amount: { fontSize: 26, height: 48 },
        total: { fontSize: 30, height: 48 },
        footer: { fontSize: 26, height: 48 },
        contact: { fontSize: 26, height: 48 },
        small: { fontSize: 24, height: 48 }
    };

    var PREVIEW_SAMPLE = {
        tableNumber: 3,
        totalAmount: 1880,
        archiveId: 'SAMPLE-ARCHIVE-ID',
        payment: {
            paymentMethod: 'CASH',
            cashReceived: 3000,
            changeYen: 1120
        },
        lines: [
            {
                menuName: 'サンプルハンバーグ',
                quantity: 1,
                lineTotal: 1280,
                unitPrice: 1280,
                taxCategory: 'STANDARD',
                toppings: [
                    { name: 'チーズ', price: 100 },
                    { name: '目玉焼き', price: 120 }
                ]
            },
            {
                menuName: 'アイスコーヒー',
                quantity: 2,
                lineTotal: 900,
                unitPrice: 450,
                taxCategory: 'CUSTOM',
                customTaxRatePercent: 8
            },
            { menuName: '【クーポン】激辛フェス', quantity: 1, lineTotal: -300, kind: 'coupon' },
            { menuName: '本日のサラダ', quantity: 1, lineTotal: 680, cancelled: true }
        ]
    };

    function shopFieldsFromShop(shop) {
        var s = shop || {};
        return {
            name: s.name || '',
            address: s.address || '',
            phone: s.phoneNumber || s.phone || '',
            phoneNumber: s.phoneNumber || s.phone || '',
            receiptGreeting: s.receiptGreeting || '',
            receiptFooter: s.receiptFooter || '',
            homepageUrl: s.homepageUrl || '',
            receiptPrintCancelledLines: s.receiptPrintCancelledLines !== false,
            bannerOnReceipt: !!s.bannerOnReceipt,
            bannerUrl: s.bannerUrl || s.logoUrl || '',
            logoUrl: s.logoUrl || s.bannerUrl || ''
        };
    }

    function isReceiptLineCancelled(order, item) {
        if (order && String(order.status || '').toUpperCase() === 'CANCELLED') {
            return true;
        }
        if (!item) {
            return false;
        }
        if (item.cancelled === true) {
            return true;
        }
        var qty = Number(item.quantity || 0);
        var cancelledQty = Number(item.cancelledQuantity || 0);
        return qty > 0 && cancelledQty >= qty;
    }

    function normalizeReceiptToppings(rawToppings, lineQuantity) {
        var list;
        if (Array.isArray(rawToppings)) {
            list = rawToppings;
        } else if (rawToppings && typeof rawToppings === 'object') {
            // 単体オブジェクトや { toppings: [...] } の取りこぼし防止
            list = Array.isArray(rawToppings.toppings) ? rawToppings.toppings : [rawToppings];
        } else {
            list = [];
        }
        var qty = Number(lineQuantity) > 0 ? Number(lineQuantity) : 1;
        var out = [];
        for (var i = 0; i < list.length; i += 1) {
            var tp = list[i];
            if (tp == null) {
                continue;
            }
            if (typeof tp === 'string' || typeof tp === 'number') {
                var asName = String(tp).trim();
                if (!asName) {
                    continue;
                }
                out.push({ name: asName, price: 0, lineTotal: 0 });
                continue;
            }
            var name = String(
                tp.name
                || tp.toppingName
                || tp.displayName
                || tp.menuName
                || tp.topping_name
                || ''
            ).trim();
            if (!name) {
                continue;
            }
            var unitPrice = tp.price != null
                ? Number(tp.price)
                : (tp.toppingPrice != null
                    ? Number(tp.toppingPrice)
                    : (tp.unitPrice != null
                        ? Number(tp.unitPrice)
                        : (tp.topping_price != null ? Number(tp.topping_price) : 0)));
            if (!Number.isFinite(unitPrice)) {
                unitPrice = 0;
            }
            out.push({
                name: name,
                price: unitPrice,
                lineTotal: unitPrice * qty
            });
        }
        return out;
    }

    function extractItemToppings(item) {
        var it = item || {};
        if (Array.isArray(it.toppings) && it.toppings.length) {
            return it.toppings;
        }
        if (Array.isArray(it.selectedToppings) && it.selectedToppings.length) {
            return it.selectedToppings;
        }
        if (Array.isArray(it.selectedToppingSnapshots) && it.selectedToppingSnapshots.length) {
            return it.selectedToppingSnapshots;
        }
        if (Array.isArray(it.toppingNames) && it.toppingNames.length) {
            return it.toppingNames;
        }
        return [];
    }

    var COUPON_RECEIPT_PREFIX = '【クーポン】';

    function isCouponReceiptLine(order, item) {
        var it = item || {};
        if (it.kind === 'coupon' || it.coupon === true || it.discountPreset === true) {
            return true;
        }
        if (order && order.discountPreset === true) {
            return true;
        }
        var name = String(it.name || it.menuName || '').trim();
        return name.indexOf(COUPON_RECEIPT_PREFIX) === 0;
    }

    function couponReceiptTitle(item) {
        var name = String((item && (item.name || item.menuName)) || '').trim();
        if (name.indexOf(COUPON_RECEIPT_PREFIX) === 0) {
            name = name.slice(COUPON_RECEIPT_PREFIX.length).trim();
        }
        return name || 'クーポン';
    }

    /**
     * セッション詳細（orderHistory）→ 公式レシート lines。
     * @param {object} detail
     * @returns {Array<object>}
     */
    function flattenSessionReceiptLines(detail) {
        var d = detail || {};
        var orders = Array.isArray(d.orderHistory)
            ? d.orderHistory
            : (Array.isArray(d.orders) ? d.orders : []);
        var out = [];
        for (var oi = 0; oi < orders.length; oi += 1) {
            var order = orders[oi] || {};
            var items = Array.isArray(order.items)
                ? order.items
                : (Array.isArray(order.lines) ? order.lines : []);
            for (var ii = 0; ii < items.length; ii += 1) {
                var item = items[ii] || {};
                var qty = Number(item.quantity != null ? item.quantity : 0);
                var cancelledQty = Number(item.cancelledQuantity || 0);
                var activeQty = Math.max(0, qty - cancelledQty);
                var cancelled = isReceiptLineCancelled(order, item);
                var printQty = cancelled ? qty : (activeQty > 0 ? activeQty : qty);
                var lineTotal = item.subTotal != null
                    ? Number(item.subTotal)
                    : (item.lineTotal != null
                        ? Number(item.lineTotal)
                        : Number(item.unitPrice || 0) * (printQty || 1));
                var toppings = normalizeReceiptToppings(
                    extractItemToppings(item),
                    printQty > 0 ? printQty : 1
                );
                var customTaxRate = item.customTaxRatePercentAtOrder != null
                    ? item.customTaxRatePercentAtOrder
                    : item.customTaxRatePercent;
                out.push({
                    menuName: String(item.menuName || item.name || '').trim() || '不明メニュー',
                    name: String(item.menuName || item.name || '').trim() || '不明メニュー',
                    quantity: printQty,
                    unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
                    basePrice: item.basePrice != null
                        ? Number(item.basePrice)
                        : (item.basePriceAtOrder != null ? Number(item.basePriceAtOrder) : null),
                    lineTotal: Number.isFinite(lineTotal) ? lineTotal : 0,
                    cancelled: cancelled,
                    kind: isCouponReceiptLine(order, item) ? 'coupon' : 'item',
                    taxCategory: item.taxCategoryAtOrder || item.taxCategory || null,
                    customTaxRatePercent: customTaxRate != null ? Number(customTaxRate) : null,
                    toppings: toppings
                });
            }
        }
        return out;
    }

    /**
     * 領収書プレビューと同じ構成の本番向けサンプル payload。
     * @param {object} shop
     * @returns {object}
     */
    function buildPreviewSampleReceiptPayload(shop) {
        return {
            shop: shopFieldsFromShop(shop),
            session: {
                tableNumber: PREVIEW_SAMPLE.tableNumber,
                totalAmount: PREVIEW_SAMPLE.totalAmount,
                archiveId: PREVIEW_SAMPLE.archiveId
            },
            payment: {
                paymentMethod: PREVIEW_SAMPLE.payment.paymentMethod,
                cashReceived: PREVIEW_SAMPLE.payment.cashReceived,
                changeYen: PREVIEW_SAMPLE.payment.changeYen
            },
            lines: PREVIEW_SAMPLE.lines.map(function (line) {
                return {
                    menuName: line.menuName,
                    quantity: line.quantity,
                    unitPrice: line.unitPrice != null ? line.unitPrice : null,
                    lineTotal: line.lineTotal,
                    cancelled: !!line.cancelled,
                    kind: line.kind || 'item',
                    taxCategory: line.taxCategory || null,
                    customTaxRatePercent: line.customTaxRatePercent != null
                        ? line.customTaxRatePercent
                        : null,
                    toppings: normalizeReceiptToppings(line.toppings, line.quantity)
                };
            }),
            printedAt: new Date(),
            totalAmount: PREVIEW_SAMPLE.totalAmount,
            sessionType: 'DINE_IN'
        };
    }

    /**
     * 会計後印刷用に payload を正規化。
     * @param {object} ctx
     * @returns {object}
     */
    function buildCheckoutReceiptPayload(ctx) {
        var c = ctx || {};
        var shop = shopFieldsFromShop(c.shop);
        var lines = Array.isArray(c.lines) ? c.lines : null;
        if ((!lines || !lines.length) && c.sessionDetail) {
            lines = flattenSessionReceiptLines(c.sessionDetail);
        }
        if (!lines) {
            lines = [];
        }
        var checkoutResult = c.checkoutResult || {};
        return {
            shop: shop,
            session: {
                sessionId: c.sessionId,
                tableNumber: c.tableNumber,
                totalAmount: c.totalAmount,
                archiveId: checkoutResult.archiveId || checkoutResult.id || c.archiveId || c.sessionId || null,
                checkedOutAt: c.printedAt || new Date()
            },
            payment: c.payment || {},
            lines: lines,
            printedAt: c.printedAt || new Date(),
            totalAmount: c.totalAmount,
            sessionType: c.sessionType
                || (c.sessionDetail && (c.sessionDetail.sessionType || c.sessionDetail.serviceSessionType))
                || 'DINE_IN'
        };
    }

    function receiptLineActiveQuantity(item) {
        if (!item || item.cancelled) {
            return 0;
        }
        if (isCouponReceiptLine(null, item)) {
            return 0;
        }
        var qty = Number(item.quantity);
        return Number.isFinite(qty) && qty > 0 ? qty : 0;
    }

    function receiptTaxApi() {
        return global.MasterOrderConsumptionTax
            || (typeof globalThis !== 'undefined' ? globalThis.MasterOrderConsumptionTax : null)
            || (typeof window !== 'undefined' ? window.MasterOrderConsumptionTax : null)
            || null;
    }

    function receiptEffectiveRate(taxCategory, sessionType, customTaxRatePercent) {
        var tax = receiptTaxApi();
        if (tax && typeof tax.resolveEffectiveRate === 'function') {
            return tax.resolveEffectiveRate(taxCategory, sessionType, customTaxRatePercent);
        }
        var cat = String(taxCategory || 'STANDARD').trim().toUpperCase();
        if (cat === 'CUSTOM') {
            var n = Math.round(Number(customTaxRatePercent) || 0);
            if (n < 1) {
                n = 1;
            }
            if (n > 100) {
                n = 100;
            }
            return n / 100;
        }
        var session = String(sessionType || 'DINE_IN').trim().toUpperCase();
        if (cat === 'REDUCED' && session === 'TAKEOUT') {
            return 0.08;
        }
        return 0.10;
    }

    function receiptInclusiveToBase(inclusive, taxCategory, sessionType, customTaxRatePercent) {
        var tax = receiptTaxApi();
        if (tax && typeof tax.deriveBaseFromTaxInclusive === 'function') {
            return tax.deriveBaseFromTaxInclusive(
                inclusive,
                taxCategory,
                sessionType,
                customTaxRatePercent
            );
        }
        var price = Number(inclusive) || 0;
        if (!(price > 0)) {
            return 0;
        }
        return Math.round(price / (1 + receiptEffectiveRate(taxCategory, sessionType, customTaxRatePercent)));
    }

    function calculateReceiptTaxTotals(cart, sessionType) {
        var tax = receiptTaxApi();
        if (tax && typeof tax.calculateOrderTotals === 'function') {
            var totals = tax.calculateOrderTotals(cart, sessionType);
            if (totals && Array.isArray(totals.taxByRate) && totals.taxByRate.length) {
                return totals;
            }
            if (totals) {
                var rows = [];
                var totalTax = 0;
                if (Number(totals.tax10) > 0) {
                    rows.push({ percent: 10, rate: 0.10, base: 0, tax: Number(totals.tax10) });
                    totalTax += Number(totals.tax10);
                }
                if (Number(totals.tax8) > 0) {
                    rows.push({ percent: 8, rate: 0.08, base: 0, tax: Number(totals.tax8) });
                    totalTax += Number(totals.tax8);
                }
                if (rows.length) {
                    totals.taxByRate = rows;
                    totals.totalTax = totalTax;
                    return totals;
                }
            }
        }
        var baseByRate = {};
        var i;
        for (i = 0; i < cart.length; i += 1) {
            var line = cart[i];
            var qty = Number(line.quantity) || 0;
            var unitBase = Number(line.basePrice) || 0;
            if (qty <= 0 || unitBase <= 0) {
                continue;
            }
            var rate = receiptEffectiveRate(line.taxCategory, sessionType, line.customTaxRatePercent);
            var key = String(rate);
            baseByRate[key] = (baseByRate[key] || 0) + (unitBase * qty);
        }
        var taxByRate = [];
        var totalTaxLocal = 0;
        var keys = Object.keys(baseByRate);
        for (i = 0; i < keys.length; i += 1) {
            var r = Number(keys[i]);
            var base = baseByRate[keys[i]] || 0;
            if (!Number.isFinite(r) || base <= 0) {
                continue;
            }
            var taxAmt = Math.floor(base * r);
            if (!(taxAmt > 0)) {
                continue;
            }
            totalTaxLocal += taxAmt;
            taxByRate.push({
                percent: Math.round(r * 100),
                rate: r,
                base: base,
                tax: taxAmt
            });
        }
        taxByRate.sort(function (a, b) {
            return b.percent - a.percent;
        });
        if (!taxByRate.length) {
            return null;
        }
        return {
            taxByRate: taxByRate,
            totalTax: totalTaxLocal
        };
    }

    /**
     * 税抜本体を税率ごとに集計し、インボイス方式で消費税を算出する。
     * 明細の税込単価から税抜を逆算してから、税率ごとに切り捨てる。
     */
    function computeReceiptTaxBreakdown(lines, sessionType) {
        var tax = receiptTaxApi();
        var session = sessionType
            || (tax && tax.ServiceSessionType && tax.ServiceSessionType.DINE_IN)
            || 'DINE_IN';
        var cart = [];
        var list = Array.isArray(lines) ? lines : [];
        for (var i = 0; i < list.length; i += 1) {
            var item = list[i];
            var qty = receiptLineActiveQuantity(item);
            if (!item || qty <= 0) {
                continue;
            }
            var category = item.taxCategory
                || (tax && tax.TaxCategory && tax.TaxCategory.STANDARD)
                || 'STANDARD';
            var customPercent = item.customTaxRatePercent;
            var unitBase = Number(item.basePrice);
            if (!Number.isFinite(unitBase) || unitBase <= 0) {
                var unitInclusive = Number(item.unitPrice);
                if (Number.isFinite(unitInclusive) && unitInclusive > 0) {
                    unitBase = receiptInclusiveToBase(
                        unitInclusive,
                        category,
                        session,
                        customPercent
                    );
                }
            }
            if (!Number.isFinite(unitBase) || unitBase <= 0) {
                var lineInclusive = Number(item.lineTotal != null ? item.lineTotal : item.subTotal);
                if (Number.isFinite(lineInclusive) && lineInclusive > 0) {
                    unitBase = receiptInclusiveToBase(
                        lineInclusive,
                        category,
                        session,
                        customPercent
                    );
                    qty = 1;
                }
            }
            if (!Number.isFinite(unitBase) || unitBase <= 0) {
                continue;
            }
            cart.push({
                basePrice: unitBase,
                taxCategory: category,
                customTaxRatePercent: customPercent,
                quantity: qty
            });
        }
        if (!cart.length) {
            return null;
        }
        return calculateReceiptTaxTotals(cart, session);
    }

    function pushReceiptTaxBreakdown(pushBody, lines, sessionType) {
        var breakdown = computeReceiptTaxBreakdown(lines, sessionType);
        if (!breakdown) {
            return;
        }
        var rows = breakdown.taxByRate;
        var printed = 0;
        for (var i = 0; i < rows.length; i += 1) {
            var row = rows[i];
            if (!row || !(row.tax > 0)) {
                continue;
            }
            pushBody(imageAmountLine(
                String(row.percent) + '%',
                formatYen(row.tax),
                RECEIPT_TYPE.amount
            ));
            printed += 1;
        }
        if (!printed) {
            return;
        }
        pushBody(imageAmountLine(
            '税金合計',
            formatYen(breakdown.totalTax),
            RECEIPT_TYPE.amount
        ));
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
     * 公式レシートを 2 バーストで返す: [ロゴ] [本文]。
     * ロゴなし（テスト印刷）は本文 1 塊だけなので速い。
     * @returns {Promise<{ parts: Uint8Array[], totalBytes: number, hasBanner: boolean }>}
     */
    async function buildOfficialReceiptParts(payload) {
        var p = payload || {};
        var shop = p.shop || {};
        var session = p.session || {};
        var payment = p.payment || {};
        var lines = Array.isArray(p.lines) ? p.lines : [];
        if (!supportsCanvasImagePrint()) {
            throw new Error('レシート印字には Canvas が必要です');
        }

        var hasBanner = false;
        var logoChunks = [cmdInit()];
        var bannerUrl = shop.bannerUrl || shop.logoUrl || p.bannerUrl || '';
        var wantBanner = shop.bannerOnReceipt === true || p.forceBanner === true;
        if (wantBanner && bannerUrl && p.skipBanner !== true) {
            try {
                var bannerBytes = await renderBannerEscStar(bannerUrl, { maxHeight: 96 });
                if (bannerBytes && bannerBytes.length) {
                    logoChunks.push(bannerBytes);
                    logoChunks.push(cmdFeed(1));
                    hasBanner = true;
                } else if (typeof console !== 'undefined' && console.warn) {
                    console.warn('receipt banner empty after render', bannerUrl);
                }
            } catch (bannerErr) {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('receipt banner skipped', bannerErr);
                }
            }
        } else if (wantBanner && !bannerUrl && typeof console !== 'undefined' && console.warn) {
            console.warn('receipt banner requested but URL missing');
        }

        var bodyAcc = hasBanner ? [] : [cmdInit()];
        function pushBody(chunk) {
            if (!chunk || !chunk.length) {
                return;
            }
            bodyAcc.push(chunk);
        }

        // ② 店舗名
        pushBody(imageLine('ご利用明細', Object.assign({ align: 'center' }, RECEIPT_TYPE.title)));
        if (shop.name) {
            pushBody(imageLine(String(shop.name), Object.assign({ align: 'center' }, RECEIPT_TYPE.shop)));
        }
        pushBody(cmdFeed(1));

        // ③ 店の一言
        if (shop.receiptGreeting) {
            pushBody(imageLine(String(shop.receiptGreeting), Object.assign({ align: 'left' }, RECEIPT_TYPE.body)));
            pushBody(cmdFeed(1));
        }

        // ④ 注文内容
        var tableLabel = session.tableNumber != null ? '席 ' + session.tableNumber : '';
        var when = formatDateTime(session.checkedOutAt || session.endTime || session.startTime || p.printedAt);
        if (tableLabel || when) {
            pushBody(imageLine([tableLabel, when].filter(Boolean).join('  '), RECEIPT_TYPE.meta));
        }
        pushBody(imageSeparator());
        for (var i = 0; i < lines.length; i += 1) {
            var item = lines[i] || {};
            if (item.cancelled && shop.receiptPrintCancelledLines === false) {
                continue;
            }
            var name = String(item.name || item.menuName || '');
            if (item.cancelled) {
                name = '[取消] ' + name;
            }
            var qtyLabel = item.quantity != null && item.quantity !== ''
                ? ('x' + item.quantity)
                : '';
            var price = item.lineTotal != null
                ? formatYen(item.lineTotal)
                : (item.unitPrice != null ? formatYen(item.unitPrice) : '');
            if (isCouponReceiptLine(null, item)) {
                var couponName = couponReceiptTitle(item);
                if (item.cancelled) {
                    couponName = '[取消] ' + couponName;
                }
                pushBody(imageLine(COUPON_RECEIPT_PREFIX, RECEIPT_TYPE.meta));
                pushBody(imageItemLine('', couponName, price, RECEIPT_TYPE.item));
                continue;
            }
            pushBody(imageItemLine(qtyLabel, name, price, RECEIPT_TYPE.item));
            var toppings = normalizeReceiptToppings(
                extractItemToppings(item),
                item.quantity
            );
            for (var ti = 0; ti < toppings.length; ti += 1) {
                var tp = toppings[ti] || {};
                var tpName = '+ ' + String(tp.name || 'トッピング');
                var tpPrice = tp.lineTotal != null && Number(tp.lineTotal) !== 0
                    ? formatYen(tp.lineTotal)
                    : (tp.price != null && Number(tp.price) !== 0 ? formatYen(tp.price) : '');
                pushBody(imageItemLine('', tpName, tpPrice, RECEIPT_TYPE.topping));
            }
        }
        pushBody(imageSeparator());
        pushReceiptTaxBreakdown(pushBody, lines, p.sessionType || session.sessionType);
        var total = session.totalAmount != null ? session.totalAmount : p.totalAmount;
        pushBody(imageAmountLine('合計', formatYen(total), RECEIPT_TYPE.total));
        var method = String(payment.paymentMethod || payment.method || 'CASH').toUpperCase();
        if (method === 'CARD') {
            pushBody(imageAmountLine('支払', 'カード', RECEIPT_TYPE.amount));
        } else {
            pushBody(imageAmountLine('支払', '現金', RECEIPT_TYPE.amount));
            if (payment.cashReceived != null || payment.tenderedYen != null) {
                pushBody(imageAmountLine('お預かり', formatYen(payment.cashReceived != null
                    ? payment.cashReceived
                    : payment.tenderedYen), RECEIPT_TYPE.amount));
            }
            if (payment.changeYen != null) {
                pushBody(imageAmountLine('お釣り', formatYen(payment.changeYen), RECEIPT_TYPE.amount));
            }
        }
        pushBody(cmdFeed(1));

        // ⑤〜⑧
        if (shop.receiptFooter) {
            pushBody(imageLine(String(shop.receiptFooter), Object.assign({ align: 'center' }, RECEIPT_TYPE.footer)));
            pushBody(cmdFeed(1));
        }
        if (shop.homepageUrl) {
            pushBody(imageLine(String(shop.homepageUrl), Object.assign({ align: 'center' }, RECEIPT_TYPE.contact)));
            pushBody(cmdFeed(1));
        }
        if (session.archiveId || session.sessionId || p.archiveId) {
            pushBody(imageLine('Archive: ' + String(session.archiveId || p.archiveId || session.sessionId), RECEIPT_TYPE.small));
        }
        pushBody(cmdFeed(1));
        if (shop.address) {
            pushBody(imageLine(String(shop.address), Object.assign({ align: 'center' }, RECEIPT_TYPE.contact)));
        }
        if (shop.phone || shop.phoneNumber) {
            pushBody(imageLine('TEL ' + String(shop.phone || shop.phoneNumber), Object.assign({ align: 'center' }, RECEIPT_TYPE.contact)));
        }
        pushBody(cmdFeed(3));
        pushBody(cmdCut());

        var parts = [];
        if (hasBanner) {
            parts.push(concatBytes(logoChunks));
        }
        if (bodyAcc.length) {
            parts.push(concatBytes(bodyAcc));
        }

        var totalBytes = 0;
        for (var pi = 0; pi < parts.length; pi += 1) {
            totalBytes += parts[pi].length;
        }
        return { parts: parts, totalBytes: totalBytes, hasBanner: hasBanner };
    }

    /**
     * 公式テンプレ ①〜⑧ の ESC/POS バイト列を返す（単一バッファ。プレビュー/ダウンロード用）。
     * @param {object} payload
     * @returns {Promise<Uint8Array>}
     */
    async function buildOfficialReceiptBytes(payload) {
        var built = await buildOfficialReceiptParts(payload);
        return concatBytes(built.parts);
    }

    /**
     * 印刷調整用。黒→白 10cm + 格子 10cm。意図的に ESC* を厚くする。
     */
    function buildPrinterLoadTestParts() {
        if (!supportsCanvasImagePrint()) {
            throw new Error('レシート印字には Canvas が必要です');
        }
        var fadeChunks = typeof renderLoadTestFadeParts === 'function'
            ? renderLoadTestFadeParts(LOAD_TEST_STRIP_DOTS)
            : (typeof renderLoadTestFade === 'function' ? [renderLoadTestFade(LOAD_TEST_STRIP_DOTS)] : []);
        var gridChunks = typeof renderLoadTestGridParts === 'function'
            ? renderLoadTestGridParts(LOAD_TEST_STRIP_DOTS)
            : (typeof renderLoadTestGrid === 'function' ? [renderLoadTestGrid(LOAD_TEST_STRIP_DOTS)] : []);
        if (!fadeChunks.length || !gridChunks.length) {
            throw new Error('印刷調整パターンを作れません');
        }
        var labelOpts = Object.assign({ align: 'center' }, RECEIPT_TYPE.body);
        var fadeParts = [concatBytes([cmdInit(), imageLine('印刷調整 黒から白 10cm', labelOpts)])].concat(fadeChunks);
        var gridParts = [imageLine('印刷調整 格子 10cm', labelOpts)].concat(gridChunks, [concatBytes([cmdFeed(3), cmdCut()])]);
        var i;
        var totalBytes = 0;
        for (i = 0; i < fadeParts.length; i += 1) {
            totalBytes += fadeParts[i].length;
        }
        for (i = 0; i < gridParts.length; i += 1) {
            totalBytes += gridParts[i].length;
        }
        return {
            fadeParts: fadeParts,
            gridParts: gridParts,
            parts: [concatBytes(fadeParts), concatBytes(gridParts)],
            totalBytes: totalBytes,
            hasBanner: false
        };
    }

    P.PREVIEW_SAMPLE = PREVIEW_SAMPLE;
    P.shopFieldsFromShop = shopFieldsFromShop;
    P.flattenSessionReceiptLines = flattenSessionReceiptLines;
    P.buildPreviewSampleReceiptPayload = buildPreviewSampleReceiptPayload;
    P.buildCheckoutReceiptPayload = buildCheckoutReceiptPayload;
    P.buildOfficialReceiptParts = buildOfficialReceiptParts;
    P.buildOfficialReceiptBytes = buildOfficialReceiptBytes;
    P.buildPrinterLoadTestParts = buildPrinterLoadTestParts;
})(typeof window !== 'undefined' ? window : globalThis);

;/* --- printer/printer-modes.js --- */
/**
 * MasterOrder Printer — modes IIFE
 * マニュアル（従来の CDC 送り）と、Windows / スター精密 / Epson ドライバ。
 * 依存: printer-codec.js（MasterOrderPrinter）
 */
(function (global) {
    'use strict';

    var P = global.MasterOrderPrinter || (global.MasterOrderPrinter = {});
    var MODE_KEY = 'mo.staff.printerMode';
    var LAN_URL_KEY = 'mo.staff.printerLanUrl';
    var MODE_ESCPOS_MANUAL = 'escpos-manual';
    var MODE_ESCPOS_CDC = 'escpos-cdc';
    var MODE_WINDOWS_DRIVER = 'windows-driver';
    var MODE_STAR_PRNT = 'star-prnt';
    var MODE_EPSON_EPOS = 'epson-epos';

    var PRINTER_MODES = [
        {
            id: MODE_ESCPOS_MANUAL,
            label: 'マニュアル（ESC/POS）',
            ready: true,
            needsTune: true,
            needsLan: false,
            note: '安価な ESC/POS 互換機向け。バッファ容量と送り間隔を自分で指定します。Web Serial keep-open。'
        },
        {
            id: MODE_WINDOWS_DRIVER,
            label: 'OS 印刷ダイアログ',
            ready: true,
            needsTune: false,
            needsLan: false,
            note: 'ブラウザ／OS の印刷ダイアログが開きます。スマホでは AirPrint やシステムのプリンタ一覧から選べます。USB シリアルへは直接送りません。'
        },
        {
            id: MODE_STAR_PRNT,
            label: 'スター精密',
            ready: true,
            needsTune: true,
            needsLan: true,
            note: 'LAN の IP を入れると Star WebPRNT。空のままだと USB シリアルへ通常の ESC/POS を送ります（専用 Star コマンドではありません）。'
        },
        {
            id: MODE_EPSON_EPOS,
            label: 'EPSON ePOS',
            ready: true,
            needsTune: true,
            needsLan: true,
            note: 'LAN の IP を入れると ePOS XML。空のままだと USB シリアルへ通常の ESC/POS を送ります（ePOS SOAP ではありません）。'
        }
    ];

    function canonicalModeId(id) {
        var want = String(id || '');
        if (want === MODE_ESCPOS_CDC) {
            return MODE_ESCPOS_MANUAL;
        }
        return want;
    }

    function findPrinterMode(id) {
        var want = canonicalModeId(id);
        var i;
        for (i = 0; i < PRINTER_MODES.length; i += 1) {
            if (PRINTER_MODES[i].id === want) {
                return PRINTER_MODES[i];
            }
        }
        return null;
    }

    function listPrinterModes() {
        return PRINTER_MODES.slice();
    }

    function getPrinterMode() {
        try {
            var raw = global.localStorage && global.localStorage.getItem(MODE_KEY);
            var meta = findPrinterMode(raw);
            if (meta) {
                return meta.id;
            }
        } catch (_e) {
            /* ignore */
        }
        return MODE_ESCPOS_MANUAL;
    }

    function setPrinterMode(id) {
        var meta = findPrinterMode(id);
        if (!meta) {
            throw new Error('未知の印刷方式です');
        }
        if (!global.localStorage) {
            throw new Error('このブラウザでは印刷方式を保存できません');
        }
        global.localStorage.setItem(MODE_KEY, meta.id);
        return meta.id;
    }

    function isPrinterModeReady(id) {
        var meta = findPrinterMode(id || getPrinterMode());
        return !!(meta && meta.ready);
    }

    function isManualPrinterMode(id) {
        return canonicalModeId(id || getPrinterMode()) === MODE_ESCPOS_MANUAL;
    }

    function describePrinterMode(id) {
        var meta = findPrinterMode(id || getPrinterMode());
        if (!meta) {
            return '未知の印刷方式です';
        }
        if (meta.ready) {
            return meta.note;
        }
        return meta.label + ' は準備中です。いまはマニュアル（ESC/POS）を選んでください。';
    }

    function getPrinterLanUrl() {
        try {
            var raw = global.localStorage && global.localStorage.getItem(LAN_URL_KEY);
            return raw ? String(raw).trim() : '';
        } catch (_e) {
            return '';
        }
    }

    function setPrinterLanUrl(url) {
        if (!global.localStorage) {
            throw new Error('このブラウザではプリンタ URL を保存できません');
        }
        var value = String(url == null ? '' : url).trim();
        if (!value) {
            global.localStorage.removeItem(LAN_URL_KEY);
            return '';
        }
        global.localStorage.setItem(LAN_URL_KEY, value);
        return value;
    }

    P.PRINTER_MODE_KEY = MODE_KEY;
    P.PRINTER_LAN_URL_KEY = LAN_URL_KEY;
    P.PRINTER_MODE_ESCPOS_MANUAL = MODE_ESCPOS_MANUAL;
    P.PRINTER_MODE_ESCPOS_CDC = MODE_ESCPOS_CDC;
    P.PRINTER_MODE_WINDOWS_DRIVER = MODE_WINDOWS_DRIVER;
    P.PRINTER_MODE_STAR_PRNT = MODE_STAR_PRNT;
    P.PRINTER_MODE_EPSON_EPOS = MODE_EPSON_EPOS;
    P.listPrinterModes = listPrinterModes;
    P.getPrinterMode = getPrinterMode;
    P.setPrinterMode = setPrinterMode;
    P.isPrinterModeReady = isPrinterModeReady;
    P.isManualPrinterMode = isManualPrinterMode;
    P.describePrinterMode = describePrinterMode;
    P.getPrinterLanUrl = getPrinterLanUrl;
    P.setPrinterLanUrl = setPrinterLanUrl;
})(typeof window !== 'undefined' ? window : globalThis);

;/* --- printer/printer-transport.js --- */
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

;/* --- printer/printer-drivers.js --- */
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

;/* --- printer/printer-sdk.js --- */
/**
 * MasterOrder Printer — public facade IIFE
 * アプリは従来どおり MasterOrderStaffEscPosSdk を使う。
 * 依存: printer-codec.js → printer-receipt.js → printer-modes.js → printer-transport.js → printer-drivers.js
 */
(function (global) {
    'use strict';

    var P = global.MasterOrderPrinter;
    if (!P || typeof P.printOfficialReceipt !== 'function') {
        throw new Error('MasterOrderPrinter transport が先に読み込まれていません');
    }

    global.MasterOrderStaffEscPosSdk = {
        VERSION: P.VERSION,
        DEFAULT_PRINTER_KEY: P.DEFAULT_PRINTER_KEY,
        SERIAL_PACE_KEY: P.SERIAL_PACE_KEY,
        BUFFER_PRESETS: P.BUFFER_PRESETS,
        PACE_MS_PRESETS: P.PACE_MS_PRESETS,
        RECEIPT_DOT_WIDTH: P.RECEIPT_DOT_WIDTH,
        PREVIEW_SAMPLE: P.PREVIEW_SAMPLE,
        listPrinterModes: P.listPrinterModes,
        getPrinterMode: P.getPrinterMode,
        setPrinterMode: P.setPrinterMode,
        isPrinterModeReady: P.isPrinterModeReady,
        isManualPrinterMode: P.isManualPrinterMode,
        describePrinterMode: P.describePrinterMode,
        getActivePrintPath: P.getActivePrintPath,
        describeActivePrintPath: P.describeActivePrintPath,
        getPrinterLanUrl: P.getPrinterLanUrl,
        setPrinterLanUrl: P.setPrinterLanUrl,
        describeSerialPace: P.describeSerialPace,
        resetSerialPace: P.resetSerialPace,
        setManualBufferPace: P.setManualBufferPace,
        applyShopPrinterSettings: P.applyShopPrinterSettings,
        exportShopPrinterSettings: P.exportShopPrinterSettings,
        getManualBufferBytes: P.getManualBufferBytes,
        getManualPaceMs: P.getManualPaceMs,
        beginSerialPaceCalibration: P.beginSerialPaceCalibration,
        isSerialPaceAdjusted: P.isSerialPaceAdjusted,
        getSerialPaceId: P.getSerialPaceId,
        formatYen: P.formatYen,
        sanitizeReceiptText: P.sanitizeReceiptText,
        wrapReceiptText: P.wrapReceiptText,
        shopFieldsFromShop: P.shopFieldsFromShop,
        flattenSessionReceiptLines: P.flattenSessionReceiptLines,
        buildPreviewSampleReceiptPayload: P.buildPreviewSampleReceiptPayload,
        buildCheckoutReceiptPayload: P.buildCheckoutReceiptPayload,
        buildOfficialReceiptParts: P.buildOfficialReceiptParts,
        buildOfficialReceiptBytes: P.buildOfficialReceiptBytes,
        buildPrinterLoadTestParts: P.buildPrinterLoadTestParts,
        renderBannerEscStar: P.renderBannerEscStar,
        downloadReceiptBytes: P.downloadReceiptBytes,
        isNativePlatform: P.isNativePlatform,
        supportsNativePrinter: P.supportsNativePrinter,
        supportsUsb: P.supportsUsb,
        supportsSerial: P.supportsSerial,
        supportsBluetooth: P.supportsBluetooth,
        supportsWebBluetooth: P.supportsWebBluetooth,
        listConnectedPrinters: P.listConnectedPrinters,
        requestUsbPrinter: P.requestUsbPrinter,
        requestSerialPrinter: P.requestSerialPrinter,
        requestBluetoothSerialPrinter: P.requestBluetoothSerialPrinter,
        requestWebBluetoothPrinter: P.requestWebBluetoothPrinter,
        requestBluetoothPrinter: P.requestBluetoothPrinter,
        requestTcpPrinter: P.requestTcpPrinter,
        getDefaultPrinter: P.getDefaultPrinter,
        setDefaultPrinter: P.setDefaultPrinter,
        clearDefaultPrinter: P.clearDefaultPrinter,
        forgetPrinter: P.forgetPrinter,
        printOfficialReceipt: P.printOfficialReceipt
    };
})(typeof window !== 'undefined' ? window : globalThis);
