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

    function formatCouponYen(item) {
        var raw = item && item.lineTotal != null
            ? Number(item.lineTotal)
            : Number(item && item.unitPrice);
        if (!Number.isFinite(raw)) {
            raw = 0;
        }
        if (raw > 0) {
            raw = -raw;
        }
        return formatYen(raw);
    }

    /**
     * 円の整数だけを返す。小数・非数・安全整数外はまとめない（null）。
     */
    function receiptIntegerYen(value) {
        if (value == null || value === '') {
            return null;
        }
        var n = Number(value);
        if (!Number.isSafeInteger(n)) {
            return null;
        }
        return n;
    }

    function receiptFiniteYen(value) {
        if (value == null || value === '') {
            return null;
        }
        var n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    /**
     * 税区分キー。空欄は印字時と同じく STANDARD。
     * カスタムで 1〜100 の整数でない税率はまとめない（null）。
     */
    function receiptTaxMergeKey(line) {
        var tax = String((line && line.taxCategory) || 'STANDARD').trim().toUpperCase();
        if (tax !== 'REDUCED' && tax !== 'CUSTOM') {
            tax = 'STANDARD';
        }
        if (tax !== 'CUSTOM') {
            return tax;
        }
        var rate = receiptIntegerYen(line.customTaxRatePercent);
        if (rate == null || rate < 1 || rate > 100) {
            return null;
        }
        return tax + ':' + String(rate);
    }

    /**
     * 正の整数の税抜単価だけキーに載せる。
     * 片方だけ税抜単価がある行は、まとめ先の単価で消費税が変わるので null。
     * 0 と未設定は印字側が税込単価へ落ちるので同じ扱い。
     */
    function receiptBaseMergeKey(line) {
        if (line.basePrice == null || line.basePrice === '') {
            return '';
        }
        var base = receiptIntegerYen(line.basePrice);
        if (base == null || base < 0) {
            return null;
        }
        return base > 0 ? String(base) : '';
    }

    /**
     * トッピング名と単価の多重集合。並び順は無視する。
     * 単価が整数円でないトッピングを含む行はまとめない。
     */
    function receiptToppingMergeKey(line) {
        var toppings = normalizeReceiptToppings(extractItemToppings(line), 1);
        var parts = [];
        for (var i = 0; i < toppings.length; i += 1) {
            var tp = toppings[i] || {};
            var name = String(tp.name || '').trim();
            var price = receiptIntegerYen(tp.price);
            if (!name || price == null) {
                return null;
            }
            parts.push(JSON.stringify([name, price]));
        }
        parts.sort();
        return parts.join('|');
    }

    /**
     * まとめられる明細のキー。まとめない行は null。
     * 条件はすべて整数円で一致すること。
     * 税込小計が単価×数量と一致しない行（部分キャンセルの端数、値引き、欠測）は分けたまま。
     * クーポンと負の金額は1行のまま。
     */
    function receiptLineMergeKey(line) {
        if (!line || isCouponReceiptLine(null, line)) {
            return null;
        }
        var name = String(line.menuName || line.name || '').trim();
        if (!name) {
            return null;
        }
        var qty = receiptIntegerYen(line.quantity);
        var unit = receiptIntegerYen(line.unitPrice);
        var lineTotal = receiptIntegerYen(line.lineTotal);
        if (qty == null || qty <= 0 || unit == null || unit < 0 || lineTotal == null || lineTotal < 0) {
            return null;
        }
        var extended = unit * qty;
        var exact = Number.isSafeInteger(extended) && lineTotal === extended;
        // 全取消は API の小計が 0 円。実売（単価×数量）の取消とは混ぜない。
        var voided = !!line.cancelled && lineTotal === 0;
        if (!exact && !voided) {
            return null;
        }
        var taxKey = receiptTaxMergeKey(line);
        var baseKey = receiptBaseMergeKey(line);
        var toppingKey = receiptToppingMergeKey(line);
        if (taxKey == null || baseKey == null || toppingKey == null) {
            return null;
        }
        return [
            name,
            line.cancelled ? '1' : '0',
            exact ? 'E' : 'Z',
            String(unit),
            taxKey,
            baseKey,
            toppingKey
        ].join('\u0001');
    }

    function scaleReceiptToppings(toppings, quantity) {
        var qty = Number(quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
            qty = 1;
        }
        var list = Array.isArray(toppings) ? toppings : [];
        for (var i = 0; i < list.length; i += 1) {
            var price = Number(list[i] && list[i].price);
            if (!Number.isFinite(price)) {
                price = 0;
            }
            list[i].price = price;
            var extended = price * qty;
            list[i].lineTotal = Number.isSafeInteger(extended) ? extended : price;
        }
        return list;
    }

    function toppingScaleFits(toppings, quantity) {
        var qty = receiptIntegerYen(quantity);
        if (qty == null || qty <= 0) {
            return false;
        }
        var list = Array.isArray(toppings) ? toppings : [];
        for (var i = 0; i < list.length; i += 1) {
            var price = receiptIntegerYen(list[i] && list[i].price);
            if (price == null || !Number.isSafeInteger(price * qty)) {
                return false;
            }
        }
        return true;
    }

    function cloneReceiptLine(line) {
        var src = line || {};
        var qty = Number(src.quantity);
        if (!Number.isFinite(qty)) {
            qty = 0;
        }
        var coupon = isCouponReceiptLine(null, src);
        var name = String(src.name || src.menuName || '').trim();
        var menuName = src.menuName != null && String(src.menuName).trim()
            ? String(src.menuName).trim()
            : name;
        return {
            menuName: menuName,
            name: name || menuName,
            quantity: qty,
            unitPrice: receiptFiniteYen(src.unitPrice),
            basePrice: receiptFiniteYen(src.basePrice),
            lineTotal: receiptFiniteYen(src.lineTotal),
            cancelled: !!src.cancelled,
            kind: coupon ? 'coupon' : (src.kind || 'item'),
            coupon: coupon ? true : undefined,
            discountPreset: src.discountPreset === true ? true : undefined,
            taxCategory: src.taxCategory || null,
            customTaxRatePercent: receiptFiniteYen(src.customTaxRatePercent),
            toppings: normalizeReceiptToppings(extractItemToppings(src), qty > 0 ? qty : 1)
        };
    }

    /**
     * 数量と税込小計だけ足す。単価・税抜単価・トッピング単価は書き換えない。
     * 合計が安全整数に収まらないときは false（行を分けたままにする）。
     */
    function absorbReceiptLine(dest, src) {
        var addQty = receiptIntegerYen(src && src.quantity);
        var addTotal = receiptIntegerYen(src && src.lineTotal);
        if (addQty == null || addTotal == null) {
            return false;
        }
        var nextQty = dest.quantity + addQty;
        var nextTotal = dest.lineTotal + addTotal;
        if (!Number.isSafeInteger(nextQty) || !Number.isSafeInteger(nextTotal)) {
            return false;
        }
        if (!toppingScaleFits(dest.toppings, nextQty)) {
            return false;
        }
        dest.quantity = nextQty;
        dest.lineTotal = nextTotal;
        scaleReceiptToppings(dest.toppings, nextQty);
        return true;
    }

    /**
     * 同じ商品でトッピング構成も同じ明細を xN の1行にまとめる。
     * まとめるのは、名前・取消・税込単価・税区分・税抜単価・トッピングが一致し、
     * 税込小計が単価×数量と一致する行だけ。それ以外は金額と消費税を動かさないよう分けたまま。
     * クーポンと負の金額はまとめない。入力配列とその中身は変更しない。
     * 同じ入力に何度かけても結果は変わらない。
     * @param {Array<object>} lines
     * @returns {Array<object>}
     */
    function groupIdenticalReceiptLines(lines) {
        var list = Array.isArray(lines) ? lines : [];
        var out = [];
        var indexByKey = Object.create(null);
        for (var i = 0; i < list.length; i += 1) {
            var line = list[i];
            if (!line) {
                continue;
            }
            var key = receiptLineMergeKey(line);
            var existing = key != null ? indexByKey[key] : null;
            if (existing == null) {
                if (key != null) {
                    indexByKey[key] = out.length;
                }
                out.push(cloneReceiptLine(line));
                continue;
            }
            if (!absorbReceiptLine(out[existing], line)) {
                out.push(cloneReceiptLine(line));
            }
        }
        return out;
    }

    /**
     * セッション詳細（orderHistory）→ 公式レシート lines。
     * 同一商品・同一トッピングは数量をまとめる。
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
        return groupIdenticalReceiptLines(out);
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
        lines = groupIdenticalReceiptLines(lines);
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
        var price = Math.round(Number(inclusive) || 0);
        if (!(price > 0)) {
            return 0;
        }
        var percent = Math.floor(receiptEffectiveRate(taxCategory, sessionType, customTaxRatePercent) * 100);
        if (percent <= 0) {
            return price;
        }
        return price - Math.floor(price * percent / (100 + percent));
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
     * ロゴなしのときは本文 1 塊だけ。テスト印刷もロゴ設定があれば同じロゴを付ける。
     * @returns {Promise<{ parts: Uint8Array[], totalBytes: number, hasBanner: boolean }>}
     */
    async function buildOfficialReceiptParts(payload) {
        var p = payload || {};
        var shop = p.shop || {};
        var session = p.session || {};
        var payment = p.payment || {};
        var lines = groupIdenticalReceiptLines(Array.isArray(p.lines) ? p.lines : []);
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
            var price = isCouponReceiptLine(null, item)
                ? formatCouponYen(item)
                : (item.lineTotal != null
                    ? formatYen(item.lineTotal)
                    : (item.unitPrice != null ? formatYen(item.unitPrice) : ''));
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

    var FORMAL_PROVISO_DEFAULT = 'お食事代として';
    var FORMAL_BLANK_ADDRESSEE = '＿＿＿＿＿＿＿＿＿＿';
    var FORMAL_STAMP_YEN = 50000;

    function formalReceiptText(value) {
        if (typeof P.sanitizeReceiptText === 'function') {
            return P.sanitizeReceiptText(value);
        }
        return String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
    }

    function clipFormalText(value, max) {
        var text = formalReceiptText(value);
        var limit = max | 0;
        if (limit > 0 && text.length > limit) {
            return text.slice(0, limit);
        }
        return text;
    }

    function formatFormalDate(value) {
        var d = value instanceof Date ? value : new Date(value || Date.now());
        if (Number.isNaN(d.getTime())) {
            d = new Date();
        }
        return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    }

    function formalAddresseeLine(addressee) {
        var name = clipFormalText(addressee, 40);
        if (!name) {
            return FORMAL_BLANK_ADDRESSEE + ' 様';
        }
        return name + ' 様';
    }

    function formalProvisoText(proviso) {
        return clipFormalText(proviso, 30) || FORMAL_PROVISO_DEFAULT;
    }

    /**
     * 宛名つき領収書。明細レシートとは別紙。
     * addressee が空でも手書き欄（下線＋様）で出す。
     * @returns {Promise<{ parts: Uint8Array[], totalBytes: number, hasBanner: boolean }>}
     */
    async function buildFormalReceiptParts(payload) {
        var p = payload || {};
        var shop = p.shop || {};
        var session = p.session || {};
        var payment = p.payment || {};
        if (!supportsCanvasImagePrint()) {
            throw new Error('レシート印字には Canvas が必要です');
        }

        var bodyAcc = [cmdInit()];
        function pushBody(chunk) {
            if (!chunk || !chunk.length) {
                return;
            }
            bodyAcc.push(chunk);
        }

        var total = session.totalAmount != null ? session.totalAmount : p.totalAmount;
        var when = formatFormalDate(session.checkedOutAt || session.endTime || p.printedAt);
        var method = String(payment.paymentMethod || payment.method || 'CASH').toUpperCase();
        var phone = shop.phone || shop.phoneNumber || '';

        pushBody(imageLine('領 収 書', Object.assign({ align: 'center' }, RECEIPT_TYPE.title)));
        pushBody(imageLine(when, Object.assign({ align: 'right' }, RECEIPT_TYPE.meta)));
        pushBody(cmdFeed(1));
        pushBody(imageLine(formalAddresseeLine(p.addressee), Object.assign({ align: 'center' }, RECEIPT_TYPE.body)));
        pushBody(imageSeparator());
        pushBody(imageAmountLine('金額', formatYen(total) + '-', RECEIPT_TYPE.total));
        pushBody(imageLine('但 ' + formalProvisoText(p.proviso), RECEIPT_TYPE.body));
        pushBody(imageLine('上記正に領収いたしました', Object.assign({ align: 'center' }, RECEIPT_TYPE.body)));
        pushBody(cmdFeed(1));
        if (method === 'CARD') {
            pushBody(imageLine('カード払い（印紙不要）', Object.assign({ align: 'center' }, RECEIPT_TYPE.small)));
        } else if (Number(total) >= FORMAL_STAMP_YEN) {
            pushBody(imageLine('収入印紙', Object.assign({ align: 'center' }, RECEIPT_TYPE.body)));
            pushBody(imageLine('現金5万円以上は印紙を貼ってください', Object.assign({ align: 'center' }, RECEIPT_TYPE.small)));
        }

        pushBody(cmdFeed(1));
        if (shop.name) {
            pushBody(imageLine(String(shop.name), Object.assign({ align: 'center' }, RECEIPT_TYPE.shop)));
        }
        if (shop.address) {
            pushBody(imageLine(String(shop.address), Object.assign({ align: 'center' }, RECEIPT_TYPE.contact)));
        }
        if (phone) {
            pushBody(imageLine('TEL ' + String(phone), Object.assign({ align: 'center' }, RECEIPT_TYPE.contact)));
        }
        if (session.archiveId || session.sessionId || p.archiveId) {
            pushBody(imageLine(
                'No. ' + String(session.archiveId || p.archiveId || session.sessionId),
                RECEIPT_TYPE.small
            ));
        }
        pushBody(cmdFeed(3));
        pushBody(cmdCut());

        var parts = [];
        if (bodyAcc.length) {
            parts.push(concatBytes(bodyAcc));
        }
        var totalBytes = 0;
        for (var pi = 0; pi < parts.length; pi += 1) {
            totalBytes += parts[pi].length;
        }
        return { parts: parts, totalBytes: totalBytes, hasBanner: false };
    }

    async function buildFormalReceiptBytes(payload) {
        var built = await buildFormalReceiptParts(payload);
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

    function ticketText(value) {
        if (typeof P.sanitizeReceiptText === 'function') {
            return P.sanitizeReceiptText(value);
        }
        return String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
    }

    function ticketClock(value) {
        if (!value) {
            return '';
        }
        var d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) {
            return ticketText(value);
        }
        var hh = d.getHours();
        var mm = d.getMinutes();
        return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
    }

    function ticketQty(item) {
        if (!item) {
            return 0;
        }
        if (item.remainingQuantity != null && item.remainingQuantity !== '') {
            var remaining = Number(item.remainingQuantity);
            if (Number.isFinite(remaining)) {
                return remaining > 0 ? remaining : 0;
            }
        }
        var qty = Number(item.quantity || 0);
        var cancelled = Number(item.cancelledQuantity || 0);
        var left = qty - (Number.isFinite(cancelled) ? cancelled : 0);
        return left > 0 ? left : 0;
    }

    /**
     * 厨房向けの短い注文票。金額・ロゴ・税は載せない。1 注文 1 枚。
     * @param {object} order PendingOrderResponse 相当
     * @returns {{ parts: Uint8Array[], totalBytes: number, hasBanner: boolean }}
     */
    function buildOrderTicketParts(order) {
        if (!supportsCanvasImagePrint()) {
            throw new Error('注文票の印字には Canvas が必要です');
        }
        var src = order || {};
        var table = src.tableNumber != null && src.tableNumber !== '' ? String(src.tableNumber) : '-';
        var chunks = [cmdInit()];
        chunks.push(imageLine('注文票', Object.assign({ align: 'center' }, RECEIPT_TYPE.title)));
        chunks.push(imageLine('テーブル ' + ticketText(table), {
            align: 'center',
            fontSize: 40,
            height: 72
        }));
        var when = ticketClock(src.orderTime);
        if (when) {
            chunks.push(imageLine(when, Object.assign({ align: 'center' }, RECEIPT_TYPE.meta)));
        }
        chunks.push(imageSeparator());
        var items = Array.isArray(src.items) ? src.items : [];
        var printed = 0;
        var i;
        for (i = 0; i < items.length; i += 1) {
            var item = items[i];
            var qty = ticketQty(item);
            if (!qty) {
                continue;
            }
            var name = ticketText(item && (item.menuName || item.name)) || '不明';
            chunks.push(imageLine('x' + qty + '  ' + name, RECEIPT_TYPE.item));
            var toppings = item && Array.isArray(item.toppings) ? item.toppings : [];
            var t;
            for (t = 0; t < toppings.length; t += 1) {
                var toppingName = ticketText(toppings[t] && (toppings[t].name || toppings[t].menuName)) || 'トッピング';
                chunks.push(imageLine('　・' + toppingName, RECEIPT_TYPE.topping));
            }
            printed += 1;
        }
        if (!printed) {
            chunks.push(imageLine('（明細なし）', RECEIPT_TYPE.body));
        }
        chunks.push(cmdFeed(3));
        chunks.push(cmdCut());
        var bytes = concatBytes(chunks);
        return { parts: [bytes], totalBytes: bytes.length, hasBanner: false };
    }

    P.PREVIEW_SAMPLE = PREVIEW_SAMPLE;
    P.shopFieldsFromShop = shopFieldsFromShop;
    P.groupIdenticalReceiptLines = groupIdenticalReceiptLines;
    P.computeReceiptTaxBreakdown = computeReceiptTaxBreakdown;
    P.flattenSessionReceiptLines = flattenSessionReceiptLines;
    P.buildPreviewSampleReceiptPayload = buildPreviewSampleReceiptPayload;
    P.buildCheckoutReceiptPayload = buildCheckoutReceiptPayload;
    P.buildOfficialReceiptParts = buildOfficialReceiptParts;
    P.buildOfficialReceiptBytes = buildOfficialReceiptBytes;
    P.buildFormalReceiptParts = buildFormalReceiptParts;
    P.buildFormalReceiptBytes = buildFormalReceiptBytes;
    P.buildPrinterLoadTestParts = buildPrinterLoadTestParts;
    P.buildOrderTicketParts = buildOrderTicketParts;
})(typeof window !== 'undefined' ? window : globalThis);
