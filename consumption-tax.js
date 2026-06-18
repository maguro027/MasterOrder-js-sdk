/**
 * インボイス制度対応の消費税計算（ブラウザ SDK）。
 */
(function (global) {
    'use strict';

    var RATE_8 = 0.08;
    var RATE_10 = 0.10;

    var TaxCategory = {
        STANDARD: 'STANDARD',
        REDUCED: 'REDUCED'
    };

    var ServiceSessionType = {
        DINE_IN: 'DINE_IN',
        TAKEOUT: 'TAKEOUT'
    };

    function normalizeTaxCategory(value) {
        var raw = String(value || TaxCategory.STANDARD).trim().toUpperCase();
        return raw === TaxCategory.REDUCED ? TaxCategory.REDUCED : TaxCategory.STANDARD;
    }

    function normalizeSessionType(value) {
        var raw = String(value || ServiceSessionType.DINE_IN).trim().toUpperCase();
        return raw === ServiceSessionType.TAKEOUT ? ServiceSessionType.TAKEOUT : ServiceSessionType.DINE_IN;
    }

    function resolveEffectiveRate(taxCategory, sessionType) {
        var category = normalizeTaxCategory(taxCategory);
        var session = normalizeSessionType(sessionType);
        if (category === TaxCategory.REDUCED && session === ServiceSessionType.TAKEOUT) {
            return RATE_8;
        }
        return RATE_10;
    }

    function deriveBaseFromTaxInclusive(taxInclusivePrice, taxCategory, referenceSessionType) {
        var price = Number(taxInclusivePrice) || 0;
        if (price <= 0) {
            return 0;
        }
        var rate = resolveEffectiveRate(taxCategory, referenceSessionType);
        return Math.round(price / (1 + rate));
    }

    function deriveTaxInclusiveFromBase(basePrice, taxCategory, sessionType) {
        var base = Number(basePrice) || 0;
        if (base <= 0) {
            return 0;
        }
        var rate = resolveEffectiveRate(taxCategory, sessionType);
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
            var rate = resolveEffectiveRate(line.taxCategory, session);
            baseByRate[rate] = (baseByRate[rate] || 0) + lineBase;
        });

        var tax8 = floorTax(baseByRate[RATE_8], RATE_8);
        var tax10 = floorTax(baseByRate[RATE_10], RATE_10);
        return {
            baseTotal: baseTotal,
            tax8: tax8,
            tax10: tax10,
            grandTotal: baseTotal + tax8 + tax10
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
                    ServiceSessionType.DINE_IN
                );
            } else {
                base += Number(item.toppingBasePrice || item.toppingPrice || 0);
            }
            return {
                basePrice: base,
                taxCategory: item.taxCategory || TaxCategory.STANDARD,
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
        migrateLegacyTaxInclusivePrice: migrateLegacyTaxInclusivePrice,
        calculateOrderTotals: calculateOrderTotals,
        calculateCartGrandTotal: calculateCartGrandTotal
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    global.MasterOrderConsumptionTax = api;
}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this));
