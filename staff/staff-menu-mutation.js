/**
 * メニュー更新 PUT のペイロード正規化・差分判定（不要な保存 API を抑止）。
 */
(function (global) {
    'use strict';

    var LANGS = ['ja', 'en', 'zh', 'ko'];

    function trimOrNull(value) {
        if (value == null) {
            return null;
        }
        var s = String(value).trim();
        return s === '' ? null : s;
    }

    function normalizeLocalizedEntry(entry) {
        if (!entry || typeof entry !== 'object') {
            return null;
        }
        var name = trimOrNull(entry.name);
        var description = trimOrNull(entry.description);
        var staffMemo = trimOrNull(entry.staffMemo);
        if (!name && !description && !staffMemo) {
            return null;
        }
        return { name: name, description: description, staffMemo: staffMemo };
    }

    function normalizeLocalized(localized) {
        var normalized = {};
        var map = localized && typeof localized === 'object' ? localized : {};
        for (var i = 0; i < LANGS.length; i++) {
            var lang = LANGS[i];
            var entry = normalizeLocalizedEntry(map[lang]);
            if (entry) {
                normalized[lang] = entry;
            }
        }
        return normalized;
    }

    function normalizeTaxCategory(value) {
        if (value == null || String(value).trim() === '') {
            return 'CUSTOM';
        }
        return String(value).trim().toUpperCase();
    }

    function normalizePercent(value, fallback) {
        var n = Number(value);
        if (!Number.isFinite(n)) {
            return fallback == null ? null : fallback;
        }
        return Math.min(100, Math.max(1, Math.round(n)));
    }

    function normalizePrice(value) {
        var n = Number(value);
        if (!Number.isFinite(n) || n <= 0) {
            return null;
        }
        return Math.round(n);
    }

    function normalizeCategoryIds(value) {
        if (!Array.isArray(value)) {
            if (value == null || value === '') {
                return [];
            }
            var single = Number(value);
            return Number.isFinite(single) ? [single] : [];
        }
        return value
            .map(function (id) { return Number(id); })
            .filter(function (id) { return Number.isFinite(id); })
            .sort(function (a, b) { return a - b; });
    }

    function normalizeCategoryId(value) {
        if (value == null || value === '') {
            return null;
        }
        var n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    function deriveSubCategoryIds(menu) {
        if (!menu) {
            return [];
        }
        if (Array.isArray(menu.subCategoryIds)) {
            return normalizeCategoryIds(menu.subCategoryIds);
        }
        var all = normalizeCategoryIds(menu.categoryIds);
        var main = normalizeCategoryId(menu.categoryId);
        if (main == null) {
            return all;
        }
        return all.filter(function (id) { return id !== main; });
    }

    function mergeCategoryFields(categoryId, subCategoryIds, categoryIds) {
        var main = normalizeCategoryId(categoryId);
        var subs = normalizeCategoryIds(subCategoryIds);
        var all = normalizeCategoryIds(categoryIds);
        if (!all.length && (main != null || subs.length)) {
            var seen = {};
            if (main != null) {
                seen[main] = true;
            }
            for (var i = 0; i < subs.length; i++) {
                seen[subs[i]] = true;
            }
            all = Object.keys(seen)
                .map(function (key) { return Number(key); })
                .sort(function (a, b) { return a - b; });
        }
        if (main != null) {
            subs = subs.filter(function (id) { return id !== main; });
        }
        return {
            categoryId: main,
            subCategoryIds: subs,
            categoryIds: all
        };
    }

    function normalizeMenuUpdatePayload(payload) {
        if (!payload || typeof payload !== 'object') {
            return {};
        }
        var takeoutAvailable = !!payload.takeoutAvailable;
        var mergedCategories = mergeCategoryFields(
            payload.categoryId,
            payload.subCategoryIds,
            payload.categoryIds
        );
        return {
            localized: normalizeLocalized(payload.localized),
            price: normalizePrice(payload.price),
            taxCategory: normalizeTaxCategory(payload.taxCategory),
            customTaxRatePercent: normalizePercent(payload.customTaxRatePercent, 10),
            takeoutAvailable: takeoutAvailable,
            takeoutPrice: takeoutAvailable ? normalizePrice(payload.takeoutPrice) : null,
            takeoutTaxRatePercent: takeoutAvailable
                ? normalizePercent(payload.takeoutTaxRatePercent, 8)
                : null,
            categoryId: mergedCategories.categoryId,
            subCategoryIds: mergedCategories.subCategoryIds,
            categoryIds: mergedCategories.categoryIds,
            staffMemo: trimOrNull(payload.staffMemo),
            promotions: Array.isArray(payload.promotions) ? payload.promotions : undefined,
            clearPromotions: payload.clearPromotions === true ? true : undefined
        };
    }

    function buildMenuUpdateBaseline(menu) {
        if (!menu) {
            return null;
        }
        var localized = normalizeLocalized(menu.localized);
        if (!localized.ja && (menu.name || menu.description || menu.staffMemo)) {
            var jaEntry = normalizeLocalizedEntry({
                name: menu.name,
                description: menu.description,
                staffMemo: menu.staffMemo
            });
            if (jaEntry) {
                localized.ja = jaEntry;
            }
        }
        return normalizeMenuUpdatePayload({
            localized: localized,
            price: menu.price,
            taxCategory: menu.taxCategory,
            customTaxRatePercent: menu.customTaxRatePercent,
            takeoutAvailable: menu.takeoutAvailable,
            takeoutPrice: menu.takeoutPrice,
            takeoutTaxRatePercent: menu.takeoutTaxRatePercent,
            categoryId: menu.categoryId,
            subCategoryIds: deriveSubCategoryIds(menu),
            categoryIds: menu.categoryIds,
            staffMemo: menu.staffMemo,
            promotions: Array.isArray(menu.promotions) ? menu.promotions : undefined
        });
    }

    function isMenuUpdatePayloadDirty(baseline, payload) {
        if (!baseline) {
            return true;
        }
        return JSON.stringify(normalizeMenuUpdatePayload(baseline))
            !== JSON.stringify(normalizeMenuUpdatePayload(payload));
    }

    var MENU_MUTATION_RATE_LIMIT_MESSAGE =
        '操作が早すぎます。しばらく待ってからもう一度お試しください。';

    function isRateLimited(err) {
        if (!err) {
            return false;
        }
        var core = global.MasterOrderCoreSdk;
        if (core && typeof core.isRateLimitFailure === 'function') {
            return core.isRateLimitFailure(err);
        }
        if (Number(err.status) === 429) {
            return true;
        }
        var parts = [err.message];
        var payload = err.payload;
        if (payload && typeof payload === 'object') {
            parts.push(payload.message, payload.error, payload.detail);
        }
        return /too many requests|429|操作が早すぎ|リクエスト数の上限|レート制限/i.test(parts.join(' '));
    }

    function formatError(err) {
        return isRateLimited(err) ? MENU_MUTATION_RATE_LIMIT_MESSAGE : null;
    }

    global.MasterOrderStaffMenuMutation = {
        normalizeMenuUpdatePayload: normalizeMenuUpdatePayload,
        mergeCategoryFields: mergeCategoryFields,
        buildMenuUpdateBaseline: buildMenuUpdateBaseline,
        isMenuUpdatePayloadDirty: isMenuUpdatePayloadDirty,
        MENU_MUTATION_RATE_LIMIT_MESSAGE: MENU_MUTATION_RATE_LIMIT_MESSAGE,
        isRateLimited: isRateLimited,
        formatError: formatError
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
