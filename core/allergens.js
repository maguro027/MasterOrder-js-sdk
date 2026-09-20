/**
 * アレルゲン定義（食品表示法 / JFS が参照する日本の表示基準）。
 * 義務8 → 推奨20。並びは消費者庁の特定原材料等の記載順に準拠。
 * Core レイヤ — Staff / Order の双方が参照する。
 */
(function (global) {
    'use strict';

    var HIDDEN_TTL_MS = 8 * 60 * 60 * 1000;

    /** @typedef {{ code: string, emoji: string, mandatory: boolean, labels: { ja: string, en: string, zh: string, ko: string } }} AllergyDef */

    /** @type {AllergyDef[]} */
    var ALLERGENS = [
        // 義務 8品目（えび・かに・くるみ・小麦・そば・卵・乳・落花生）
        { code: 'SHRIMP', emoji: '🦐', mandatory: true, labels: { ja: 'えび', en: 'Shrimp', zh: '虾', ko: '새우' } },
        { code: 'CRAB', emoji: '🦀', mandatory: true, labels: { ja: 'かに', en: 'Crab', zh: '蟹', ko: '게' } },
        { code: 'WALNUT', emoji: '🌰', mandatory: true, labels: { ja: 'くるみ', en: 'Walnut', zh: '核桃', ko: '호두' } },
        { code: 'WHEAT', emoji: '🌾', mandatory: true, labels: { ja: '小麦', en: 'Wheat', zh: '小麦', ko: '밀' } },
        { code: 'BUCKWHEAT', emoji: '🍜', mandatory: true, labels: { ja: 'そば', en: 'Buckwheat', zh: '荞麦', ko: '메밀' } },
        { code: 'EGG', emoji: '🥚', mandatory: true, labels: { ja: '卵', en: 'Egg', zh: '蛋', ko: '계란' } },
        { code: 'MILK', emoji: '🥛', mandatory: true, labels: { ja: '乳', en: 'Milk', zh: '乳', ko: '유제품' } },
        { code: 'PEANUTS', emoji: '🥜', mandatory: true, labels: { ja: '落花生', en: 'Peanuts', zh: '花生', ko: '땅콩' } },
        // 推奨 20品目
        { code: 'ALMOND', emoji: '🌰', mandatory: false, labels: { ja: 'アーモンド', en: 'Almond', zh: '杏仁', ko: '아몬드' } },
        { code: 'ABALONE', emoji: '🐚', mandatory: false, labels: { ja: 'あわび', en: 'Abalone', zh: '鲍鱼', ko: '전복' } },
        { code: 'SQUID', emoji: '🦑', mandatory: false, labels: { ja: 'いか', en: 'Squid', zh: '鱿鱼', ko: '오징어' } },
        { code: 'SALMON_ROE', emoji: '🟠', mandatory: false, labels: { ja: 'いくら', en: 'Salmon roe', zh: '鲑鱼籽', ko: '연어알' } },
        { code: 'ORANGE', emoji: '🍊', mandatory: false, labels: { ja: 'オレンジ', en: 'Orange', zh: '橙', ko: '오렌지' } },
        { code: 'CASHEW_NUT', emoji: '🥜', mandatory: false, labels: { ja: 'カシューナッツ', en: 'Cashew', zh: '腰果', ko: '캐슈너트' } },
        { code: 'KIWI', emoji: '🥝', mandatory: false, labels: { ja: 'キウイフルーツ', en: 'Kiwi', zh: '猕猴桃', ko: '키위' } },
        { code: 'BEEF', emoji: '🥩', mandatory: false, labels: { ja: '牛肉', en: 'Beef', zh: '牛肉', ko: '소고기' } },
        { code: 'SESAME', emoji: '⚪', mandatory: false, labels: { ja: 'ごま', en: 'Sesame', zh: '芝麻', ko: '참깨' } },
        { code: 'SALMON', emoji: '🍣', mandatory: false, labels: { ja: 'さけ', en: 'Salmon', zh: '鲑鱼', ko: '연어' } },
        { code: 'MACKEREL', emoji: '🐟', mandatory: false, labels: { ja: 'さば', en: 'Mackerel', zh: '鲭鱼', ko: '고등어' } },
        { code: 'SOY', emoji: '🫘', mandatory: false, labels: { ja: '大豆', en: 'Soy', zh: '大豆', ko: '대두' } },
        { code: 'CHICKEN', emoji: '🍗', mandatory: false, labels: { ja: '鶏肉', en: 'Chicken', zh: '鸡肉', ko: '닭고기' } },
        { code: 'BANANA', emoji: '🍌', mandatory: false, labels: { ja: 'バナナ', en: 'Banana', zh: '香蕉', ko: '바나나' } },
        { code: 'PORK', emoji: '🥓', mandatory: false, labels: { ja: '豚肉', en: 'Pork', zh: '猪肉', ko: '돼지고기' } },
        { code: 'MACADAMIA', emoji: '🥜', mandatory: false, labels: { ja: 'マカダミアナッツ', en: 'Macadamia', zh: '夏威夷果', ko: '마카다미아' } },
        { code: 'PEACH', emoji: '🍑', mandatory: false, labels: { ja: 'もも', en: 'Peach', zh: '桃', ko: '복숭아' } },
        { code: 'YAM', emoji: '🥔', mandatory: false, labels: { ja: 'やまいも', en: 'Yam', zh: '山药', ko: '참마' } },
        { code: 'APPLE', emoji: '🍎', mandatory: false, labels: { ja: 'りんご', en: 'Apple', zh: '苹果', ko: '사과' } },
        { code: 'GELATIN', emoji: '🍮', mandatory: false, labels: { ja: 'ゼラチン', en: 'Gelatin', zh: '明胶', ko: '젤라틴' } },
        // 旧推奨（データ後方互換・UIでは任意表示）
        { code: 'MATSUTAKE', emoji: '🍄', mandatory: false, legacy: true, labels: { ja: 'まつたけ', en: 'Matsutake', zh: '松茸', ko: '송이버섯' } }
    ];

    var BY_CODE = {};
    ALLERGENS.forEach(function (item) {
        BY_CODE[item.code] = item;
    });

    function normalizeLang(lang) {
        var raw = String(lang == null ? 'ja' : lang).trim().toLowerCase();
        if (raw.indexOf('-') >= 0) {
            raw = raw.split('-')[0];
        }
        if (raw === 'cn' || raw === 'zh-cn' || raw === 'zh_hans') {
            return 'zh';
        }
        if (raw === 'kr' || raw === 'ko-kr') {
            return 'ko';
        }
        if (raw === 'en' || raw === 'zh' || raw === 'ko' || raw === 'ja') {
            return raw;
        }
        return 'ja';
    }

    function normalizeCode(raw) {
        if (raw == null) {
            return '';
        }
        if (typeof raw === 'object') {
            raw = raw.name || raw.code || raw.value || '';
        }
        var code = String(raw || '').trim().toUpperCase();
        return BY_CODE[code] ? code : '';
    }

    function label(code, lang) {
        var normalized = normalizeCode(code);
        var def = BY_CODE[normalized];
        if (!def) {
            return String(code || '');
        }
        var l = normalizeLang(lang);
        return (def.labels && (def.labels[l] || def.labels.ja)) || normalized;
    }

    function displayLabel(code, lang) {
        var normalized = normalizeCode(code);
        var def = BY_CODE[normalized];
        if (!def) {
            return String(code || '');
        }
        return (def.emoji ? def.emoji + ' ' : '') + label(normalized, lang);
    }

    /**
     * UI 用オプション。legacy は includeLegacy=true のときのみ。
     * @returns {Array<[string, string, string]>} [code, label, emoji]
     */
    function options(lang, includeLegacy) {
        var l = normalizeLang(lang);
        var out = [];
        ALLERGENS.forEach(function (item) {
            if (item.legacy && !includeLegacy) {
                return;
            }
            out.push([item.code, item.labels[l] || item.labels.ja, item.emoji || '']);
        });
        return out;
    }

    /** Order SDK 互換: [[code, jpLabel], ...] */
    function optionsPairs(lang, includeLegacy) {
        return options(lang, includeLegacy).map(function (row) {
            return [row[0], row[1]];
        });
    }

    function isKnown(code) {
        return !!normalizeCode(code);
    }

    global.MasterOrderAllergens = {
        version: 1,
        HIDDEN_TTL_MS: HIDDEN_TTL_MS,
        ALLERGENS: ALLERGENS,
        BY_CODE: BY_CODE,
        normalizeLang: normalizeLang,
        normalizeCode: normalizeCode,
        label: label,
        displayLabel: displayLabel,
        options: options,
        optionsPairs: optionsPairs,
        isKnown: isKnown
    };
})(typeof window !== 'undefined' ? window : globalThis);
