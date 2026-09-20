/**
 * 来客メニューのタイムセール表示・仮想カテゴリ（端末ローカルのみ）。
 *
 * 依存: consumption-tax.js
 * グローバル: MasterOrderGuestMenuPricing
 */
(function (global) {
    'use strict';

    var GUEST_TIME_SALE_CATEGORY = 'タイムセール';
    var DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

    function taxApi() {
        return global.MasterOrderConsumptionTax;
    }

    function deriveTaxInclusiveFromBase(basePrice, taxCategory, sessionType, customTaxRatePercent) {
        var tax = taxApi();
        if (tax && typeof tax.deriveTaxInclusiveFromBase === 'function') {
            return tax.deriveTaxInclusiveFromBase(basePrice, taxCategory, sessionType, customTaxRatePercent);
        }
        return Number(basePrice) || 0;
    }

    function publishedTaxInclusive(menu) {
        if (!menu || typeof menu !== 'object') {
            return 0;
        }
        var display = menu.pricing && menu.pricing.display;
        if (display && display.effectivePrice != null && Number(display.effectivePrice) > 0) {
            return Number(display.effectivePrice);
        }
        if (menu.price != null && Number(menu.price) > 0) {
            return Number(menu.price);
        }
        if (menu.catalogPrice != null && Number(menu.catalogPrice) > 0) {
            return Number(menu.catalogPrice);
        }
        return 0;
    }

    function resolveTaxInclusiveCatalogPrice(menu) {
        if (!menu || typeof menu !== 'object') {
            return 0;
        }
        var published = publishedTaxInclusive(menu);
        if (published > 0) {
            return published;
        }
        if (menu.basePrice != null && Number(menu.basePrice) > 0) {
            return deriveTaxInclusiveFromBase(
                Number(menu.basePrice),
                menu.taxCategory,
                'DINE_IN',
                menu.customTaxRatePercent
            );
        }
        return 0;
    }

    function parseHm(value) {
        if (!value || typeof value !== 'string') {
            return null;
        }
        var trimmed = value.trim();
        if (trimmed === '24:00') {
            return 24 * 60;
        }
        var parts = trimmed.split(':');
        if (parts.length < 2) {
            return null;
        }
        var h = Number.parseInt(parts[0], 10);
        var m = Number.parseInt(parts[1], 10);
        if (!Number.isFinite(h) || !Number.isFinite(m)) {
            return null;
        }
        return h * 60 + m;
    }

    function isWithinWindow(start, end, nowMinutes) {
        var s = parseHm(start);
        var e = parseHm(end);
        if (s == null || e == null) {
            return false;
        }
        if (s <= e) {
            return nowMinutes >= s && nowMinutes < e;
        }
        return nowMinutes >= s || nowMinutes < e;
    }

    function zonedParts(orderedAtIso, timeZone) {
        var d = new Date(orderedAtIso);
        var fmt = new Intl.DateTimeFormat('en-CA', {
            timeZone: timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            weekday: 'short'
        });
        var parts = fmt.formatToParts(d);
        var bag = {};
        parts.forEach(function (p) {
            if (p.type !== 'literal') {
                bag[p.type] = p.value;
            }
        });
        var weekday = String(bag.weekday || 'Sun').toUpperCase().slice(0, 3);
        var dayOfWeek = weekday === 'THU' ? 'THU' : weekday;
        var mapped = DAY_NAMES.find(function (name) {
            return dayOfWeek.startsWith(name.slice(0, 2));
        }) || dayOfWeek;
        return {
            localDate: String(bag.year) + '-' + String(bag.month) + '-' + String(bag.day),
            dayOfWeek: mapped,
            dayOfMonth: Number.parseInt(bag.day || '1', 10),
            minutes: Number.parseInt(bag.hour || '0', 10) * 60 + Number.parseInt(bag.minute || '0', 10)
        };
    }

    function promotionMatches(rule, ctx) {
        if (!rule || !rule.window || !isWithinWindow(rule.window.start, rule.window.end, ctx.minutes)) {
            return false;
        }
        var routine = String(rule.routine || '').toUpperCase();
        switch (routine) {
            case 'ONCE':
                return rule.once && rule.once.date === ctx.localDate;
            case 'DAILY':
                return true;
            case 'WEEKLY': {
                var days = rule.weekly && Array.isArray(rule.weekly.daysOfWeek) ? rule.weekly.daysOfWeek : [];
                return days.some(function (d) {
                    return String(d || '').toUpperCase() === ctx.dayOfWeek;
                });
            }
            case 'MONTHLY': {
                var dom = rule.monthly && Array.isArray(rule.monthly.daysOfMonth) ? rule.monthly.daysOfMonth : [];
                return dom.some(function (day) {
                    return Number(day) === ctx.dayOfMonth;
                });
            }
            default:
                return false;
        }
    }

    function addDaysToLocalDate(localDate, days) {
        var parts = String(localDate || '').split('-');
        if (parts.length < 3) {
            return localDate;
        }
        var dt = new Date(Date.UTC(
            Number.parseInt(parts[0], 10),
            Number.parseInt(parts[1], 10) - 1,
            Number.parseInt(parts[2], 10) + Number(days || 0)
        ));
        return dt.toISOString().slice(0, 10);
    }

    function zonedLocalDateTimeToUtcMs(localDate, hm, timeZone) {
        if (!localDate || !hm) {
            return null;
        }
        var targetMins = parseHm(hm);
        if (targetMins == null) {
            return null;
        }
        var guess = Date.parse(localDate + 'T12:00:00.000Z');
        if (!Number.isFinite(guess)) {
            return null;
        }
        for (var i = 0; i < 72; i++) {
            var ctx = zonedParts(new Date(guess).toISOString(), timeZone);
            if (ctx.localDate === localDate && ctx.minutes === targetMins) {
                return guess;
            }
            var dayDiff = localDate > ctx.localDate ? 1 : (localDate < ctx.localDate ? -1 : 0);
            var minDiff = targetMins - ctx.minutes + dayDiff * 1440;
            guess += minDiff * 60 * 1000;
        }
        return null;
    }

    function createGuestMenuPricingRefreshScheduler(options) {
        options = options || {};
        var refreshOnVisibilityOnly = options.refreshOnVisibilityOnly === true;
        var getRefreshIntervalSec = typeof options.getRefreshIntervalSec === 'function'
            ? options.getRefreshIntervalSec
            : function () { return 60; };
        var shouldRefresh = typeof options.shouldRefresh === 'function'
            ? options.shouldRefresh
            : function () { return true; };
        var onPricingChange = typeof options.onPricingChange === 'function'
            ? options.onPricingChange
            : function () {};
        var timerId = null;
        var running = false;

        function clearTimer() {
            if (timerId != null) {
                clearTimeout(timerId);
                timerId = null;
            }
        }

        function scheduleNext() {
            clearTimer();
            if (!running || refreshOnVisibilityOnly || !shouldRefresh()) {
                return;
            }
            var sec = Number(getRefreshIntervalSec()) || 60;
            var delayMs = Math.max(15000, Math.min(sec * 1000, 5 * 60 * 1000));
            timerId = setTimeout(function () {
                onPricingChange(null, { reason: 'network-refresh' });
                scheduleNext();
            }, delayMs);
        }

        function onVisibility() {
            if (!running || typeof document === 'undefined' || document.visibilityState !== 'visible') {
                return;
            }
            if (!shouldRefresh()) {
                return;
            }
            onPricingChange(null, { reason: 'visibility' });
            scheduleNext();
        }

        return {
            start: function () {
                running = true;
                if (!refreshOnVisibilityOnly) {
                    scheduleNext();
                }
                if (typeof document !== 'undefined') {
                    document.addEventListener('visibilitychange', onVisibility);
                }
            },
            stop: function () {
                running = false;
                clearTimer();
                if (typeof document !== 'undefined') {
                    document.removeEventListener('visibilitychange', onVisibility);
                }
            },
            notifyMenusUpdated: function () {
                if (running) {
                    scheduleNext();
                }
            },
            tick: function () {
                if (shouldRefresh()) {
                    onPricingChange(null, { reason: 'manual' });
                }
                if (running) {
                    scheduleNext();
                }
            }
        };
    }

    function resolveEffectiveUnitBase(rule, orderedAtIso, timeZone, options) {
        options = options || {};
        var listUnitBase = Number(rule.unitBase) || 0;
        var unit = listUnitBase;
        var scheduleEnabled = options.scheduleEnabled !== false;
        var promotionsEnabled = options.promotionsEnabled !== false;

        if (
            scheduleEnabled
            && rule.schedulePrice != null
            && Number(rule.schedulePrice) > 0
            && isWithinWindow(rule.scheduleStart, rule.scheduleEnd, zonedParts(orderedAtIso, timeZone).minutes)
        ) {
            unit = Number(rule.schedulePrice);
        }

        var effectiveUnitBase = unit;
        var saleLabel = null;
        if (promotionsEnabled && Array.isArray(rule.promotions) && rule.promotions.length) {
            var ctx = zonedParts(orderedAtIso, timeZone);
            rule.promotions.forEach(function (promo) {
                if (!promotionMatches(promo, ctx)) {
                    return;
                }
                var candidateUnit;
                if (typeof promo.saleBasePrice === 'number' && promo.saleBasePrice >= 1) {
                    candidateUnit = promo.saleBasePrice;
                } else {
                    var yen = typeof promo.discountYen === 'number' ? promo.discountYen : 0;
                    candidateUnit = Math.max(1, unit - yen);
                }
                if (candidateUnit < effectiveUnitBase) {
                    effectiveUnitBase = candidateUnit;
                    saleLabel = typeof promo.name === 'string' ? promo.name : null;
                }
            });
        }

        var discountUnitBase = Math.max(0, listUnitBase - effectiveUnitBase);
        return {
            listUnitBase: listUnitBase,
            effectiveUnitBase: effectiveUnitBase,
            discountUnitBase: discountUnitBase,
            onSale: discountUnitBase > 0,
            saleLabel: saleLabel
        };
    }

    function resolveMenuPricingEval(menu, atIso) {
        if (!menu || typeof menu !== 'object') {
            return null;
        }
        var pricing = menu.pricing || {};
        var evalCtx = pricing.eval || pricing.rules || null;
        if (!evalCtx || evalCtx.unitBase == null) {
            return null;
        }
        var timeZone = evalCtx.timezone || evalCtx.timeZone || 'Asia/Tokyo';
        return resolveEffectiveUnitBase(evalCtx, atIso || new Date().toISOString(), timeZone, {
            scheduleEnabled: evalCtx.scheduleMenuEnabled !== false,
            promotionsEnabled: evalCtx.promotionsEnabled !== false
        });
    }

    function catalogListTaxInclusive(menu) {
        if (!menu || typeof menu !== 'object') {
            return 0;
        }
        var pricing = menu.pricing || {};
        // 公開済み税込を catalogPrice より優先（base が catalogPrice に残ると税抜きでカート同期される）
        var published = publishedTaxInclusive(menu);
        var onSale = !!(pricing.onSale || (pricing.display && pricing.display.onSale));
        if (!onSale && published > 0) {
            return published;
        }
        if (menu.catalogPrice != null && Number(menu.catalogPrice) > 0) {
            return Number(menu.catalogPrice);
        }
        if (pricing.listUnitBase != null && Number(pricing.listUnitBase) > 0) {
            return deriveTaxInclusiveFromBase(
                Number(pricing.listUnitBase),
                menu.taxCategory,
                'DINE_IN',
                menu.customTaxRatePercent
            );
        }
        if (pricing.eval && pricing.eval.unitBase != null && Number(pricing.eval.unitBase) > 0) {
            return deriveTaxInclusiveFromBase(
                Number(pricing.eval.unitBase),
                menu.taxCategory,
                'DINE_IN',
                menu.customTaxRatePercent
            );
        }
        return resolveTaxInclusiveCatalogPrice(menu);
    }

    function resolveEffectiveTaxInclusive(menu, pricing) {
        var published = publishedTaxInclusive(menu);
        if (published > 0) {
            return published;
        }
        var onSale = !!(pricing && pricing.onSale);
        var listUnitBase = pricing && pricing.listUnitBase != null ? Number(pricing.listUnitBase) : 0;
        var effectiveUnitBase = pricing && pricing.effectiveUnitBase != null ? Number(pricing.effectiveUnitBase) : 0;
        var atList = !onSale && effectiveUnitBase === listUnitBase;
        if (atList) {
            var catalogPrice = catalogListTaxInclusive(menu);
            if (catalogPrice > 0) {
                return catalogPrice;
            }
        }
        return deriveTaxInclusiveFromBase(
            effectiveUnitBase,
            menu && menu.taxCategory,
            'DINE_IN',
            menu && menu.customTaxRatePercent
        );
    }

    function buildGuestMenuSaleDisplay(listPrice, effectivePrice, promoHeadline, bannerImageUrl) {
        var list = Math.max(0, Number(listPrice) || 0);
        var effective = Math.max(0, Number(effectivePrice) || 0);
        var discountYen = Math.max(0, list - effective);
        if (discountYen <= 0 || list <= effective) {
            return {
                listPrice: null,
                effectivePrice: effective,
                discountYen: 0,
                onSale: false,
                promoHeadline: null,
                bannerImageUrl: null
            };
        }
        return {
            listPrice: list,
            effectivePrice: effective,
            discountYen: discountYen,
            onSale: true,
            promoHeadline: promoHeadline || null,
            bannerImageUrl: bannerImageUrl || null
        };
    }

    function buildGuestMenuRegularDisplay(effectivePrice) {
        return {
            listPrice: null,
            effectivePrice: Math.max(0, Number(effectivePrice) || 0),
            discountYen: 0,
            onSale: false,
            promoHeadline: null,
            bannerImageUrl: null
        };
    }

    function resolveGuestMenuOrderFloorPrice(menu) {
        if (!menu || typeof menu !== 'object') {
            return 0;
        }
        // 注文検証フロアも来客表示と同じ税込単価を正本にする（税抜 base の直参照を避ける）
        return buildGuestMenuPriceDisplay(menu).effectivePrice;
    }

    function buildGuestMenuPriceDisplay(menu) {
        if (!menu || typeof menu !== 'object') {
            return buildGuestMenuRegularDisplay(0);
        }

        var serverDisplay = menu.pricing && menu.pricing.display;
        if (serverDisplay && serverDisplay.effectivePrice != null) {
            var effFromServer = Number(serverDisplay.effectivePrice);
            var listFromServer = serverDisplay.listPrice != null ? Number(serverDisplay.listPrice) : null;
            if (Number.isFinite(effFromServer) && effFromServer > 0) {
                if (serverDisplay.onSale && listFromServer != null
                    && Number.isFinite(listFromServer) && listFromServer > effFromServer) {
                    return buildGuestMenuSaleDisplay(
                        listFromServer,
                        effFromServer,
                        null,
                        null
                    );
                }
                return buildGuestMenuRegularDisplay(effFromServer);
            }
        }

        var pricing = menu.pricing || {};
        var effectivePrice = resolveEffectiveTaxInclusive(menu, pricing);
        if (!pricing.onSale || Number(pricing.discountUnitBase) <= 0) {
            return buildGuestMenuRegularDisplay(effectivePrice);
        }
        var listPrice = catalogListTaxInclusive(menu);
        if (listPrice <= 0) {
            listPrice = deriveTaxInclusiveFromBase(
                Number(pricing.listUnitBase) || 0,
                menu.taxCategory,
                'DINE_IN',
                menu.customTaxRatePercent
            );
        }
        return buildGuestMenuSaleDisplay(listPrice, effectivePrice, null, null);
    }

    function isGuestMenuTimeSaleActive(menu) {
        var display = buildGuestMenuPriceDisplay(menu);
        return display.onSale === true && display.discountYen > 0;
    }

    function enrichGuestMenuForDisplay(menu) {
        if (!menu || typeof menu !== 'object') {
            return menu;
        }
        var enriched = Object.assign({}, menu);
        var pricingSource = enriched.pricing || {};
        var serverDisplay = pricingSource.display;
        // Gate order-bundle はリクエスト時に pricing.display を評価済み。再換算するとセールが消えることがある。
        if (serverDisplay
            && serverDisplay.effectivePrice != null
            && Number(serverDisplay.effectivePrice) > 0
            && typeof serverDisplay.onSale === 'boolean') {
            var effectivePrice = Number(serverDisplay.effectivePrice);
            var listPrice = serverDisplay.listPrice != null ? Number(serverDisplay.listPrice) : null;
            var onSale = serverDisplay.onSale === true
                && listPrice != null
                && Number.isFinite(listPrice)
                && listPrice > effectivePrice;
            enriched.price = effectivePrice;
            if (onSale) {
                enriched.catalogPrice = listPrice;
            } else if (enriched.catalogPrice == null && pricingSource.listUnitBase != null) {
                enriched.catalogPrice = deriveTaxInclusiveFromBase(
                    Number(pricingSource.listUnitBase),
                    enriched.taxCategory,
                    'DINE_IN',
                    enriched.customTaxRatePercent
                );
            }
            enriched.pricing = Object.assign({}, pricingSource, {
                onSale: onSale,
                display: {
                    listPrice: onSale ? listPrice : null,
                    effectivePrice: effectivePrice,
                    discountYen: onSale ? Math.max(0, listPrice - effectivePrice) : 0,
                    onSale: onSale,
                    promoHeadline: null,
                    bannerImageUrl: null
                }
            });
            enriched.timeSaleActive = onSale;
            return enriched;
        }
        if (enriched.catalogPrice == null) {
            // 通常価格の税込は「公開済み price」か base 換算。listUnitBase 再換算で上書きしない。
            if (enriched.price != null && Number(enriched.price) > 0
                && !(pricingSource.onSale || (pricingSource.display && pricingSource.display.discountYen > 0))) {
                enriched.catalogPrice = Number(enriched.price);
            } else if (enriched.basePrice != null && Number(enriched.basePrice) > 0) {
                enriched.catalogPrice = deriveTaxInclusiveFromBase(
                    Number(enriched.basePrice),
                    enriched.taxCategory,
                    'DINE_IN',
                    enriched.customTaxRatePercent
                );
            } else {
                enriched.catalogPrice = catalogListTaxInclusive(enriched);
            }
        }
        var display = buildGuestMenuPriceDisplay(enriched);
        if (display.onSale && display.listPrice != null) {
            enriched.catalogPrice = display.listPrice;
        }
        var pricing = Object.assign({}, enriched.pricing || {});
        pricing.onSale = display.onSale;
        pricing.display = {
            listPrice: display.listPrice,
            effectivePrice: display.effectivePrice,
            discountYen: display.discountYen,
            promoHeadline: null,
            bannerImageUrl: null
        };
        enriched.pricing = pricing;
        enriched.price = display.effectivePrice;
        enriched.timeSaleActive = display.onSale;
        return enriched;
    }

    function enrichGuestMenusForDisplay(menus) {
        return (Array.isArray(menus) ? menus : [])
            .map(enrichGuestMenuForDisplay)
            .filter(Boolean);
    }

    function appendGuestMenuPriceElements(container, menu) {
        if (!container) {
            return;
        }
        var display = buildGuestMenuPriceDisplay(menu);
        container.replaceChildren();
        if (display.onSale && display.listPrice != null) {
            var row = global.document.createElement('div');
            row.className = 'menu-price-row menu-price-row--sale';
            row.setAttribute(
                'aria-label',
                '通常価格' + display.listPrice.toLocaleString() + '円、セール価格' + display.effectivePrice.toLocaleString() + '円'
            );

            var list = global.document.createElement('span');
            list.className = 'menu-price-list';
            list.textContent = display.listPrice.toLocaleString() + '円';
            list.setAttribute('aria-hidden', 'true');

            var sale = global.document.createElement('span');
            sale.className = 'menu-price-sale';
            sale.textContent = display.effectivePrice.toLocaleString() + '円';

            row.appendChild(list);
            row.appendChild(sale);
            container.appendChild(row);
            return;
        }
        var current = global.document.createElement('p');
        current.className = 'menu-price';
        current.textContent = '¥' + display.effectivePrice.toLocaleString();
        container.appendChild(current);
    }

    global.MasterOrderGuestMenuPricing = {
        GUEST_TIME_SALE_CATEGORY: GUEST_TIME_SALE_CATEGORY,
        buildGuestMenuPriceDisplay: buildGuestMenuPriceDisplay,
        resolveGuestMenuOrderFloorPrice: resolveGuestMenuOrderFloorPrice,
        isGuestMenuTimeSaleActive: isGuestMenuTimeSaleActive,
        enrichGuestMenuForDisplay: enrichGuestMenuForDisplay,
        appendGuestMenuPriceElements: appendGuestMenuPriceElements,
        createGuestMenuPricingRefreshScheduler: createGuestMenuPricingRefreshScheduler
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
