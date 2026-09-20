/**
 * MasterOrder Order SDK — 来客（お客様）向け。
 *
 * 依存: api-routes.js → core-sdk.js → order-sdk.js
 * グローバル: MasterOrderOrderSdk（推奨） / MasterOrderSdk（後方互換）
 *
 * Firebase なし。セッション PIN + Server REST のみ。
 * UI から Server へ直接 fetch せず、createOrderSdk() 経由で通信してください。
 */
(function (global) {
    'use strict';

    var SDK_VERSION = '1.2.1';

    const core = global.MasterOrderCoreSdk;
    if (!core) {
        throw new Error('MasterOrderCoreSdk is required before order-sdk.js');
    }
    const apiRouteRegistry = global.MasterOrderApiRoutes;
    if (!apiRouteRegistry || !apiRouteRegistry.paths || !apiRouteRegistry.paths.guest) {
        throw new Error('MasterOrderApiRoutes is required. Load api-routes.js before order-sdk.js');
    }
    const guestPaths = apiRouteRegistry.paths.guest;
    const gateGuestPaths = apiRouteRegistry.paths.gateGuest;
    const authPaths = apiRouteRegistry.paths.auth || apiRouteRegistry.paths.staff;

    function planGate() {
        return global.MasterOrderPlanGate || null;
    }

    function resolveGuestIsFree(shop, bundle) {
        var gate = planGate();
        if (gate && typeof gate.resolveIsFree === 'function') {
            if (gate.resolveIsFree(shop)) {
                return true;
            }
            if (gate.resolveIsFree(bundle)) {
                return true;
            }
            if (shop && shop.isFree === false) {
                return false;
            }
            if (bundle && bundle.isFree === false) {
                return false;
            }
            return false;
        }
        if (shop && shop.isFree === true) {
            return true;
        }
        if (bundle && bundle.isFree === true) {
            return true;
        }
        return false;
    }

    function shouldShowGuestAds(shop, bundle) {
        var gate = planGate();
        if (gate && typeof gate.shouldShowGuestAds === 'function') {
            return gate.shouldShowGuestAds(shop, bundle);
        }
        return resolveGuestIsFree(shop, bundle);
    }

    const MAX_MENU_UNITS_PER_GUEST_ORDER = 20;
    const REJECT_GUEST_ORDER_AT_MENU_UNITS = MAX_MENU_UNITS_PER_GUEST_ORDER + 1;
    const GUEST_ORDER_MAX_QUANTITY_MESSAGE =
        '1回の注文はメニュー合計' + MAX_MENU_UNITS_PER_GUEST_ORDER + '個までです（トッピングは含みません）';

    const ORDER_SEND_STATUS = {
        SENDING: 'sending',
        COMPLETED: 'completed',
        FAILED: 'failed'
    };
    const LS_SESSION_ID = 'mo_sessionId';
    const LS_PIN = 'mo_pin';
    const LS_SESSION_SHOP_SLUG = 'mo_sessionShopSlug';
    const LS_SESSION_SHOP_ID = 'mo_sessionShopId';
    const JOIN_SESSION_PARAM = 'sessionId';
    const JOIN_PIN_PARAM = 'pin';
    const JOIN_TOKEN_PARAM = 'join';
    const FIXED_QR_SHOP_PARAM = 'shopId';
    const FIXED_QR_TABLE_PARAM = 'tableNo';
    const FIXED_QR_PASS_PARAM = 'passPhrase';
    const PENDING_JOIN_STORAGE_KEY = 'mo_pendingJoin';
    const FIXED_QR_PENDING_OPEN_KEY = 'mo_fixed_qr_pending_open';
    const FIXED_QR_PENDING_OPEN_TTL_MS = 15 * 60 * 1000;
    const SESSION_CONTEXT_KEY = 'mo_session_context';
    const CREDENTIAL_QUERY_KEYS = [
        'id', 'pass', 'session', 'pin',
        JOIN_SESSION_PARAM, JOIN_PIN_PARAM,
        FIXED_QR_SHOP_PARAM, FIXED_QR_TABLE_PARAM, FIXED_QR_PASS_PARAM,
        'passPhrase', 'shop', 'table'
    ];
    const SESSION_PIN_HEADER = core.SESSION_PIN_HEADER || 'X-Session-PIN';
    const GUEST_SESSION_ID_HEADER = 'X-Mo-Session-Id';
    const GUEST_OVERLAY_TOKEN_HEADER = 'X-Mo-Overlay-Token';
    const GUEST_OVERLAY_TOKEN_PREFIX = 'mo_guest_overlay_token:';
    const DEFAULT_LINE_SEPARATOR = ' x ';
    const GUEST_MENU_DEFAULT_CATEGORY = 'その他';
    const GUEST_MENU_LOAD_STATE = {
        IDLE: 'idle',
        LOADING: 'loading',
        READY: 'ready',
        ERROR: 'error'
    };
    const GUEST_MENU_LANG_KEY = 'mo_guest_menu_lang';
    const GUEST_MENU_LANG_EXPLICIT_KEY = 'mo_guest_menu_lang_explicit';
    const GUEST_HIDDEN_ALLERGIES_KEY = 'mo_guest_hidden_allergies';
    const GUEST_HIDDEN_ALLERGIES_TTL_MS = (global.MasterOrderAllergens
        && global.MasterOrderAllergens.HIDDEN_TTL_MS)
        || (8 * 60 * 60 * 1000);
    const GUEST_MENU_LANG_DEFAULT = 'ja';
    const GUEST_MENU_LANG_LABELS = {
        ja: '日本語',
        en: 'English',
        zh: '中文',
        ko: '한국어'
    };
    const GUEST_MENU_LANG_ORDER = ['ja', 'en', 'zh', 'ko'];

    function allergyCatalog() {
        return global.MasterOrderAllergens || null;
    }

    /** 食品表示法順。Core allergens.js が無い場合のフォールバック。 */
    function guestAllergyOptions(lang) {
        var catalog = allergyCatalog();
        if (catalog && typeof catalog.optionsPairs === 'function') {
            return catalog.optionsPairs(lang || getGuestMenuLang(), false);
        }
        return [
            ['SHRIMP', 'えび'], ['CRAB', 'かに'], ['WALNUT', 'くるみ'], ['WHEAT', '小麦'],
            ['BUCKWHEAT', 'そば'], ['EGG', '卵'], ['MILK', '乳'], ['PEANUTS', '落花生'],
            ['ALMOND', 'アーモンド'], ['ABALONE', 'あわび'], ['SQUID', 'いか'], ['SALMON_ROE', 'いくら'],
            ['ORANGE', 'オレンジ'], ['CASHEW_NUT', 'カシューナッツ'], ['KIWI', 'キウイフルーツ'],
            ['BEEF', '牛肉'], ['SESAME', 'ごま'], ['SALMON', 'さけ'], ['MACKEREL', 'さば'],
            ['SOY', '大豆'], ['CHICKEN', '鶏肉'], ['BANANA', 'バナナ'], ['PORK', '豚肉'],
            ['MACADAMIA', 'マカダミアナッツ'], ['PEACH', 'もも'], ['YAM', 'やまいも'],
            ['APPLE', 'りんご'], ['GELATIN', 'ゼラチン']
        ];
    }

    const SHOP_PUBLIC_ID_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    function normalizeShopPublicId(raw) {
        var s = String(raw == null ? '' : raw).trim();
        if (!s) {
            return null;
        }
        if (SHOP_PUBLIC_ID_UUID_RE.test(s)) {
            return s.toLowerCase();
        }
        var match = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        return match ? match[0].toLowerCase() : null;
    }

    function isShopPublicId(raw) {
        return normalizeShopPublicId(raw) != null;
    }

    /**
     * Connect に店舗 UUID を付ける。旧 Server（Integer shopId）との互換のため
     * 別クエリ {@code shopPublicId} を使う（未知パラメータは無視される）。
     */
    function shopPublicIdForConnectQuery(shopId) {
        return normalizeShopPublicId(shopId);
    }

    function applyConnectShopScope(connectQuery, shopId) {
        var publicId = shopPublicIdForConnectQuery(shopId);
        if (publicId) {
            connectQuery.shopPublicId = publicId;
        }
        return connectQuery;
    }

    var GUEST_CONNECT_CREDENTIALS_WRONG = 'IDやPASSが間違っています';

    /** サーバーが端末 BAN を返したか（接続・注文・名簿など共通）。 */
    function isGuestBannedError(error) {
        if (!error) {
            return false;
        }
        var payload = error.payload || error.body || null;
        if (payload && typeof payload === 'object') {
            if (payload.code === 'GUEST_BANNED' || payload.banId) {
                return true;
            }
        }
        return false;
    }

    /** 来客接続失敗を一律の資格情報メッセージに正規化（他店舗の生存ヒントを出さない）。 */
    function formatGuestConnectError(error) {
        if (!error) {
            return GUEST_CONNECT_CREDENTIALS_WRONG;
        }
        var payload = error.payload || error.body || null;
        if (payload && typeof payload === 'object') {
            if (payload.code === 'GUEST_BANNED' || payload.banId) {
                return String(payload.message || ('この端末はBANされています。ID ' + (payload.banId || '')));
            }
            if (payload.code === 'IP_BLOCKED') {
                return String(payload.message
                    || 'この店舗にアクセスするには VPN やプロキシをオフにしてください。');
            }
            if (payload.message) {
                return String(payload.message);
            }
            if (payload.detail) {
                return String(payload.detail);
            }
        }
        var status = Number(error.status) || 0;
        if (status === 404) {
            return GUEST_CONNECT_CREDENTIALS_WRONG;
        }
        var msg = String(error.message || error || '').trim();
        if (!msg
                || /^HTTP\s*404\b/i.test(msg)
                || /別の店舗/.test(msg)
                || /間違って/.test(msg)
                || /not\s*found/i.test(msg)) {
            return GUEST_CONNECT_CREDENTIALS_WRONG;
        }
        return msg;
    }

    /** fixed-qr/open の shopId — UUID（shop public_id）のみ。 */
    function requireShopPublicId(shopId) {
        var uuid = normalizeShopPublicId(shopId);
        if (!uuid) {
            return null;
        }
        return uuid;
    }

    function enrichConnectDetailPublicShopId(detail, shopIdHint) {
        if (!detail || !isShopPublicId(shopIdHint)) {
            return detail;
        }
        var uuid = normalizeShopPublicId(shopIdHint);
        if (!uuid) {
            return detail;
        }
        return Object.assign({}, detail, { shopId: uuid });
    }

    const LEGACY_GUEST_QUERY_KEYS = [
        'mo_shop_id',
        'mo_shop_slug',
        'mo_template_key',
        'mo_view_only',
        'mo_logo_url',
        'mo_has_custom_css'
    ];
    const GUEST_SHOP_PATH_PREFIX = '/Shop';
    /** Cloudflare Pages 等で slug ルートと競合しないよう予約（先頭パスセグメント） */
    const GUEST_RESERVED_PATH_SEGMENTS = {
        scan: true,
        shop: true,
        connect: true,
        view: true,
        index2: true,
        index: true,
        js: true,
        orderpages: true,
        'guest-scan': true,
        'guest-shop': true,
        '404': true,
        favicon: true,
        sw: true
    };

    function readFixedQrParamsFromLocation(loc) {
        var locationRef = loc || (typeof location !== 'undefined' ? location : null);
        var params = new URLSearchParams(locationRef ? locationRef.search || '' : '');
        var tableNo = String(params.get(FIXED_QR_TABLE_PARAM) || params.get('table') || '').trim();
        if (!tableNo && locationRef && locationRef.pathname) {
            var pathParts = String(locationRef.pathname || '/').split('/').filter(Boolean);
            if (pathParts.length >= 3
                    && String(pathParts[0]).toLowerCase() === 'shop'
                    && /^\d+$/.test(pathParts[2])) {
                tableNo = pathParts[2];
            }
        }
        var passPhrase = String(params.get(FIXED_QR_PASS_PARAM) || params.get('passPhrase') || '').trim();
        return {
            tableNo: tableNo,
            passPhrase: passPhrase
        };
    }

    function isFixedQrConnectEntryPath(loc) {
        var locationRef = loc || (typeof location !== 'undefined' ? location : null);
        if (!locationRef) {
            return false;
        }
        var parsed = readFixedQrParamsFromLocation(locationRef);
        if (!/^\d+$/.test(parsed.tableNo) || !parsed.passPhrase || parsed.passPhrase.length > 128) {
            return false;
        }
        var route = parseGuestRoute(locationRef.pathname || '/');
        if (route.type === 'shop-slug') {
            return true;
        }
        var parts = String(locationRef.pathname || '/').split('/').filter(Boolean);
        return parts.length >= 2 && String(parts[0]).toLowerCase() === 'shop' && !!parts[1];
    }

    function stripLegacyMoQueryParams(options) {
        if (typeof history === 'undefined' || typeof location === 'undefined') {
            return;
        }
        options = options || {};
        var params = new URLSearchParams(location.search || '');
        var joinId = sanitizeGuestSessionId(
            params.get('id') || params.get(JOIN_SESSION_PARAM) || ''
        );
        var joinPin = sanitizeGuestJoinPin(
            params.get('pass') || params.get(JOIN_PIN_PARAM) || ''
        );
        if (joinId && joinPin) {
            stashJoinCredentialsForRoute(joinId, joinPin);
        }
        var changed = false;
        var keys = LEGACY_GUEST_QUERY_KEYS.concat(CREDENTIAL_QUERY_KEYS);
        if (!options.force && isFixedQrConnectEntryPath()) {
            keys = LEGACY_GUEST_QUERY_KEYS.slice();
        }
        keys.forEach(function (key) {
            if (params.has(key)) {
                params.delete(key);
                changed = true;
            }
        });
        if (!changed) {
            return;
        }
        var q = params.toString();
        history.replaceState(history.state, document.title, location.pathname + (q ? '?' + q : '') + (location.hash || ''));
    }

    function parseSessionContextFromStorage() {
        if (typeof sessionStorage === 'undefined') {
            return null;
        }
        try {
            var raw = sessionStorage.getItem(SESSION_CONTEXT_KEY);
            if (!raw) {
                return null;
            }
            var parsed = JSON.parse(raw);
            var sessionId = sanitizeGuestSessionId(parsed && parsed.sessionId);
            var pin = sanitizeGuestJoinPin(parsed && parsed.pin);
            if (sessionId && pin) {
                return { sessionId: sessionId, pin: pin };
            }
        } catch (_) { /* ignore */ }
        return null;
    }

    function sanitizeCustomCss(css) {
        var raw = String(css || '');
        if (!raw) {
            return '';
        }
        // HTMLタグ文字や注入ベクターは一切残さない
        if (/[<＜]|<\/style|<script|<img|<image|<svg|<iframe|<object|<embed|<link|<meta|javascript:|vbscript:|expression\s*\(|@import|behavior\s*:|-moz-binding|url\s*\(\s*["']?\s*(?:https?:|\/\/|data:)/i.test(raw)) {
            return '';
        }
        return raw.length > 32768 ? raw.slice(0, 32768) : raw;
    }

    function isSafeBrandingAssetUrl(url) {
        var value = String(url || '').trim();
        if (!value) {
            return false;
        }
        if (value.charAt(0) === '/' && value.charAt(1) !== '/') {
            return true;
        }
        return /^https:\/\//i.test(value);
    }

    var GUEST_SESSION_ID_RE = /^[ABEFGHJKMNPQRTUVWXYZabefghjkmnpqrtuvwxyz]{10}$/;
    /** Gate 初期実装が出した 16 hex（移行中の既存セッション用）。 */
    var GUEST_SESSION_ID_LEGACY_HEX_RE = /^[0-9a-fA-F]{16}$/;
    var GUEST_PIN_RE = /^[0-9A-Z]{8}$/;
    /** Gate 初期実装が出した 4 文字 PIN（移行中の既存セッション用）。 */
    var GUEST_PIN_LEGACY_RE = /^[0-9A-Z]{4}$/;
    var SAFE_GUEST_RELATIVE_PATH_RE = /^\/[A-Za-z0-9][A-Za-z0-9._\-/]*$/;
    var SAFE_CONNECT_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._\-]*$/;
    var KNOWN_TEMPLATE_ENTRY_PATHS = {
        komorebi_premium: '/guest-shop/',
        index2: '/guest-shop/',
        original: '/guest-shop/',
        index: '/guest-shop/',
        'cursor-1': '/guest-shop/',
        'premium-neon': '/guest-shop/'
    };

    function sanitizeGuestSessionId(sessionId) {
        var id = String(sessionId || '').trim();
        if (GUEST_SESSION_ID_RE.test(id) || GUEST_SESSION_ID_LEGACY_HEX_RE.test(id)) {
            return id;
        }
        return '';
    }

    function sanitizeGuestJoinPin(pin) {
        var normalized = normalizeJoinPin(pin);
        if (GUEST_PIN_RE.test(normalized) || GUEST_PIN_LEGACY_RE.test(normalized)) {
            return normalized;
        }
        return '';
    }

    function migrateSessionCredentialsFromLocalStorage() {
        if (typeof localStorage === 'undefined' || typeof sessionStorage === 'undefined') {
            return;
        }
        var keys = [LS_SESSION_ID, LS_PIN, LS_SESSION_SHOP_SLUG, LS_SESSION_SHOP_ID];
        var hasLocal = keys.some(function (k) {
            var v = localStorage.getItem(k);
            return v != null && String(v).trim() !== '';
        });
        if (!hasLocal) {
            return;
        }
        keys.forEach(function (k) {
            var v = localStorage.getItem(k);
            if (v != null && String(v).trim() !== '' && !sessionStorage.getItem(k)) {
                sessionStorage.setItem(k, v);
            }
            localStorage.removeItem(k);
        });
    }
    migrateSessionCredentialsFromLocalStorage();

    function sanitizeConnectSlug(slug) {
        var raw = String(slug || '').trim();
        if (!raw || raw.indexOf('..') >= 0 || /[\/\\:?#\u0000-\u001F\u007F]/.test(raw)) {
            return '';
        }
        if (SAFE_CONNECT_SLUG_RE.test(raw)) {
            return raw;
        }
        return displayPathSlug(raw);
    }

    function isSafeSameOriginRelativePath(path) {
        var value = String(path || '').trim();
        if (!value || value.charAt(0) !== '/' || value.indexOf('//') === 0) {
            return false;
        }
        if (/\\|\u0000|\u007F/.test(value)) {
            return false;
        }
        var parsed;
        try {
            parsed = new URL(value, 'https://guest.invalid');
        } catch (_) {
            return false;
        }
        if (parsed.origin !== 'https://guest.invalid' || parsed.pathname.indexOf('..') >= 0) {
            return false;
        }
        if (parsed.pathname === '/') {
            return true;
        }
        return SAFE_GUEST_RELATIVE_PATH_RE.test(parsed.pathname);
    }

    function resolveTrustedGuestOrderOrigin() {
        var base = inferGuestOrderPublicBase();
        if (!base) {
            return '';
        }
        try {
            var parsed = new URL(base);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return '';
            }
            if (parsed.username || parsed.password) {
                return '';
            }
            return parsed.origin;
        } catch (_) {
            return '';
        }
    }

    function isSafeTrustedOrderConnectUrl(url, trustedOrigin) {
        if (!url || !trustedOrigin) {
            return false;
        }
        var parsed;
        try {
            parsed = new URL(url);
        } catch (_) {
            return false;
        }
        if (parsed.origin !== trustedOrigin) {
            return false;
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return false;
        }
        if (parsed.pathname !== '/connect') {
            return false;
        }
        var id = sanitizeGuestSessionId(parsed.searchParams.get('id') || '');
        var pass = sanitizeGuestJoinPin(parsed.searchParams.get('pass') || '');
        if (id && pass) {
            return parsed.searchParams.get('id') === id && parsed.searchParams.get('pass') === pass;
        }
        var shopId = String(parsed.searchParams.get(FIXED_QR_SHOP_PARAM) || parsed.searchParams.get('shop') || '').trim();
        var tableNo = String(parsed.searchParams.get(FIXED_QR_TABLE_PARAM) || parsed.searchParams.get('table') || '').trim();
        var passPhrase = String(parsed.searchParams.get(FIXED_QR_PASS_PARAM) || parsed.searchParams.get('passPhrase') || '').trim();
        return isShopPublicId(shopId) && /^\d+$/.test(tableNo) && passPhrase.length > 0 && passPhrase.length <= 128;
    }

    function slugifyAscii(value) {
        var raw = String(value || '').trim();
        if (!raw) {
            return '';
        }
        return raw
            .replace(/\s+/g, '-')
            .replace(/[^A-Za-z0-9\-_.~]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }

    function displayPathSlug(value) {
        var raw = String(value || '').trim();
        if (!raw) {
            return '';
        }
        var cleaned = raw.replace(/[/\\?#%\u0000-\u001F\u007F]/g, '');
        cleaned = cleaned.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        return cleaned;
    }

    function normalizeGuestRouteSlugSegment(segment) {
        var raw = String(segment || '').trim();
        if (!raw) {
            return '';
        }
        try {
            return decodeURIComponent(raw);
        } catch (_) {
            return raw;
        }
    }

    function isGuestReservedPathSegment(segment) {
        var key = String(segment || '').trim().toLowerCase();
        if (!key) {
            return true;
        }
        if (GUEST_RESERVED_PATH_SEGMENTS[key]) {
            return true;
        }
        return key.endsWith('.html') || key.endsWith('.js') || key.endsWith('.ico')
            || key.endsWith('.svg') || key.endsWith('.webp');
    }

    function guestSlugMatches(routeSlug, expectedSlug) {
        var route = normalizeGuestRouteSlugSegment(routeSlug);
        var expected = displayPathSlug(expectedSlug) || String(expectedSlug || '').trim();
        if (!route || !expected) {
            return false;
        }
        if (route === expected) {
            return true;
        }
        return displayPathSlug(route) === displayPathSlug(expected);
    }

    function parseGuestRoute(pathname) {
        var parts = String(pathname || '/').split('/').filter(Boolean);
        if (parts.length === 0) {
            return { type: 'root' };
        }
        if (String(parts[0]).toLowerCase() === 'scan') {
            return { type: 'removed', removed: 'scan' };
        }
        if (String(parts[0]).toLowerCase() === 'shop' && parts.length >= 2) {
            if (parts.length >= 3 && String(parts[2]).toLowerCase() === 'scan') {
                return { type: 'shop-slug', shopSlug: normalizeGuestRouteSlugSegment(parts[1]) };
            }
            return { type: 'shop-slug', shopSlug: normalizeGuestRouteSlugSegment(parts[1]) };
        }
        if (parts.length === 2 && String(parts[1]).toLowerCase() === 'scan'
                && !isGuestReservedPathSegment(parts[0])) {
            return { type: 'shop-slug', shopSlug: normalizeGuestRouteSlugSegment(parts[0]) };
        }
        if (parts.length === 1 && !isGuestReservedPathSegment(parts[0])) {
            return { type: 'shop-slug', shopSlug: normalizeGuestRouteSlugSegment(parts[0]) };
        }
        return { type: 'other' };
    }

    function isShopScopedGuestRoute(route) {
        return !!route && route.type === 'shop-slug';
    }

    function guestRouteShopSlug(route) {
        if (!isShopScopedGuestRoute(route)) {
            return '';
        }
        return route.shopSlug || '';
    }

    function buildShopScopedScanPath(shopSlug) {
        return buildShopScopedGuestPath(shopSlug);
    }

    function buildShopScopedGuestPath(shopSlug) {
        var slug = displayPathSlug(shopSlug) || String(shopSlug || '').trim();
        if (!slug) {
            return '';
        }
        return GUEST_SHOP_PATH_PREFIX + '/' + encodeURIComponent(slug) + '/';
    }

    function buildShopScopedGuestUrl(shopSlug, sessionId, pin) {
        var path = buildShopScopedGuestPath(shopSlug);
        if (!path) {
            return '';
        }
        var id = sanitizeGuestSessionId(sessionId);
        var normalizedPin = sanitizeGuestJoinPin(pin);
        if (!id || !normalizedPin) {
            return path;
        }
        var params = new URLSearchParams();
        params.set('id', id);
        params.set('pass', normalizedPin);
        return path + '?' + params.toString();
    }

    function buildShopScopedScanUrl(shopSlug, sessionId, pin) {
        return buildShopScopedGuestUrl(shopSlug, sessionId, pin);
    }

    function resolveShopPublicSlug(detail, shopIdHint) {
        if (!detail || typeof detail !== 'object') {
            detail = {};
        }
        var raw = detail.raw && typeof detail.raw === 'object' ? detail.raw : {};
        var fromDetail = (detail.shopSlug || raw.shopSlug || detail.urlSlug || raw.urlSlug || '').trim();
        if (fromDetail) {
            return displayPathSlug(fromDetail) || fromDetail;
        }
        return '';
    }

    function buildShopPublicUrl(shopSlug) {
        var slug = displayPathSlug(shopSlug) || String(shopSlug || '').trim();
        if (!slug) {
            return '';
        }
        return GUEST_SHOP_PATH_PREFIX + '/' + encodeURIComponent(slug) + '/';
    }

    function resolveConnectSlug(detail) {
        if (!detail || typeof detail !== 'object') {
            return '';
        }
        var raw = detail.raw && typeof detail.raw === 'object' ? detail.raw : {};
        var fromApi = (detail.shopSlug || raw.shopSlug || '').trim();
        if (fromApi) {
            return fromApi;
        }
        var fromName = displayPathSlug(
            detail.shopName || raw.shopName || (raw.shop && raw.shop.name) || '');
        if (fromName) {
            return fromName;
        }
        var shopId = detail.shopId != null ? detail.shopId : raw.shopId;
        if (isShopPublicId(shopId)) {
            return 'shop-' + normalizeShopPublicId(shopId);
        }
        return '';
    }

    function resolveConnectShopId(detail, shopIdHint) {
        if (!detail || typeof detail !== 'object') {
            detail = {};
        }
        var raw = detail.raw && typeof detail.raw === 'object' ? detail.raw : {};
        var shopId = detail.shopId != null ? detail.shopId : raw.shopId;
        if (!normalizeShopPublicId(shopId) && shopIdHint != null) {
            shopId = shopIdHint;
        }
        return normalizeShopPublicId(shopId);
    }

    function connectPathSlug(detail, shopIdHint) {
        if (!detail || typeof detail !== 'object') {
            return '';
        }
        var shopId = resolveConnectShopId(detail, shopIdHint);
        if (shopId) {
            return 'shop-' + shopId;
        }
        return resolveConnectSlug(detail);
    }

    function isConnectShopRelativePath(path) {
        var pathOnly = String(path || '').trim().split('?')[0].split('#')[0];
        if (!pathOnly || pathOnly.indexOf('..') >= 0 || pathOnly.indexOf('//') === 0) {
            return false;
        }
        return /^\/connect\/[^/\\?#]+/.test(pathOnly);
    }

    function normalizeGuestPathname(pathname) {
        var path = String(pathname || '/').split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
        if (path === '/index.html') {
            return '/';
        }
        if (path === '/index2' || path === '/index2.html') {
            return '/index2';
        }
        var route = parseGuestRoute(path);
        if (route.type === 'shop-slug' && route.shopSlug) {
            return buildShopPublicUrl(route.shopSlug).replace(/\/+$/, '');
        }
        return path;
    }

    function isSameGuestNavigationTarget(pathOrUrl) {
        if (typeof location === 'undefined') {
            return false;
        }
        var raw = String(pathOrUrl || '').trim();
        if (!raw) {
            return false;
        }
        var targetPath;
        if (raw.charAt(0) === '/') {
            targetPath = raw.split('?')[0].split('#')[0];
        } else {
            try {
                targetPath = new URL(raw, location.origin).pathname;
            } catch (_) {
                return false;
            }
        }
        return normalizeGuestPathname(location.pathname) === normalizeGuestPathname(targetPath);
    }

    function guestLocationReplace(pathOrUrl) {
        if (typeof location === 'undefined') {
            return false;
        }
        var raw = String(pathOrUrl || '').trim();
        if (!raw) {
            return false;
        }
        if (isSameGuestNavigationTarget(raw)) {
            return false;
        }
        var resolved;
        if (raw.charAt(0) === '/') {
            if (!isSafeSameOriginRelativePath(raw)) {
                return false;
            }
            resolved = new URL(raw, location.origin);
            if (resolved.origin !== location.origin) {
                return false;
            }
        } else {
            var trustedOrigin = resolveTrustedGuestOrderOrigin();
            if (!trustedOrigin || !isSafeTrustedOrderConnectUrl(raw, trustedOrigin)) {
                return false;
            }
            resolved = new URL(raw);
        }
        if (!isSafeSameOriginRelativePath(resolved.pathname)) {
            return false;
        }
        location.replace(resolved.pathname + resolved.search + resolved.hash);
        return true;
    }

    function connectShopPath(shopSlug) {
        return buildShopPublicUrl(shopSlug) || '';
    }

    function normalizeRouteSlug(slug) {
        var raw = String(slug || '').trim();
        if (!raw) {
            return '';
        }
        try {
            return decodeURIComponent(raw);
        } catch (_) {
            return raw;
        }
    }

    function connectSlugsMatch(routeSlug, detail) {
        var route = normalizeRouteSlug(routeSlug);
        if (!route || !detail) {
            return false;
        }
        var publicSlug = resolveShopPublicSlug(detail);
        if (publicSlug && guestSlugMatches(route, publicSlug)) {
            return true;
        }
        var pathSlug = connectPathSlug(detail);
        var displaySlug = resolveConnectSlug(detail);
        if (pathSlug && route === pathSlug) {
            return true;
        }
        if (displaySlug && route === displaySlug) {
            return true;
        }
        var raw = detail.raw && typeof detail.raw === 'object' ? detail.raw : {};
        var shopId = detail.shopId != null ? detail.shopId : raw.shopId;
        if (isShopPublicId(shopId) && route === 'shop-' + normalizeShopPublicId(shopId)) {
            return true;
        }
        return false;
    }

    function guestCredentialsQuery(sessionId, pin) {
        stashJoinCredentialsForRoute(sessionId, pin);
        return '';
    }

    function normalizeGuestTemplateEntryPath(path) {
        var p = String(path || '').trim();
        if (!p) {
            return '';
        }
        if (p === '/index2.html' || p === '/index2' || p === '/index2/') {
            return '/guest-shop/';
        }
        if (p === '/guest-shop' || p === '/guest-shop/') {
            return '/guest-shop/';
        }
        return isSafeSameOriginRelativePath(p) ? p : '/guest-shop/';
    }

    function templateEntryPathForShop(shop) {
        if (!shop) {
            return '';
        }
        var path = shop.templateEntryPath || '';
        if (!path && shop.templateKey) {
            var key = String(shop.templateKey).toLowerCase().replace(/-/g, '_');
            path = KNOWN_TEMPLATE_ENTRY_PATHS[key]
                || KNOWN_TEMPLATE_ENTRY_PATHS[String(shop.templateKey).toLowerCase()]
                || '/guest-shop/';
        }
        if (!path) {
            return '';
        }
        return normalizeGuestTemplateEntryPath(path);
    }

    function currentGuestShell() {
        if (typeof document === 'undefined') {
            return '';
        }
        var meta = document.querySelector('meta[name="mo-guest-shell"]');
        return meta ? String(meta.getAttribute('content') || '').trim() : '';
    }

    function templateShellForPath(path) {
        var normalized = String(path || '').toLowerCase();
        if (normalized.indexOf('index2') >= 0 || normalized.indexOf('guest-shop') >= 0) {
            return 'index2';
        }
        return 'original';
    }

    function isOnCorrectGuestTemplate(detail) {
        if (!detail || typeof detail !== 'object') {
            return false;
        }
        if (typeof location !== 'undefined') {
            var route = parseGuestRoute(location.pathname || '/');
            var publicSlug = resolveShopPublicSlug(detail);
            if (route.type === 'shop-slug' && publicSlug && guestSlugMatches(route.shopSlug, publicSlug)) {
                var targetPath = templateEntryPathForShop({
                    templateKey: detail.templateKey,
                    templateEntryPath: detail.templateEntryPath
                });
                var targetShell = templateShellForPath(targetPath);
                var currentShell = currentGuestShell();
                return !currentShell || currentShell === targetShell;
            }
        }
        var targetPath = templateEntryPathForShop({
            templateKey: detail.templateKey,
            templateEntryPath: detail.templateEntryPath
        });
        if (!targetPath) {
            return false;
        }
        return isSameGuestNavigationTarget(targetPath);
    }

    function navigateToTemplateIfNeeded(shop, sessionId, pin) {
        return false;
    }

    function buildConnectShopUrl(detail, sessionId, pin, shopIdHint, fallbackSlug) {
        if (!detail || typeof detail !== 'object') {
            detail = {};
        }
        var sid = sanitizeGuestSessionId(sessionId || detail.sessionId);
        var normalizedPin = sanitizeGuestJoinPin(pin || detail.pin);
        stashJoinCredentialsForRoute(sid, normalizedPin);
        var publicSlug = resolveShopPublicSlug(detail, shopIdHint);
        if (!publicSlug) {
            publicSlug = resolveConnectSlug(detail);
            if (publicSlug && String(publicSlug).indexOf('shop-') === 0) {
                publicSlug = '';
            }
        }
        if (!publicSlug && fallbackSlug) {
            publicSlug = displayPathSlug(fallbackSlug) || String(fallbackSlug).trim();
        }
        if (!publicSlug) {
            return '';
        }
        if (sid && normalizedPin) {
            return buildShopScopedGuestUrl(publicSlug, sid, normalizedPin);
        }
        return buildShopPublicUrl(publicSlug);
    }

    function loadGuestReconnectCredentials() {
        var creds = loadSessionCredentials();
        var sessionId = creds.sessionId || '';
        var pin = creds.pin || '';
        var shopId = creds.shopId;
        var shopSlug = creds.shopSlug || '';
        try {
            var raw = sessionStorage.getItem(SESSION_CONTEXT_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    if (!sessionId) {
                        sessionId = sanitizeGuestSessionId(parsed.sessionId) || '';
                    }
                    if (!pin) {
                        pin = sanitizeGuestJoinPin(parsed.pin) || '';
                    }
                    if (shopId == null && parsed.shopId != null) {
                        shopId = normalizeShopPublicId(parsed.shopId);
                    }
                    if (!shopSlug) {
                        shopSlug = String(parsed.shopSlug || '').trim();
                    }
                }
            }
        } catch (_ignored) { /* ignore */ }
        return {
            sessionId: sessionId,
            pin: pin,
            shopId: shopId,
            shopSlug: shopSlug
        };
    }

    function enrichConnectDetailWithOpenMeta(detail, opened, payload) {
        var next = detail && typeof detail === 'object' ? Object.assign({}, detail) : {};
        var raw = next.raw && typeof next.raw === 'object' ? Object.assign({}, next.raw) : {};
        var shopId = resolveConnectShopId(next, opened && opened.shopId != null
            ? opened.shopId
            : (payload && payload.shopId));
        if (shopId) {
            next.shopId = shopId;
            raw.shopId = shopId;
        }
        if (opened && opened.tableNumber != null && Number(opened.tableNumber) > 0) {
            next.tableNumber = Number(opened.tableNumber);
            raw.tableNumber = Number(opened.tableNumber);
        } else if (payload && payload.tableNo != null && Number(payload.tableNo) > 0) {
            next.tableNumber = Number(payload.tableNo);
            raw.tableNumber = Number(payload.tableNo);
        }
        next.raw = raw;
        return next;
    }

    function guestSameOriginProxyBase() {
        if (global._guestSameOriginProxy !== true && global._guestSameOriginProxy !== 'true') {
            return '';
        }
        if (typeof window === 'undefined' || !window.location || !window.location.origin) {
            return '';
        }
        return String(window.location.origin).replace(/\/$/, '');
    }

    function inferGuestApiBase() {
        var sameOrigin = guestSameOriginProxyBase();
        if (sameOrigin) {
            return sameOrigin;
        }
        var fromLocation = core.inferPublicApiBaseFromLocation();
        if (fromLocation) {
            return fromLocation.replace(/\/$/, '');
        }
        return (global._serverBase || 'http://localhost:8080').replace(/\/$/, '');
    }

    function inferGuestCatalogReadBase() {
        var sameOrigin = guestSameOriginProxyBase();
        if (sameOrigin) {
            return sameOrigin;
        }
        if (typeof global._gatePublicBase === 'string' && global._gatePublicBase.trim()) {
            return global._gatePublicBase.trim().replace(/\/$/, '');
        }
        return inferGuestApiBase();
    }

    function usesGateCatalogRead() {
        return typeof global._gatePublicBase === 'string' && global._gatePublicBase.trim().length > 0;
    }

    function assertGateCatalogRead() {
        if (!usesGateCatalogRead()) {
            // order-config.js 未読込時のフォールバック（広告ブロッカー等）
            global._gatePublicBase = 'https://masterorder-gate.mcservers-wp.com';
        }
        if (!usesGateCatalogRead()) {
            throw new Error('Gate catalog read requires window._gatePublicBase (set order-config.js)');
        }
    }

    function inferGuestOrderPublicBase() {
        if (typeof global._orderPublicBase === 'string' && global._orderPublicBase.trim()) {
            return global._orderPublicBase.trim().replace(/\/$/, '');
        }
        var fromLocation = core.inferPublicOrderBaseFromLocation();
        if (fromLocation) {
            return fromLocation.replace(/\/$/, '');
        }
        return (typeof location !== 'undefined' ? location.origin : '').replace(/\/$/, '');
    }

    var GUEST_PUBLIC_SHOP_CACHE_PREFIX = 'mo_guest_public_shop:';
    var GUEST_ORDER_BUNDLE_CACHE_PREFIX = 'mo_guest_order_bundle:v3:';
    var GUEST_ORDER_BUNDLE_CACHE_PREFIX_LEGACY = 'mo_guest_order_bundle:';
    /** generation 不一致で破棄するので長 TTL 可。CDN 365日方針に合わせる。 */
    var GUEST_ORDER_BUNDLE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
    /** 来客メニュー bundle の sessionStorage TTL（pcr / generation で更新検知） */
    var GUEST_ORDER_BUNDLE_SESSION_CACHE_TTL_MS = 60 * 60 * 1000;
    /** pcr 付き軽量プローブの間隔（バナー/メニュー反映を待たせない） */
    var GUEST_PRICING_REVISION_PROBE_TTL_MS = 8 * 1000;
    var GUEST_ORDER_HISTORY_CACHE_TTL_MS = 60 * 60 * 1000;
    var GUEST_ORDER_HISTORY_CACHE_PREFIX = 'mo_guest_oh:';
    var GUEST_PRICING_CACHE_REVISION_PREFIX = 'mo_guest_pcr:';
    var GUEST_PRICING_REVISION_PROBE_PREFIX = 'mo_guest_pcr_probe:';
    var GUEST_ORDER_BUNDLE_ETAG_PREFIX = 'mo_guest_bundle_etag:';
    /** shopId:lang:name:cat|inv:swr|fresh → 進行中の order-bundle Promise */
    var inflightGuestOrderBundles = Object.create(null);
    var inflightGuestPublicShop = Object.create(null);

    /** 来客メニュー本体の端末キャッシュ（在庫は pricing-revision プローブで検知して再取得） */
    var GUEST_INVENTORY_BUNDLE_CACHE_TTL_MS = 60 * 60 * 1000;

    function guestBundleCacheTtlMs(menus, hasScheduledPromotions, bundle) {
        if (bundle && bundle.inventoryUpdatedAt) {
            return GUEST_INVENTORY_BUNDLE_CACHE_TTL_MS;
        }
        return GUEST_ORDER_BUNDLE_SESSION_CACHE_TTL_MS;
    }

    function guestCachedBundleHasMenus(bundle) {
        var menus = bundle && bundle.menus;
        return Array.isArray(menus) && menus.length > 0;
    }

    function guestBundlePricingSignature(bundle) {
        if (!bundle || typeof bundle !== 'object') {
            return '';
        }
        var menus = Array.isArray(bundle.menus) ? bundle.menus : [];
        var onSaleCount = 0;
        for (var i = 0; i < menus.length; i++) {
            var pricing = menus[i] && menus[i].pricing;
            if (pricing && (pricing.onSale || (pricing.display && pricing.display.onSale))) {
                onSaleCount += 1;
            }
        }
        var activeSales = Array.isArray(bundle.activeTimeSales) ? bundle.activeTimeSales.length : 0;
        return [
            bundle.hasScheduledPromotions === true ? '1' : '0',
            String(onSaleCount),
            String(activeSales),
            bundle.pricingRefreshIntervalSec != null ? String(bundle.pricingRefreshIntervalSec) : '',
            bundle.timesaleUpdatedAt != null ? String(bundle.timesaleUpdatedAt) : '',
            bundle.pricingCacheRevision != null ? String(bundle.pricingCacheRevision) : ''
        ].join('|');
    }

    function readGuestPricingCacheRevision(shopId) {
        if (typeof sessionStorage === 'undefined' || shopId == null || shopId === '') {
            return null;
        }
        try {
            var raw = sessionStorage.getItem(GUEST_PRICING_CACHE_REVISION_PREFIX + String(shopId));
            if (!raw || !String(raw).trim()) {
                return null;
            }
            return String(raw).trim();
        } catch (_ignored) {
            return null;
        }
    }

    function writeGuestPricingCacheRevision(shopId, revision) {
        if (typeof sessionStorage === 'undefined' || shopId == null || shopId === '' || revision == null) {
            return;
        }
        var next = String(revision).trim();
        if (!next) {
            return;
        }
        try {
            sessionStorage.setItem(GUEST_PRICING_CACHE_REVISION_PREFIX + String(shopId), next);
        } catch (_ignored) { /* quota */ }
    }

    function clearGuestPricingCacheRevision(shopId) {
        if (typeof sessionStorage === 'undefined' || shopId == null || shopId === '') {
            return;
        }
        try {
            sessionStorage.removeItem(GUEST_PRICING_CACHE_REVISION_PREFIX + String(shopId));
            sessionStorage.removeItem(GUEST_PRICING_REVISION_PROBE_PREFIX + String(shopId));
        } catch (_ignored) { /* quota */ }
    }

    function shouldProbeGuestPricingRevision(shopId) {
        if (typeof sessionStorage === 'undefined' || shopId == null || shopId === '') {
            return true;
        }
        return !readGuestSessionJsonCache(
            GUEST_PRICING_REVISION_PROBE_PREFIX + String(shopId),
            GUEST_PRICING_REVISION_PROBE_TTL_MS
        );
    }

    function markGuestPricingRevisionProbed(shopId) {
        writeGuestSessionJsonCache(GUEST_PRICING_REVISION_PROBE_PREFIX + String(shopId), { ok: true });
    }

    function shouldAttachGuestPricingCacheRevision(shopId, options) {
        if (options && options.forceFresh) {
            return false;
        }
        if (shouldProbeGuestPricingRevision(shopId)) {
            return false;
        }
        return !!readGuestPricingCacheRevision(shopId);
    }

    function guestBundleInventorySignature(bundle) {
        if (!bundle || typeof bundle !== 'object') {
            return '';
        }
        var invAt = bundle.inventoryUpdatedAt != null ? String(bundle.inventoryUpdatedAt) : '';
        var menus = Array.isArray(bundle.menus) ? bundle.menus : [];
        var parts = [];
        for (var i = 0; i < menus.length; i++) {
            var menu = menus[i];
            if (!menu || menu.id == null) {
                continue;
            }
            parts.push(
                String(menu.id) + ':'
                + (menu.soldOut === true ? '0' : '1') + ':'
                + (menu.stockQuantity != null ? String(menu.stockQuantity) : '')
            );
        }
        parts.sort();
        return invAt + '|' + parts.join(',');
    }

    function guestCatalogProbeUnchanged(shopId, meta, cachedBundle, options) {
        if (!meta || !cachedBundle) {
            return false;
        }
        // プローブ後に sessionStorage の pcr を先に書き換えると「一致」扱いになり、
        // バナー（shop-only / catalogGeneration 不変）が stale cache のまま残る。
        var cachedPcr = cachedBundle.pricingCacheRevision != null
            ? String(cachedBundle.pricingCacheRevision)
            : null;
        var remotePcr = meta.pricingCacheRevision != null ? String(meta.pricingCacheRevision) : '0';
        if (!cachedPcr || cachedPcr !== remotePcr) {
            return false;
        }
        if (meta.catalogGeneration != null && cachedBundle.catalogGeneration != null) {
            if (Number(meta.catalogGeneration) !== Number(cachedBundle.catalogGeneration)) {
                return false;
            }
        }
        if (options && options.ignoreInventory) {
            return true;
        }
        var remoteInv = meta.inventoryUpdatedAt != null ? String(meta.inventoryUpdatedAt) : '';
        var cachedInv = cachedBundle.inventoryUpdatedAt != null
            ? String(cachedBundle.inventoryUpdatedAt)
            : '';
        if (remoteInv && cachedInv && remoteInv !== cachedInv) {
            return false;
        }
        if (remoteInv && !cachedInv) {
            return false;
        }
        return true;
    }

    function readGuestSessionJsonCache(storageKey, ttlMs) {
        if (typeof sessionStorage === 'undefined') {
            return null;
        }
        try {
            var raw = sessionStorage.getItem(storageKey);
            if (!raw) {
                return null;
            }
            var parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || !parsed.savedAt) {
                return null;
            }
            if (ttlMs != null && ttlMs > 0 && Date.now() - Number(parsed.savedAt) > ttlMs) {
                sessionStorage.removeItem(storageKey);
                return null;
            }
            return parsed;
        } catch (_ignored) {
            return null;
        }
    }

    function writeGuestSessionJsonCache(storageKey, payload) {
        if (typeof sessionStorage === 'undefined') {
            return;
        }
        try {
            sessionStorage.setItem(storageKey, JSON.stringify({
                savedAt: Date.now(),
                payload: payload
            }));
        } catch (_ignored) { /* quota */ }
    }

    function invalidateGuestOrderBundleCache(shopId) {
        if (typeof sessionStorage === 'undefined' || shopId == null || shopId === '') {
            return;
        }
        clearGuestPricingCacheRevision(shopId);
        var shopKey = String(shopId) + ':';
        var prefixes = [
            GUEST_ORDER_BUNDLE_CACHE_PREFIX + shopKey,
            GUEST_ORDER_BUNDLE_CACHE_PREFIX_LEGACY + shopKey
        ];
        var keysToRemove = [];
        for (var i = 0; i < sessionStorage.length; i++) {
            var key = sessionStorage.key(i);
            if (!key) {
                continue;
            }
            for (var p = 0; p < prefixes.length; p++) {
                if (key.indexOf(prefixes[p]) === 0) {
                    keysToRemove.push(key);
                    break;
                }
            }
        }
        keysToRemove.forEach(function (key) {
            sessionStorage.removeItem(key);
        });
    }

    /** sessionStorage bundle + pricing revision probe + optional IDB menu cache */
    function invalidateGuestMenuDeviceCaches(shopId) {
        if (shopId == null || shopId === '') {
            return;
        }
        invalidateGuestOrderBundleCache(shopId);
        var offline = typeof global !== 'undefined' ? global.MasterOrderOffline : null;
        if (offline && typeof offline.clearMenuCache === 'function') {
            void Promise.resolve(offline.clearMenuCache(shopId)).catch(function () { /* ignore IDB */ });
        }
    }

    function writeGuestOrderBundleSessionCache(cacheKey, payload) {
        if (!guestCachedBundleHasMenus(payload)) {
            return;
        }
        // Worker と同様: 端末キャッシュには sold-out を焼かない（inventoryUpdatedAt のみ保持）
        writeGuestSessionJsonCache(cacheKey, stripInventoryFlagsForGuestBundleCache(payload));
    }

    function stripInventoryFlagsForGuestBundleCache(bundle) {
        if (!bundle || typeof bundle !== 'object') {
            return bundle;
        }
        var menus = Array.isArray(bundle.menus)
            ? bundle.menus.map(function (menu) {
                if (!menu || typeof menu !== 'object') {
                    return menu;
                }
                var copy = Object.assign({}, menu);
                delete copy.stockQuantity;
                copy.soldOut = false;
                copy.stockStatusLabel = '在庫あり';
                return copy;
            })
            : [];
        return Object.assign({}, bundle, {
            menus: menus,
            // inventoryUpdatedAt はプローブ比較用に残す
            inventoryUpdatedAt: bundle.inventoryUpdatedAt != null
                ? String(bundle.inventoryUpdatedAt)
                : null
        });
    }

    /**
     * セッション未接続（閲覧のみ）向け: 在庫 overlay を完全に外す。
     * KV カタログの isAvailable はそのまま残す。
     */
    function stripGuestInventoryForBrowse(bundle) {
        if (!bundle || typeof bundle !== 'object') {
            return bundle;
        }
        var stripped = stripInventoryFlagsForGuestBundleCache(bundle);
        return Object.assign({}, stripped, {
            inventoryUpdatedAt: null
        });
    }

    function filterGuestMenusHideSoldOut(menus, hideSoldOut) {
        var list = Array.isArray(menus) ? menus : [];
        if (!hideSoldOut) {
            return list;
        }
        return list.filter(function (menu) {
            return !isGuestMenuSoldOut(menu);
        });
    }

    function readGuestOrderBundleEtag(shopId, lang) {
        if (typeof sessionStorage === 'undefined' || shopId == null || shopId === '') {
            return null;
        }
        try {
            var raw = sessionStorage.getItem(
                GUEST_ORDER_BUNDLE_ETAG_PREFIX + String(shopId) + ':' + String(lang || 'ja')
            );
            return raw && String(raw).trim() ? String(raw).trim() : null;
        } catch (_ignored) {
            return null;
        }
    }

    function writeGuestOrderBundleEtag(shopId, lang, etag) {
        if (typeof sessionStorage === 'undefined' || shopId == null || shopId === '' || !etag) {
            return;
        }
        try {
            sessionStorage.setItem(
                GUEST_ORDER_BUNDLE_ETAG_PREFIX + String(shopId) + ':' + String(lang || 'ja'),
                String(etag).trim()
            );
        } catch (_ignored) { /* quota */ }
    }

    function readGuestOrderHistoryCache(sessionId) {
        if (!sessionId) {
            return null;
        }
        var cached = readGuestSessionJsonCache(
            GUEST_ORDER_HISTORY_CACHE_PREFIX + String(sessionId),
            GUEST_ORDER_HISTORY_CACHE_TTL_MS
        );
        if (!cached || !Array.isArray(cached.history)) {
            return null;
        }
        return cached.history;
    }

    function writeGuestOrderHistoryCache(sessionId, history) {
        if (!sessionId || !Array.isArray(history)) {
            return;
        }
        writeGuestSessionJsonCache(GUEST_ORDER_HISTORY_CACHE_PREFIX + String(sessionId), {
            history: history,
            fetchedAt: Date.now()
        });
    }

    function invalidateGuestOrderHistoryCache(sessionId) {
        if (typeof sessionStorage === 'undefined' || !sessionId) {
            return;
        }
        try {
            sessionStorage.removeItem(GUEST_ORDER_HISTORY_CACHE_PREFIX + String(sessionId));
        } catch (_ignored) { /* quota */ }
    }

    /** Gate catalog read は path/query に UUID shopPublicId のみ受け付ける。 */
    function resolveShopPublicIdForGateCatalog(shopId) {
        // 外部は UUID のみ。int / shop-{int} からの昇格は廃止（列挙防止）。
        return Promise.resolve(normalizeShopPublicId(shopId));
    }

    function requireGateCatalogShopId(shopId) {
        return resolveShopPublicIdForGateCatalog(shopId).then(function (resolved) {
            if (!resolved) {
                throw new Error('shopPublicId is required for Gate catalog read');
            }
            return resolved;
        });
    }

    function fetchPublicShop(shopSlug, apiBase, options) {
        assertGateCatalogRead();
        var slug = displayPathSlug(shopSlug) || String(shopSlug || '').trim();
        if (!slug) {
            return Promise.resolve(null);
        }
        var allowVpsFallback = !!(options && options.allowVpsFallback === true);
        var cacheKey = GUEST_PUBLIC_SHOP_CACHE_PREFIX + slug;
        var cached = readGuestSessionJsonCache(cacheKey);
        var gateHttp = core.createHttpClient({ baseUrl: inferGuestCatalogReadBase() });
        var serverBase = (apiBase || inferGuestApiBase()).replace(/\/$/, '');
        var serverHttp = core.createHttpClient({ baseUrl: serverBase });

        function fetchPublicShopFromServer() {
            if (!allowVpsFallback) {
                return Promise.resolve(null);
            }
            return serverHttp.get(guestPaths.shopBySlug(slug)).then(function (shop) {
                if (shop && shop.shopId) {
                    writeGuestSessionJsonCache(cacheKey, shop);
                }
                return shop;
            }).catch(function (err) {
                if (err && err.status === 404) {
                    return null;
                }
                if (err && err instanceof core.ApiError) {
                    throw err;
                }
                throw new Error('店舗情報の取得に失敗しました');
            });
        }

        function fetchPublicShopFromGate() {
            var publicShopPath = core.withQuery(gateGuestPaths.shopBySlug(slug), {
                rev: 'branding-v2'
            });
            var network = gateHttp.get(publicShopPath).then(function (shop) {
                if (shop && shop.shopId) {
                    writeGuestSessionJsonCache(cacheKey, shop);
                    return shop;
                }
                return fetchPublicShopFromServer();
            }).catch(function (err) {
                // same-origin Pages proxy 失敗時は Gate 直叩きへフォールバック
                var directGateBase = (typeof global._gatePublicBase === 'string'
                    && global._gatePublicBase.trim())
                    ? global._gatePublicBase.trim().replace(/\/$/, '')
                    : '';
                var catalogBase = inferGuestCatalogReadBase();
                if (directGateBase && catalogBase && directGateBase !== catalogBase) {
                    var directHttp = core.createHttpClient({ baseUrl: directGateBase });
                    return directHttp.get(publicShopPath).then(function (shop) {
                        if (shop && shop.shopId) {
                            writeGuestSessionJsonCache(cacheKey, shop);
                            return shop;
                        }
                        return fetchPublicShopFromServer();
                    }).catch(function () {
                        if (err && err.status === 404) {
                            return fetchPublicShopFromServer();
                        }
                        if (err && err instanceof core.ApiError) {
                            if (!allowVpsFallback) {
                                throw err;
                            }
                            return fetchPublicShopFromServer();
                        }
                        return fetchPublicShopFromServer().catch(function (fallbackErr) {
                            if (fallbackErr && fallbackErr instanceof core.ApiError) {
                                throw fallbackErr;
                            }
                            throw new Error('店舗情報の取得に失敗しました');
                        });
                    });
                }
                if (err && err.status === 404) {
                    return fetchPublicShopFromServer();
                }
                if (err && err instanceof core.ApiError) {
                    if (!allowVpsFallback) {
                        throw err;
                    }
                    return fetchPublicShopFromServer();
                }
                return fetchPublicShopFromServer().catch(function (fallbackErr) {
                    if (fallbackErr && fallbackErr instanceof core.ApiError) {
                        throw fallbackErr;
                    }
                    throw new Error('店舗情報の取得に失敗しました');
                });
            });
            return network.catch(function (err) {
                if (cached && cached.payload) {
                    return cached.payload;
                }
                throw err;
            });
        }

        function trackPublicShopInflight(network) {
            inflightGuestPublicShop[slug] = network;
            network.then(function () {}, function () {}).then(function () {
                if (inflightGuestPublicShop[slug] === network) {
                    delete inflightGuestPublicShop[slug];
                }
            });
            return network;
        }

        if (cached && cached.payload && cached.payload.shopId) {
            if (!inflightGuestPublicShop[slug]) {
                trackPublicShopInflight(fetchPublicShopFromGate());
            }
            return Promise.resolve(cached.payload);
        }
        if (inflightGuestPublicShop[slug]) {
            return inflightGuestPublicShop[slug];
        }
        return trackPublicShopInflight(fetchPublicShopFromGate());
    }

    function ensureGuestShopBannerStyles() {
        if (typeof document === 'undefined') {
            return;
        }
        if (document.getElementById('mo-shop-menu-banner-css')) {
            return;
        }
        var node = document.createElement('style');
        node.id = 'mo-shop-menu-banner-css';
        node.textContent = [
            '.mo-shop-menu-banner{position:relative;width:100%;margin:0 0 12px;line-height:0;overflow:hidden;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;}',
            '.mo-shop-menu-banner--bottom{margin:12px 0 24px;}',
            '.mo-shop-menu-banner::after{content:"";position:absolute;inset:0;z-index:1;}',
            '.mo-shop-menu-banner img{display:block;width:100%;height:min(240px,60vw);object-fit:contain;pointer-events:none;-webkit-user-drag:none;-webkit-touch-callout:none;user-select:none;-webkit-user-select:none;}'
        ].join('');
        document.head.appendChild(node);
    }

    /** 店舗 Banner をメニュー一覧の上下に描画（GuestShopPublic の配置フラグ） */
    function applyGuestShopBanner(shop) {
        if (typeof document === 'undefined') {
            return;
        }
        ensureGuestShopBannerStyles();
        document.querySelectorAll('.mo-shop-menu-banner').forEach(function (el) {
            el.remove();
        });
        var menuList = document.getElementById('menuList');
        if (!menuList || !menuList.parentNode) {
            return;
        }
        var url = shop && shop.bannerUrl;
        if (!url || !isSafeBrandingAssetUrl(url)) {
            return;
        }
        function openBannerTap(tapAction) {
            if (!tapAction || typeof tapAction !== 'object') {
                return;
            }
            var type = String(tapAction.type || '').toUpperCase();
            if (type === 'EXTERNAL' && tapAction.url) {
                window.open(String(tapAction.url), '_blank', 'noopener,noreferrer');
                return;
            }
            if (type === 'CATEGORY' && tapAction.categoryName) {
                var cat = String(tapAction.categoryName).trim();
                if (!cat) {
                    return;
                }
                try {
                    if (typeof window.MasterOrderSdk === 'object'
                        && typeof window.dispatchEvent === 'function') {
                        window.dispatchEvent(new CustomEvent('mo-guest-select-category', {
                            detail: { categoryName: cat }
                        }));
                    }
                } catch (_e) { /* ignore */ }
                var chips = document.getElementById('categoryChips');
                if (chips) {
                    var btn = chips.querySelector('.chip[data-category="' + CSS.escape(cat) + '"]');
                    if (btn) {
                        btn.click();
                    }
                }
            }
        }
        function makeBanner(position) {
            var wrap = document.createElement('div');
            wrap.className = 'mo-shop-menu-banner mo-shop-menu-banner--' + position;
            var img = document.createElement('img');
            img.src = url;
            img.alt = (shop && shop.shopName) ? String(shop.shopName) : '';
            img.loading = 'lazy';
            img.draggable = false;
            img.setAttribute('draggable', 'false');
            wrap.appendChild(img);
            var tap = shop && shop.bannerTapAction;
            if (tap && (tap.type === 'EXTERNAL' || tap.type === 'CATEGORY')) {
                wrap.style.cursor = 'pointer';
                wrap.setAttribute('role', 'link');
                wrap.tabIndex = 0;
                wrap.addEventListener('click', function () { openBannerTap(tap); });
                wrap.addEventListener('keydown', function (ev) {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        openBannerTap(tap);
                    }
                });
            }
            return wrap;
        }
        if (shop.bannerOnMenuTop) {
            menuList.parentNode.insertBefore(makeBanner('top'), menuList);
        }
        if (shop.bannerOnMenuBottom) {
            menuList.parentNode.insertBefore(makeBanner('bottom'), menuList.nextSibling);
        }
    }

    function applyGuestBranding(shop) {
        applyGuestShopBanner(shop);
        if (!shop || !shop.customBrandingEnabled || typeof document === 'undefined') {
            return;
        }
        if (shop.logoUrl && isSafeBrandingAssetUrl(shop.logoUrl)) {
            document.querySelectorAll('.shop-name, #headerShopName').forEach(function (el) {
                if (!el) {
                    return;
                }
                el.style.backgroundImage = 'url(' + JSON.stringify(shop.logoUrl) + ')';
                el.style.backgroundSize = 'contain';
                el.style.backgroundRepeat = 'no-repeat';
                el.style.backgroundPosition = 'center';
                el.style.minHeight = '32px';
                el.style.color = 'transparent';
            });
        }
        var safeCss = sanitizeCustomCss(shop.customCss);
        if (safeCss) {
            var node = document.getElementById('mo-custom-branding-css');
            if (!node) {
                node = document.createElement('style');
                node.id = 'mo-custom-branding-css';
                document.head.appendChild(node);
            }
            node.textContent = safeCss;
        }
    }

    var guestUrlApi = {
        slugifyShopName: slugifyAscii,
        displayPathSlug: displayPathSlug,
        resolveConnectSlug: resolveConnectSlug,
        parseRoute: parseGuestRoute,
        connectShopPath: connectShopPath,
        connectPathSlug: connectPathSlug,
        connectSlugsMatch: connectSlugsMatch,
        guestCredentialsQuery: guestCredentialsQuery,
        templateEntryPathForShop: templateEntryPathForShop,
        navigateToTemplateIfNeeded: navigateToTemplateIfNeeded,
        stripLegacyMoQueryParams: stripLegacyMoQueryParams,
        buildConnectShopUrl: buildConnectShopUrl,
        buildMenuEntryUrl: function (detail) {
            return buildConnectShopUrl(detail, detail && detail.sessionId, detail && detail.pin);
        },
        inferApiBase: inferGuestApiBase,
        inferOrderPublicBase: inferGuestOrderPublicBase,
        fetchPublicShop: fetchPublicShop,
        applyBranding: applyGuestBranding
    };

    function formatOrderTime(value, options) {
        return core.formatDateTime(value, Object.assign({}, options, { style: 'time' }));
    }

    function resolveOrderHistoryMenuId(item) {
        if (!item || typeof item !== 'object') {
            return null;
        }
        // Guest cart / REST は public UUID。Firestore itemsJson は integer menuId と menuPublicId の両方を持つ。
        // 楽観的ローカル履歴とサーバー行を突き合わせるため public id を優先する。
        if (item.menuPublicId != null && item.menuPublicId !== '') {
            return String(item.menuPublicId);
        }
        if (item.menuId != null && item.menuId !== '') {
            return String(item.menuId);
        }
        return null;
    }

    function resolveOrderHistoryMenuName(item) {
        if (!item || typeof item !== 'object') {
            return null;
        }
        if (item.menuName != null && String(item.menuName).trim()) {
            return String(item.menuName);
        }
        if (item.menuNameSnapshot != null && String(item.menuNameSnapshot).trim()) {
            return String(item.menuNameSnapshot);
        }
        return null;
    }

    function normalizeOrderHistoryToppings(item) {
        var raw = null;
        if (item && Array.isArray(item.toppings) && item.toppings.length) {
            raw = item.toppings;
        } else if (item && Array.isArray(item.selectedToppingSnapshots) && item.selectedToppingSnapshots.length) {
            raw = item.selectedToppingSnapshots;
        } else if (item && Array.isArray(item.selectedToppings) && item.selectedToppings.length) {
            raw = item.selectedToppings;
        } else if (item && Array.isArray(item.toppingNames) && item.toppingNames.length) {
            // カート送信直後のローカル履歴（名前のみ）
            raw = item.toppingNames;
        }
        if (!raw) {
            return [];
        }
        return raw.map(function (top) {
            if (!top) {
                return null;
            }
            if (typeof top === 'string') {
                var nameOnly = top.trim();
                return nameOnly ? { name: nameOnly, price: 0 } : null;
            }
            var name = top.name != null ? String(top.name).trim()
                : (top.toppingName != null ? String(top.toppingName).trim() : '');
            if (!name) {
                return null;
            }
            return {
                name: name,
                price: top.price != null ? Number(top.price) : 0
            };
        }).filter(Boolean);
    }

    function normalizeOrderHistoryItem(item) {
        if (!item) {
            return null;
        }
        var quantity = item.quantity != null ? Number(item.quantity) : 0;
        var cancelledQuantity = item.cancelledQuantity != null
            ? Number(item.cancelledQuantity)
            : (item.resolvedCancelledQuantity != null ? Number(item.resolvedCancelledQuantity) : 0);
        if (!Number.isFinite(cancelledQuantity) || cancelledQuantity < 0) {
            cancelledQuantity = 0;
        }
        return {
            menuId: resolveOrderHistoryMenuId(item),
            menuName: resolveOrderHistoryMenuName(item),
            quantity: quantity,
            cancelledQuantity: cancelledQuantity,
            activeQuantity: Math.max(0, quantity - cancelledQuantity),
            fullyCancelled: quantity > 0 && cancelledQuantity >= quantity,
            unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
            priceAtOrder: item.priceAtOrder != null ? Number(item.priceAtOrder) : null,
            subTotal: item.subTotal != null ? Number(item.subTotal) : null,
            toppingPrice: item.toppingPrice != null ? Number(item.toppingPrice) : 0,
            basePrice: item.basePrice != null ? Number(item.basePrice) : null,
            toppings: normalizeOrderHistoryToppings(item),
            taxCategory: item.taxCategoryAtOrder || item.taxCategory || null,
            customTaxRatePercent: item.customTaxRatePercentAtOrder != null
                ? Number(item.customTaxRatePercentAtOrder)
                : (item.customTaxRatePercent != null ? Number(item.customTaxRatePercent) : null)
        };
    }

    function resolveOrderHistoryDisplayTotal(order, sessionType) {
        var tax = global.MasterOrderConsumptionTax;
        var session = sessionType;
        var items = order && Array.isArray(order.items) ? order.items : [];
        if (items.length) {
            var fromUnitPrice = items.reduce(function (sum, item) {
                if (!item) {
                    return sum;
                }
                var qty = item.activeQuantity != null
                    ? Number(item.activeQuantity)
                    : Math.max(0, Number(item.quantity || 0) - Number(item.cancelledQuantity || 0));
                if (qty <= 0) {
                    return sum;
                }
                var unit = Number(item.unitPrice || item.priceAtOrder || 0)
                    + Number(item.toppingPrice || 0);
                if (unit > 0) {
                    return sum + unit * qty;
                }
                return sum;
            }, 0);
            if (fromUnitPrice > 0) {
                return fromUnitPrice;
            }
            if (tax && typeof tax.calculateCartGrandTotal === 'function') {
                var activeItems = items.map(function (item) {
                    if (!item) {
                        return null;
                    }
                    var qty = item.activeQuantity != null
                        ? Number(item.activeQuantity)
                        : Math.max(0, Number(item.quantity || 0) - Number(item.cancelledQuantity || 0));
                    if (qty <= 0) {
                        return null;
                    }
                    return Object.assign({}, item, { quantity: qty });
                }).filter(Boolean);
                if (activeItems.length) {
                    return tax.calculateCartGrandTotal(activeItems, session);
                }
                return 0;
            }
        }
        var baseTotal = Number(order && (order.total != null ? order.total : order.totalPrice) || 0);
        if (baseTotal > 0 && tax && typeof tax.calculateOrderTotals === 'function' && items.length) {
            var taxLines = items.map(function (item) {
                if (!item) {
                    return null;
                }
                var qty = item.activeQuantity != null
                    ? Number(item.activeQuantity)
                    : Math.max(0, Number(item.quantity || 0) - Number(item.cancelledQuantity || 0));
                if (qty <= 0) {
                    return null;
                }
                var lineBase = Number(item.subTotal || 0);
                var orderedQty = Number(item.quantity || 0);
                if (lineBase > 0 && orderedQty > 0 && qty !== orderedQty) {
                    lineBase = lineBase * qty / orderedQty;
                }
                if (lineBase <= 0) {
                    var unitBase = Number(item.basePrice || 0);
                    if (unitBase > 0) {
                        lineBase = unitBase * qty;
                    }
                }
                if (lineBase <= 0) {
                    return null;
                }
                return {
                    basePrice: lineBase / qty,
                    taxCategory: item.taxCategory || (tax.TaxCategory && tax.TaxCategory.STANDARD) || 'STANDARD',
                    customTaxRatePercent: item.customTaxRatePercent,
                    quantity: qty
                };
            }).filter(function (line) { return !!line; });
            if (taxLines.length) {
                return tax.calculateOrderTotals(taxLines, session).grandTotal;
            }
            return 0;
        }
        return baseTotal;
    }

    function resolveGuestMenuDisplayName(menuId, menus, fallbackName) {
        var unknown = '不明';
        if (global.MasterOrderGuestUiI18n && typeof global.MasterOrderGuestUiI18n.t === 'function') {
            unknown = global.MasterOrderGuestUiI18n.t('unknownMenu', getGuestMenuLang());
        }
        if (menuId != null && Array.isArray(menus)) {
            var id = String(menuId);
            for (var i = 0; i < menus.length; i += 1) {
                var menu = menus[i];
                if (!menu) {
                    continue;
                }
                var matchesId = menu.id != null && String(menu.id) === id;
                var matchesPublicId = menu.publicId != null && String(menu.publicId) === id;
                if ((matchesId || matchesPublicId) && menu.name) {
                    return String(menu.name);
                }
            }
        }
        if (fallbackName) {
            return String(fallbackName);
        }
        return unknown;
    }

    function formatHistoryQtyChange(fromQty, toQty, lang) {
        var from = Number(fromQty);
        var to = Number(toQty);
        if (!Number.isFinite(from) || !Number.isFinite(to)) {
            return '';
        }
        var ui = global.MasterOrderGuestUiI18n;
        if (ui && typeof ui.format === 'function') {
            return ui.format('historyQtyChange', lang || getGuestMenuLang(), {
                from: from,
                to: to
            });
        }
        return from + '個→' + to + '個';
    }

    function formatOrderHistoryLines(order, menus, options) {
        options = options || {};
        var lineSeparator = options.lineSeparator || DEFAULT_LINE_SEPARATOR;
        var lang = options.lang || getGuestMenuLang();
        var cancelledLabel = options.cancelledLabel || '注文がキャンセルされました';
        var partialLabel = options.partiallyCancelledLabel || '一部キャンセル';
        var items = order && Array.isArray(order.items) ? order.items : [];
        if (items.length) {
            return items.map(function (item) {
                var normalized = normalizeOrderHistoryItem(item);
                if (!normalized) {
                    return '';
                }
                var name = resolveGuestMenuDisplayName(normalized.menuId, menus, normalized.menuName);
                var text = name + lineSeparator + normalized.quantity;
                if (normalized.fullyCancelled) {
                    text += '（' + cancelledLabel + '）';
                } else if (normalized.cancelledQuantity > 0) {
                    var qtyChange = formatHistoryQtyChange(
                        normalized.quantity,
                        normalized.activeQuantity,
                        lang
                    );
                    text = name + lineSeparator + normalized.activeQuantity
                        + ' / ' + normalized.quantity
                        + '（' + partialLabel + '）'
                        + (qtyChange ? '　' + qtyChange : '');
                }
                return text;
            }).filter(function (line) { return !!line; });
        }
        if (order && Array.isArray(order.lines) && order.lines.length) {
            return order.lines.map(function (line) {
                if (line && typeof line === 'object' && line.text != null) {
                    return String(line.text);
                }
                return String(line || '');
            }).filter(function (line) { return !!line; });
        }
        return [];
    }

    function mapOrderHistory(sessionOrHistory, options) {
        options = options || {};
        const lineSeparator = options.lineSeparator || DEFAULT_LINE_SEPARATOR;
        const timeZone = options.timeZone || core.DEFAULT_TIME_ZONE;
        const history = Array.isArray(sessionOrHistory)
            ? sessionOrHistory
            : (Array.isArray(sessionOrHistory && sessionOrHistory.orderHistory)
                ? sessionOrHistory.orderHistory
                : []);

        return history.map(function (order) {
            const rawItems = Array.isArray(order.items) ? order.items : [];
            const items = rawItems.map(normalizeOrderHistoryItem).filter(function (item) { return !!item; });
            const mapped = {
                orderId: order.orderId != null ? order.orderId : null,
                timestamp: formatOrderTime(order.orderTime, { timeZone: timeZone }),
                total: resolveOrderHistoryDisplayTotal({
                    items: rawItems,
                    totalPrice: order.totalPrice
                }, options.sessionType),
                status: order.status != null ? String(order.status) : '',
                items: items
            };
            mapped.lines = formatOrderHistoryLines(mapped, options.menus || null, {
                lineSeparator: lineSeparator,
                lang: options.lang
            });
            return mapped;
        });
    }

    function resolveSessionBillSplit(input) {
        var source = input || {};
        var peoples = Math.round(Number(source.peoples || 0));
        if (!Number.isFinite(peoples) || peoples < 0) {
            peoples = 0;
        }
        var total = Math.round(Number(source.totalAmount || 0));
        if (!Number.isFinite(total) || total < 0) {
            total = 0;
        }
        if (!(total > 0) && Array.isArray(source.orderHistory)) {
            total = source.orderHistory.reduce(function (sum, order) {
                if (!order) {
                    return sum;
                }
                if (String(order.status || '').toUpperCase() === 'CANCELLED') {
                    return sum;
                }
                var lineTotal = Number(order.total != null ? order.total : order.totalPrice);
                if (!Number.isFinite(lineTotal) || lineTotal < 0) {
                    return sum;
                }
                return sum + Math.round(lineTotal);
            }, 0);
        }
        var perPerson = peoples >= 1 ? Math.ceil(total / peoples) : 0;
        return {
            total: total,
            peoples: peoples,
            perPerson: perPerson
        };
    }

    function formatYenAmount(amount) {
        var n = Math.round(Number(amount) || 0);
        if (!Number.isFinite(n)) {
            n = 0;
        }
        return '¥' + n.toLocaleString('ja-JP');
    }

    function formatSessionBillSplitMessage(split, translate) {
        var info = split || { total: 0, peoples: 0, perPerson: 0 };
        var t = typeof translate === 'function' ? translate : function (key) { return key; };
        var requested = t('checkoutRequested');
        var totalLabel = formatYenAmount(info.total);
        var splitLine;
        if (info.peoples >= 1) {
            splitLine = t('checkoutSplit', {
                total: totalLabel,
                people: String(info.peoples),
                perPerson: formatYenAmount(info.perPerson)
            });
        } else {
            splitLine = t('checkoutSplitNoPeople', { total: totalLabel });
        }
        return requested + '\n' + splitLine;
    }

    function parseSessionConnect(session, sessionId, pin) {
        const raw = session || {};
        const normalizedPin = String(pin || raw.entryPin || '').trim().toUpperCase();
        const resolvedSessionId = raw.sessionId || raw.id || sessionId || '';
        const orderHistory = mapOrderHistory(raw);
        if (resolvedSessionId && raw.overlayToken) {
            writeGuestOverlayToken(resolvedSessionId, raw.overlayToken);
        }

        return {
            raw: raw,
            sessionId: resolvedSessionId,
            pin: normalizedPin,
            shopId: raw.shopId != null ? raw.shopId : null,
            shopName: raw.shopName || (raw.shop && raw.shop.name) || '',
            shopSlug: raw.shopSlug || '',
            tableNumber: Number(raw.tableNumber || 0),
            peoples: Number(raw.peoples || 0),
            peoplesConfirmed: raw.peoplesConfirmed !== false,
            templateKey: raw.templateKey || 'Komorebi_Premium',
            templateEntryPath: raw.templateEntryPath || '/guest-shop/',
            orderPageLogoUrl: raw.orderPageLogoUrl || null,
            orderPageCustomCss: raw.orderPageCustomCss || null,
            customBrandingEnabled: raw.customBrandingEnabled === true,
            totalAmount: Number(raw.totalAmount || 0),
            orderHistory: orderHistory,
            rawOrderHistory: Array.isArray(raw.orderHistory) ? raw.orderHistory : [],
            firebaseCustomToken: raw.firebaseCustomToken || null,
            myGuestAlias: raw.myGuestAlias || null,
            staffRequestType: raw.staffRequestType || null,
            staffRequestAt: raw.staffRequestAt || null,
            overlayToken: raw.overlayToken || null
        };
    }

    function isPendingLocalOrderHistoryEntry(entry) {
        return !!(entry && entry.orderId == null);
    }

    function guestOrderHistoryEntrySignature(entry) {
        if (!entry || typeof entry !== 'object') {
            return '';
        }
        if (Array.isArray(entry.items) && entry.items.length) {
            return canonicalGuestOrderItemsSignature(entry.items);
        }
        return String(entry.total != null ? entry.total : (entry.totalPrice != null ? entry.totalPrice : 0))
            + '|' + String(entry.timestamp || '');
    }

    /**
     * menuId 形式差（UUID vs 内部 int）でも突き合わせられるよう、名前ベースの署名を返す。
     */
    function guestOrderHistoryContentSignature(entry) {
        if (!entry || typeof entry !== 'object') {
            return '';
        }
        var items = Array.isArray(entry.items) ? entry.items.slice() : [];
        if (!items.length) {
            return '';
        }
        var lines = items.map(function (item) {
            if (!item) {
                return '';
            }
            var name = resolveOrderHistoryMenuName(item) || '';
            var qty = String(item.quantity || 0);
            var tops = normalizeOrderHistoryToppings(item).map(function (top) {
                return top && top.name ? String(top.name) : '';
            }).filter(Boolean).sort();
            return name + ':' + qty + ':' + tops.join(',');
        }).filter(Boolean).sort();
        if (!lines.length) {
            return '';
        }
        var total = entry.total != null ? entry.total
            : (entry.totalPrice != null ? entry.totalPrice : '');
        return lines.join('\n') + '|' + String(total);
    }

    function guestOrderHistoryEntriesLikelySame(a, b) {
        if (!a || !b) {
            return false;
        }
        if (a.orderId != null && b.orderId != null) {
            return String(a.orderId) === String(b.orderId);
        }
        if (a.localId && b.localId && String(a.localId) === String(b.localId)) {
            return true;
        }
        var sigA = guestOrderHistoryEntrySignature(a);
        var sigB = guestOrderHistoryEntrySignature(b);
        if (sigA && sigB && sigA === sigB) {
            return true;
        }
        // Firestore itemsJson の integer menuId とカート UUID が食い違う場合のフォールバック
        var contentA = guestOrderHistoryContentSignature(a);
        var contentB = guestOrderHistoryContentSignature(b);
        return !!(contentA && contentB && contentA === contentB);
    }

    /**
     * 注文直後のローカル履歴を、resync / Firestore 更新で消さないようマージする。
     * orderId 未設定の送信中エントリは、サーバー側に同一注文が現れるまで保持する。
     */
    function mergeOrderHistoryWithPending(current, incoming) {
        var server = Array.isArray(incoming) ? incoming.slice() : [];
        var prev = Array.isArray(current) ? current : [];
        if (!prev.length) {
            return server;
        }
        if (!server.length) {
            return prev;
        }
        var pending = prev.filter(isPendingLocalOrderHistoryEntry);
        if (!pending.length) {
            return server;
        }
        var usedServer = Object.create(null);
        var unmatchedPending = pending.filter(function (p) {
            for (var i = 0; i < server.length; i++) {
                if (usedServer[i]) {
                    continue;
                }
                if (guestOrderHistoryEntriesLikelySame(p, server[i])) {
                    usedServer[i] = true;
                    return false;
                }
            }
            return true;
        });
        return server.concat(unmatchedPending);
    }

    function createLocalOrderHistoryEntry(cartItems, options) {
        options = options || {};
        const lineSeparator = options.lineSeparator || DEFAULT_LINE_SEPARATOR;
        const timeZone = options.timeZone || core.DEFAULT_TIME_ZONE;
        const items = Array.isArray(cartItems) ? cartItems : [];

        const normalizedItems = items.map(normalizeOrderHistoryItem).filter(function (item) { return !!item; });

        const tax = global.MasterOrderConsumptionTax;
        const total = tax && typeof tax.calculateCartGrandTotal === 'function'
            ? tax.calculateCartGrandTotal(items, options.sessionType)
            : resolveOrderHistoryDisplayTotal({ items: items }, options.sessionType);

        const entry = {
            orderId: null,
            localId: options.localId || null,
            timestamp: formatOrderTime(new Date(), { timeZone: timeZone }),
            total: total,
            sendStatus: options.sendStatus || ORDER_SEND_STATUS.COMPLETED,
            errorMessage: options.errorMessage || '',
            status: 'LOCAL',
            items: normalizedItems
        };
        entry.lines = formatOrderHistoryLines(entry, options.menus || null, {
            lineSeparator: lineSeparator,
            lang: options.lang
        });
        return entry;
    }

    function formatOrderSendStatusLabel(sendStatus) {
        if (sendStatus === ORDER_SEND_STATUS.SENDING) {
            return '送信中';
        }
        if (sendStatus === ORDER_SEND_STATUS.FAILED) {
            return '送信失敗';
        }
        return '送信完了';
    }

    function isOrderablePublicTopping(topping) {
        if (!topping || topping.deleted) {
            return false;
        }
        if (topping.available === false) {
            return false;
        }
        return topping.id != null;
    }

    function normalizeToppingIdRef(id) {
        if (id == null || id === '') {
            return '';
        }
        return String(id).trim();
    }

    function countSelectedInGroup(toppingIds, group) {
        const toppings = Array.isArray(group.toppings) ? group.toppings : [];
        const orderableIds = toppings.filter(isOrderablePublicTopping).map(function (t) {
            return normalizeToppingIdRef(t.id);
        });
        if (!toppingIds || !toppingIds.length || !orderableIds.length) {
            return 0;
        }
        return toppingIds.filter(function (id) {
            const ref = normalizeToppingIdRef(id);
            return ref && orderableIds.indexOf(ref) >= 0;
        }).length;
    }

    /**
     * カート各行のトッピング必須・min/max をサーバー定義と照合する。
     * @param {Array} cartItems cart line objects with menuId, toppingIds
     * @param {function(number): Promise<Array>} fetchGroupsForMenu
     * @returns {Promise<{valid: boolean, message: string}>}
     */
    function validateCartToppingSelections(cartItems, fetchGroupsForMenu) {
        const cart = Array.isArray(cartItems) ? cartItems : [];
        if (!cart.length) {
            return Promise.resolve({ valid: true, message: '' });
        }
        if (typeof fetchGroupsForMenu !== 'function') {
            return Promise.resolve({ valid: false, message: 'トッピング検証を実行できません' });
        }

        const groupsByMenuId = {};
        const menuIds = [];
        cart.forEach(function (item) {
            if (!item || item.menuId == null || item.menuId === '') {
                return;
            }
            const id = String(item.menuId);
            if (menuIds.indexOf(id) < 0) {
                menuIds.push(id);
            }
        });

        function loadGroups(menuId) {
            if (groupsByMenuId[menuId] != null) {
                return Promise.resolve(groupsByMenuId[menuId]);
            }
            return Promise.resolve(fetchGroupsForMenu(menuId)).then(function (groups) {
                const normalized = Array.isArray(groups) ? groups : [];
                groupsByMenuId[menuId] = normalized;
                return normalized;
            });
        }

        return Promise.all(menuIds.map(function (menuId) {
            return loadGroups(menuId);
        })).then(function () {
            for (var i = 0; i < menuIds.length; i += 1) {
                var groups = groupsByMenuId[menuIds[i]] || [];
                var lines = cart.filter(function (item) {
                    return item && String(item.menuId) === String(menuIds[i]);
                });
                for (var lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
                    var line = lines[lineIndex];
                    var toppingIds = Array.isArray(line.toppingIds) ? line.toppingIds : [];
                    // プラットフォーム絶対上限（カタログ理論上限 5×10 と一致）。最終防衛はサーバ。
                    if (toppingIds.length > 50) {
                        return {
                            valid: false,
                            message: 'トッピングの選択数が上限（50件）を超えています'
                        };
                    }
                    for (var g = 0; g < groups.length; g += 1) {
                        var group = groups[g];
                        if (!group) {
                            continue;
                        }
                        var minSelect = Number(group.minSelect || 0);
                        var maxSelect = Number(group.maxSelect || 0);
                        var effectiveMax = maxSelect > 0 ? maxSelect : Math.max(minSelect, 99);
                        var groupName = group.groupName || 'トッピング';
                        var orderableCount = (Array.isArray(group.toppings) ? group.toppings : [])
                            .filter(isOrderablePublicTopping).length;
                        var selected = countSelectedInGroup(toppingIds, group);

                        if (orderableCount === 0 && minSelect > 0) {
                            return {
                                valid: false,
                                message: '「' + groupName + '」の選択が必要ですが、現在選択できる項目がありません'
                            };
                        }
                        if (selected < minSelect) {
                            return {
                                valid: false,
                                message: '「' + groupName + '」は ' + minSelect + '〜' + effectiveMax + ' 個選択してください'
                            };
                        }
                        if (selected > effectiveMax) {
                            return {
                                valid: false,
                                message: '「' + groupName + '」は最大' + effectiveMax + '個まで選択できます'
                            };
                        }
                    }
                }
            }
            return { valid: true, message: '' };
        });
    }

    function normalizeJoinPin(pin) {
        return String(pin || '').trim().toUpperCase();
    }

    function parseJoinCredentialsFromSearch(search) {
        const params = new URLSearchParams(search || '');
        var rawId = params.get(JOIN_SESSION_PARAM) || params.get('id') || '';
        var rawPin = params.get(JOIN_PIN_PARAM) || params.get('pass') || '';
        if (!rawPin && rawId) {
            var malformed = String(rawId).match(
                /^([ABEFGHJKMNPQRTUVWXYZabefghjkmnpqrtuvwxyz]{10})pass=([A-Za-z0-9]+)$/i
            );
            if (malformed) {
                rawId = malformed[1];
                rawPin = malformed[2];
            }
        }
        const sessionId = sanitizeGuestSessionId(rawId);
        const pin = sanitizeGuestJoinPin(rawPin);
        if (!sessionId || !pin) {
            return { sessionId: '', pin: '' };
        }
        return { sessionId: sessionId, pin: pin };
    }

    function parseJoinTokenFromLocation(loc) {
        loc = loc || (typeof location !== 'undefined' ? location : null);
        if (!loc) {
            return '';
        }

        const hash = (loc.hash || '').replace(/^#/, '');
        if (hash) {
            const hashParams = new URLSearchParams(hash.charAt(0) === '?' ? hash : '?' + hash);
            const fromHash = (hashParams.get(JOIN_TOKEN_PARAM) || '').trim();
            if (fromHash) {
                return fromHash;
            }
        }

        const searchParams = new URLSearchParams(loc.search || '');
        return (searchParams.get(JOIN_TOKEN_PARAM) || '').trim();
    }

    function parseJoinCredentialsFromLocation(loc) {
        loc = loc || (typeof location !== 'undefined' ? location : null);
        if (!loc) {
            return { sessionId: '', pin: '' };
        }

        var fromSearch = parseJoinCredentialsFromSearch(loc.search);
        if (fromSearch.sessionId && fromSearch.pin) {
            stashJoinCredentialsForRoute(fromSearch.sessionId, fromSearch.pin);
            return fromSearch;
        }

        const hash = (loc.hash || '').replace(/^#/, '');
        if (hash) {
            const fromHash = parseJoinCredentialsFromSearch(
                hash.charAt(0) === '?' ? hash : '?' + hash
            );
            if (fromHash.sessionId && fromHash.pin) {
                stashJoinCredentialsForRoute(fromHash.sessionId, fromHash.pin);
                return fromHash;
            }
        }

        if (typeof sessionStorage !== 'undefined') {
            try {
                const pending = sessionStorage.getItem(PENDING_JOIN_STORAGE_KEY);
                if (pending) {
                    sessionStorage.removeItem(PENDING_JOIN_STORAGE_KEY);
                    const parsed = JSON.parse(pending);
                    const sessionId = sanitizeGuestSessionId(parsed && parsed.sessionId);
                    const pin = sanitizeGuestJoinPin(parsed && parsed.pin);
                    if (sessionId && pin) {
                        return { sessionId: sessionId, pin: pin };
                    }
                }
            } catch (_) { /* ignore */ }
        }

        var fromContext = parseSessionContextFromStorage();
        if (fromContext) {
            return fromContext;
        }

        return fromSearch;
    }

    /**
     * 店舗ページ bootstrap 用: URL → localStorage / sessionStorage の順で接続資格を解決する。
     */
    function resolveGuestConnectCredentials(options) {
        options = options || {};
        var explicitSessionId = sanitizeGuestSessionId(options.sessionId || '');
        var explicitPin = sanitizeGuestJoinPin(options.pin || '');
        var fromUrl = parseJoinCredentialsFromLocation();
        var reconnect = loadGuestReconnectCredentials();
        var sessionId = String(
            explicitSessionId || fromUrl.sessionId || reconnect.sessionId || ''
        ).trim();
        var pin = String(
            explicitPin || fromUrl.pin || reconnect.pin || ''
        ).trim().toUpperCase();
        var shopId = reconnect.shopId != null ? reconnect.shopId : null;
        var shopSlug = String(reconnect.shopSlug || '').trim();
        var routeSlug = String(options.shopSlug || '').trim();
        var routeShopId = options.shopId != null ? normalizeShopPublicId(options.shopId) : null;
        var credsFromNavigation = !!(explicitSessionId && explicitPin)
            || !!(fromUrl.sessionId && fromUrl.pin
                && typeof location !== 'undefined'
                && parseJoinCredentialsFromSearch(location.search).sessionId);

        if (!sessionId || !pin) {
            return {
                sessionId: '',
                pin: '',
                shopId: shopId,
                shopSlug: shopSlug,
                shouldConnect: false
            };
        }
        if (!credsFromNavigation) {
            if (routeShopId && shopId != null
                && normalizeShopPublicId(shopId) !== routeShopId) {
                return {
                    sessionId: sessionId,
                    pin: pin,
                    shopId: shopId,
                    shopSlug: shopSlug,
                    shouldConnect: false,
                    mismatch: 'shopId'
                };
            }
            if (routeSlug && shopSlug && !guestSlugMatches(routeSlug, shopSlug)) {
                return {
                    sessionId: sessionId,
                    pin: pin,
                    shopId: shopId,
                    shopSlug: shopSlug,
                    shouldConnect: false,
                    mismatch: 'shopSlug'
                };
            }
        }
        return {
            sessionId: sessionId,
            pin: pin,
            shopId: routeShopId || normalizeShopPublicId(shopId),
            shopSlug: routeSlug || shopSlug,
            shouldConnect: true
        };
    }

    function stashJoinCredentialsForRoute(sessionId, pin) {
        if (typeof sessionStorage === 'undefined') {
            return;
        }
        const normalizedPin = sanitizeGuestJoinPin(pin);
        const id = sanitizeGuestSessionId(sessionId);
        if (!id || !normalizedPin) {
            return;
        }
        sessionStorage.setItem(PENDING_JOIN_STORAGE_KEY, JSON.stringify({
            sessionId: id,
            pin: normalizedPin
        }));
    }

    function buildFixedQrConnectUrl(baseUrl, shopSlug, tableNo, passPhrase) {
        const base = String(baseUrl || '').replace(/\/$/, '');
        const slug = displayPathSlug(shopSlug) || String(shopSlug || '').trim();
        const table = tableNo != null ? String(tableNo).trim() : '';
        const pass = String(passPhrase || '').trim();
        const path = buildShopScopedGuestPath(slug);
        if (!base || !path || !table || !pass) {
            return '';
        }
        const params = new URLSearchParams();
        params.set(FIXED_QR_TABLE_PARAM, table);
        params.set(FIXED_QR_PASS_PARAM, pass);
        return base + path + '?' + params.toString();
    }

    function tableNoFromGuestPathname(pathname) {
        var pathParts = String(pathname || '/').split('/').filter(Boolean);
        if (pathParts.length >= 3
                && String(pathParts[0]).toLowerCase() === 'shop'
                && /^\d+$/.test(pathParts[2])) {
            return Number(pathParts[2]);
        }
        return 0;
    }

    function parseFixedQrCredentialsFromSearch(search, pathname) {
        const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
        const shopId = normalizeShopPublicId(params.get(FIXED_QR_SHOP_PARAM) || params.get('shop') || '');
        let tableNo = Number(params.get(FIXED_QR_TABLE_PARAM) || params.get('table') || 0);
        if (!(tableNo > 0)) {
            tableNo = tableNoFromGuestPathname(pathname);
        }
        const passPhrase = String(params.get(FIXED_QR_PASS_PARAM) || params.get('passPhrase') || '').trim();
        return {
            shopId: shopId,
            tableNo: tableNo,
            passPhrase: passPhrase
        };
    }

    function buildOrderJoinUrlFromToken(baseUrl, joinToken, shopSlug) {
        const base = String(baseUrl || '').replace(/\/$/, '');
        const token = String(joinToken || '').trim();
        const slug = displayPathSlug(shopSlug) || String(shopSlug || '').trim();
        if (!base || !token || !slug) {
            return '';
        }
        const params = new URLSearchParams();
        params.set(JOIN_TOKEN_PARAM, token);
        return base + buildShopScopedGuestPath(slug) + '?' + params.toString();
    }

    function buildOrderJoinUrl(baseUrl, sessionId, pin, shopSlug) {
        const base = String(baseUrl || '').replace(/\/$/, '');
        const id = sanitizeGuestSessionId(sessionId);
        const normalizedPin = sanitizeGuestJoinPin(pin);
        const slug = displayPathSlug(shopSlug) || String(shopSlug || '').trim();
        if (!base || !id || !normalizedPin || !slug) {
            return '';
        }
        return base + buildShopScopedGuestUrl(slug, id, normalizedPin);
    }

    function stripJoinCredentialsFromUrl(cleanPath) {
        if (typeof history === 'undefined' || typeof location === 'undefined') {
            return;
        }
        const path = cleanPath != null ? String(cleanPath) : (location.pathname || '/');
        const params = new URLSearchParams(location.search || '');
        params.delete(JOIN_SESSION_PARAM);
        params.delete(JOIN_PIN_PARAM);
        // 接続成功後は address bar / history / Referer に PIN を残さない。
        // 共有 QR は buildShopScopedGuestUrl が明示的に id/pass を付ける。
        params.delete('id');
        params.delete('pass');
        LEGACY_GUEST_QUERY_KEYS.forEach(function (key) {
            params.delete(key);
        });
        const qs = params.toString();
        history.replaceState(history.state, document.title, qs ? path + '?' + qs : path);
    }

    function saveSessionCredentials(sessionId, pin, meta) {
        if (typeof sessionStorage === 'undefined') {
            return;
        }
        meta = meta && typeof meta === 'object' ? meta : {};
        if (sessionId) {
            sessionStorage.setItem(LS_SESSION_ID, sessionId);
        }
        if (pin) {
            sessionStorage.setItem(LS_PIN, String(pin).trim().toUpperCase());
        }
        if (meta.shopSlug) {
            sessionStorage.setItem(LS_SESSION_SHOP_SLUG, String(meta.shopSlug).trim());
        }
        if (meta.shopId != null && meta.shopId !== '') {
            sessionStorage.setItem(LS_SESSION_SHOP_ID, String(meta.shopId));
        }
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(LS_SESSION_ID);
            localStorage.removeItem(LS_PIN);
            localStorage.removeItem(LS_SESSION_SHOP_SLUG);
            localStorage.removeItem(LS_SESSION_SHOP_ID);
        }
    }

    function loadSessionCredentials() {
        if (typeof sessionStorage === 'undefined') {
            return { sessionId: '', pin: '', shopSlug: '', shopId: null };
        }
        var shopIdRaw = sessionStorage.getItem(LS_SESSION_SHOP_ID);
        return {
            sessionId: sessionStorage.getItem(LS_SESSION_ID) || '',
            pin: sessionStorage.getItem(LS_PIN) || '',
            shopSlug: sessionStorage.getItem(LS_SESSION_SHOP_SLUG) || '',
            shopId: shopIdRaw != null && shopIdRaw !== '' ? String(shopIdRaw).trim() : null
        };
    }

    function clearSessionCredentials() {
        if (typeof sessionStorage === 'undefined') {
            return;
        }
        sessionStorage.removeItem(LS_SESSION_ID);
        sessionStorage.removeItem(LS_PIN);
        sessionStorage.removeItem(LS_SESSION_SHOP_SLUG);
        sessionStorage.removeItem(LS_SESSION_SHOP_ID);
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(LS_SESSION_ID);
            localStorage.removeItem(LS_PIN);
            localStorage.removeItem(LS_SESSION_SHOP_SLUG);
            localStorage.removeItem(LS_SESSION_SHOP_ID);
        }
    }

    function resolvePinFromContext(explicitPin) {
        var normalized = normalizeJoinPin(explicitPin);
        if (normalized) {
            return normalized;
        }
        try {
            var fromUrl = parseJoinCredentialsFromLocation();
            if (fromUrl && fromUrl.pin) {
                return normalizeJoinPin(fromUrl.pin);
            }
        } catch (_ignored) { /* ignore */ }
        try {
            var stored = loadSessionCredentials();
            if (stored && stored.pin) {
                return normalizeJoinPin(stored.pin);
            }
        } catch (_ignored2) { /* ignore */ }
        return '';
    }

    function resolveSessionIdFromContext(explicitSessionId) {
        var sid = String(explicitSessionId || '').trim();
        if (sid) {
            return sid;
        }
        try {
            var fromUrl = parseJoinCredentialsFromLocation();
            if (fromUrl && fromUrl.sessionId) {
                return String(fromUrl.sessionId || '').trim();
            }
        } catch (_ignored) { /* ignore */ }
        try {
            var stored = loadSessionCredentials();
            if (stored && stored.sessionId) {
                return String(stored.sessionId || '').trim();
            }
        } catch (_ignored2) { /* ignore */ }
        return '';
    }

    function sumGuestOrderMenuQuantities(items) {
        if (!Array.isArray(items)) {
            return 0;
        }
        return items.reduce(function (sum, item) {
            var qty = item && item.quantity != null ? Number(item.quantity) : 0;
            if (!Number.isFinite(qty) || qty <= 0) {
                return sum;
            }
            return sum + qty;
        }, 0);
    }

    function validateGuestOrderSubmission(items) {
        var total = sumGuestOrderMenuQuantities(items);
        if (total >= REJECT_GUEST_ORDER_AT_MENU_UNITS) {
            return {
                valid: false,
                totalQuantity: total,
                maxAllowed: MAX_MENU_UNITS_PER_GUEST_ORDER,
                message: GUEST_ORDER_MAX_QUANTITY_MESSAGE
            };
        }
        return {
            valid: true,
            totalQuantity: total,
            maxAllowed: MAX_MENU_UNITS_PER_GUEST_ORDER,
            message: ''
        };
    }

    function guestCartLineDeclaredUnitTaxInclusive(line) {
        if (!line || typeof line !== 'object') {
            return 0;
        }
        var menuUnit = line.priceAtOrder != null
            ? line.priceAtOrder
            : (line.unitPrice != null ? line.unitPrice : 0);
        return Math.round(Number(menuUnit) || 0) + Math.round(Number(line.toppingPrice) || 0);
    }

    function clampGuestCartLineDeclaredUnitTaxInclusive(line, menu) {
        var declared = guestCartLineDeclaredUnitTaxInclusive(line);
        if (!menu || typeof menu !== 'object') {
            return declared;
        }
        var topping = Math.round(Number(line.toppingPrice) || 0);
        var floor = resolveGuestMenuOrderFloorPrice(menu) + topping;
        if (declared > floor && floor > 0) {
            return floor;
        }
        var listTaxInclusive = menu.catalogPrice != null ? Math.round(Number(menu.catalogPrice)) : 0;
        var menuUnit = menu.price != null ? Math.round(Number(menu.price)) : 0;
        if (listTaxInclusive > 0 && menuUnit > 0 && menuUnit < listTaxInclusive) {
            var listWithTopping = listTaxInclusive + topping;
            if (declared === listWithTopping) {
                return menuUnit + topping;
            }
        }
        return declared;
    }

    /**
     * 来客カート行から Gate 税込検証付き注文 items を組み立てる。
     * menus を渡すとセール中の定価申告を floor へクランプする。
     */
    function buildGuestOrderSubmitItems(cartLines, menus) {
        var menuById = guestMenuByIdMap(menus);
        return (Array.isArray(cartLines) ? cartLines : []).map(function (line) {
            var qty = Math.max(1, Math.round(Number(line && line.quantity) || 1));
            var menu = line && line.menuId != null ? menuById[String(line.menuId)] : null;
            var unitTaxInclusive = clampGuestCartLineDeclaredUnitTaxInclusive(line, menu);
            var menuName = '';
            if (line && line.menuName != null && String(line.menuName).trim()) {
                menuName = String(line.menuName).trim();
            } else if (menu && menu.name) {
                menuName = String(menu.name).trim();
            }
            var toppingNames = Array.isArray(line && line.toppingNames) ? line.toppingNames.slice() : [];
            return {
                menuId: line.menuId,
                quantity: qty,
                toppingIds: Array.isArray(line.toppingIds) ? line.toppingIds.slice() : [],
                toppingNames: toppingNames,
                menuName: menuName,
                declaredUnitTaxInclusive: unitTaxInclusive,
                declaredLineSubTotalTaxInclusive: unitTaxInclusive * qty
            };
        });
    }

    var GUEST_CLIENT_ID_HEADER = 'X-MasterOrder-Client-Id';
    var GUEST_CLIENT_ID_STORAGE_KEY = 'mo_guestClientId';

    function withSessionPin(options, pin) {
        var opts = options || {};
        var headers = Object.assign({}, opts.headers || {});
        var normalized = String(pin || '').trim();
        if (normalized) {
            headers[SESSION_PIN_HEADER] = normalized;
        }
        return Object.assign({}, opts, { headers: headers });
    }

    function readGuestOverlayToken(sessionId) {
        if (typeof sessionStorage === 'undefined' || !sessionId) {
            return null;
        }
        try {
            var raw = sessionStorage.getItem(GUEST_OVERLAY_TOKEN_PREFIX + String(sessionId));
            return raw && String(raw).trim() ? String(raw).trim() : null;
        } catch (_ignored) {
            return null;
        }
    }

    function writeGuestOverlayToken(sessionId, token) {
        if (typeof sessionStorage === 'undefined' || !sessionId || !token) {
            return;
        }
        try {
            sessionStorage.setItem(GUEST_OVERLAY_TOKEN_PREFIX + String(sessionId), String(token).trim());
        } catch (_ignored) { /* quota */ }
    }

    function rememberGuestOverlayTokenFromHttp(result) {
        var token = result && result.overlayToken;
        if (!token) {
            return;
        }
        var ctx = resolveGuestCatalogSessionContext();
        if (ctx && ctx.sessionId) {
            writeGuestOverlayToken(ctx.sessionId, token);
        }
    }

    function overlayGuestBundleInventory(bundle, stocks, inventoryUpdatedAt) {
        if (!bundle || typeof bundle !== 'object') {
            return bundle;
        }
        var stockMap = stocks && typeof stocks === 'object' ? stocks : {};
        var menus = Array.isArray(bundle.menus)
            ? bundle.menus.map(function (menu) {
                if (!menu || typeof menu !== 'object') {
                    return menu;
                }
                var stock = stockMap[menu.id];
                var stockQuantity = typeof stock === 'number' && isFinite(stock) ? Math.max(0, stock) : 0;
                var soldOut = menu.isAvailable === false || stockQuantity <= 0;
                return Object.assign({}, menu, {
                    soldOut: soldOut,
                    stockStatusLabel: soldOut ? '在庫切れ' : '在庫あり'
                });
            })
            : [];
        var soldOutIds = {};
        for (var i = 0; i < menus.length; i++) {
            if (menus[i] && menus[i].soldOut && menus[i].id != null) {
                soldOutIds[String(menus[i].id)] = true;
            }
        }
        var toppings = bundle.toppings && typeof bundle.toppings === 'object' ? bundle.toppings : {};
        var nextToppings = {};
        Object.keys(toppings).forEach(function (menuId) {
            var groups = Array.isArray(toppings[menuId]) ? toppings[menuId] : [];
            nextToppings[menuId] = groups.map(function (group) {
                if (!group || typeof group !== 'object') {
                    return group;
                }
                var groupToppings = Array.isArray(group.toppings) ? group.toppings : [];
                return Object.assign({}, group, {
                    toppings: groupToppings.map(function (topping) {
                        if (!topping || typeof topping !== 'object' || !topping.hasInventory) {
                            return topping;
                        }
                        return Object.assign({}, topping, {
                            soldOut: !!soldOutIds[String(menuId)] || topping.soldOut === true
                        });
                    })
                });
            });
        });
        return Object.assign({}, bundle, {
            menus: menus,
            toppings: nextToppings,
            inventoryUpdatedAt: inventoryUpdatedAt != null ? String(inventoryUpdatedAt) : null
        });
    }

    function resolveGuestCatalogSessionContext() {
        var sessionId = resolveSessionIdFromContext('');
        var pin = resolvePinFromContext('');
        if (!sessionId || !pin) {
            return null;
        }
        return { sessionId: sessionId, pin: pin };
    }

    function withGuestCatalogInventoryAccess(httpOptions, includeInventory) {
        if (!includeInventory) {
            return httpOptions || {};
        }
        var ctx = resolveGuestCatalogSessionContext();
        if (!ctx) {
            return httpOptions || {};
        }
        var opts = withSessionPin(httpOptions, ctx.pin);
        var headers = Object.assign({}, opts.headers || {});
        headers[GUEST_SESSION_ID_HEADER] = ctx.sessionId;
        var overlayToken = readGuestOverlayToken(ctx.sessionId);
        if (overlayToken) {
            headers[GUEST_OVERLAY_TOKEN_HEADER] = overlayToken;
        }
        return Object.assign({}, opts, { headers: headers });
    }

    function guestCatalogInventoryQuery(baseQuery, includeInventory) {
        var query = Object.assign({}, baseQuery || {});
        if (!includeInventory) {
            query.inv = 'catalog';
            return query;
        }
        var ctx = resolveGuestCatalogSessionContext();
        if (!ctx) {
            query.inv = 'catalog';
            return query;
        }
        query.overlay = '1';
        return query;
    }

    var IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

    function withGuestOrderHeaders(options, pin, guestMeta) {
        var opts = withSessionPin(options, pin);
        var meta = guestMeta || {};
        var headers = Object.assign({}, opts.headers || {});
        if (meta.clientId) {
            headers[GUEST_CLIENT_ID_HEADER] = meta.clientId;
        }
        if (meta.idempotencyKey) {
            headers[IDEMPOTENCY_KEY_HEADER] = meta.idempotencyKey;
        }
        return Object.assign({}, opts, { headers: headers });
    }

    /** サーバ GuestOrderClientHeaders と同一: ^[a-zA-Z0-9][a-zA-Z0-9_-]{7,63}$ */
    var GUEST_CLIENT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,63}$/;

    function isValidGuestClientId(value) {
        var id = String(value || '').trim();
        return !!id && GUEST_CLIENT_ID_PATTERN.test(id);
    }

    function createGuestClientId() {
        if (global.crypto && typeof global.crypto.randomUUID === 'function') {
            return global.crypto.randomUUID();
        }
        return 'guest-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
    }

    function ensureGuestClientId() {
        try {
            var existing = localStorage.getItem(GUEST_CLIENT_ID_STORAGE_KEY);
            if (isValidGuestClientId(existing)) {
                return String(existing).trim();
            }
            var created = createGuestClientId();
            localStorage.setItem(GUEST_CLIENT_ID_STORAGE_KEY, created);
            return created;
        } catch (_ignored) {
            return createGuestClientId();
        }
    }

    function generateOrderIdempotencyKey() {
        if (global.crypto && typeof global.crypto.randomUUID === 'function') {
            return global.crypto.randomUUID();
        }
        return 'idem-' + Date.now() + '-' + Math.random().toString(36).slice(2, 14);
    }

    /** 注文確認画面で 1 回だけ発行する requestId（= Idempotency-Key）。連打・再送は同一 ID。 */
    function generateRequestId() {
        return generateOrderIdempotencyKey();
    }

    function parseGuestOrderSubmitBody(body, fallbackRequestId) {
        if (!body || typeof body !== 'object') {
            return null;
        }
        if (typeof body.allowed !== 'boolean') {
            return null;
        }
        return {
            requestId: body.requestId || fallbackRequestId || null,
            allowed: body.allowed,
            errorId: body.errorId || null,
            errorMessage: body.errorMessage || null,
            orderId: body.orderId != null ? body.orderId : null,
            idempotentReplay: !!body.idempotentReplay
        };
    }

    function normalizeGuestOrderSubmitResult(body, fallbackRequestId) {
        var parsed = parseGuestOrderSubmitBody(body, fallbackRequestId);
        if (parsed) {
            return parsed;
        }
        if (body && typeof body === 'object' && body.orderId != null) {
            return {
                requestId: fallbackRequestId || null,
                allowed: true,
                errorId: null,
                errorMessage: null,
                orderId: body.orderId,
                idempotentReplay: false
            };
        }
        return null;
    }

    function rejectGuestOrderDenied(result, httpStatus) {
        var denied = new Error(result.errorMessage || '注文を送信できませんでした');
        denied.requestId = result.requestId;
        denied.errorId = result.errorId;
        denied.payload = result;
        if (httpStatus != null) {
            denied.status = httpStatus;
        }
        return denied;
    }

    var GUEST_ORDER_CONSOLE_PREFIX = '[MasterOrder][SendOrder]';

    function shouldLogGuestOrderToConsole(guestMeta) {
        return !!(guestMeta && guestMeta.consoleLog === true);
    }

    function buildGuestOrderConsoleRequest(sessionId, plan, items) {
        return {
            requestId: plan.requestId,
            sessionId: sessionId,
            clientId: plan.clientId,
            items: (items || []).map(function (line) {
                return {
                    menuId: line && line.menuId,
                    quantity: line && line.quantity,
                    toppingIds: line && line.toppingIds ? line.toppingIds.slice() : []
                };
            })
        };
    }

    function logGuestOrderConsole(phase, payload) {
        if (typeof console === 'undefined') {
            return;
        }
        var line = Object.assign({ phase: phase }, payload);
        if (typeof console.info === 'function') {
            console.info(GUEST_ORDER_CONSOLE_PREFIX, line);
        } else if (typeof console.log === 'function') {
            console.log(GUEST_ORDER_CONSOLE_PREFIX, line);
        }
    }

    function buildGuestOrderConsoleResult(result, requestSnapshot) {
        if (!result || typeof result !== 'object') {
            return { allowed: true, raw: result };
        }
        var requestId = result.requestId || requestSnapshot.requestId;
        if (result.allowed === false) {
            var denied = {
                requestId: requestId,
                allowed: false,
                errorId: result.errorId || null,
                errorMessage: result.errorMessage || null
            };
            if (result.httpStatus != null) {
                denied.httpStatus = result.httpStatus;
            }
            return denied;
        }
        var ok = {
            requestId: requestId,
            allowed: true,
            orderId: result.orderId != null ? result.orderId : null
        };
        if (result.idempotentReplay) {
            ok.idempotentReplay = true;
        }
        return ok;
    }

    function attachGuestOrderConsoleLogging(promise, requestSnapshot, guestMeta) {
        if (!shouldLogGuestOrderToConsole(guestMeta)) {
            return promise;
        }
        return promise.then(function (result) {
            logGuestOrderConsole('result', {
                request: requestSnapshot,
                result: buildGuestOrderConsoleResult(result, requestSnapshot)
            });
            return result;
        }).catch(function (err) {
            var denied = err && err.payload;
            logGuestOrderConsole('result', {
                request: requestSnapshot,
                result: buildGuestOrderConsoleResult({
                    requestId: (denied && denied.requestId) || err.requestId || requestSnapshot.requestId,
                    allowed: false,
                    errorId: (denied && denied.errorId) || err.errorId || null,
                    errorMessage: (denied && denied.errorMessage) || err.message || null,
                    httpStatus: err.status != null ? err.status : null
                }, requestSnapshot)
            });
            throw err;
        });
    }

    var GUEST_SUBMIT_BLOCKED_MESSAGE = '同じ注文を送信しています。しばらくお待ちください。';
    var GUEST_ORDER_SALE_ENDED_MESSAGE = 'セール期間が終了しました';

    function isGuestOrderPriceQuarantineMessage(msg) {
        if (!msg) {
            return false;
        }
        var s = String(msg).toLowerCase();
        return /price mismatch/i.test(s)
            || /price verification/i.test(s)
            || /quarantined due to prior/i.test(s);
    }

    function markGuestOrderSaleEnded(err, catalogGeneration) {
        err.code = 'SALE_ENDED';
        err.returnToCart = true;
        err.refreshCatalog = true;
        err.message = GUEST_ORDER_SALE_ENDED_MESSAGE;
        if (catalogGeneration != null) {
            err.catalogGeneration = catalogGeneration;
        }
    }

    function markGuestOrderCatalogStale(err, catalogGeneration, message) {
        err.code = 'CATALOG_STALE';
        err.returnToCart = true;
        err.refreshCatalog = true;
        err.message = message || '注意：価格が変更されました。カートの内容をご確認ください。';
        if (catalogGeneration != null) {
            err.catalogGeneration = catalogGeneration;
        }
    }
    var guestSubmitFlightBySession = Object.create(null);

    function canonicalGuestOrderPayload(sessionId, items) {
        var sid = String(sessionId || '').trim();
        var lines = (items || []).slice().sort(function (a, b) {
            return String(a.menuId || '').localeCompare(String(b.menuId || ''));
        });
        var parts = [sid];
        lines.forEach(function (line) {
            if (!line) {
                return;
            }
            var tops = (line.toppingIds || []).slice().map(normalizeToppingIdRef).filter(Boolean).sort(function (x, y) {
                return x.localeCompare(y);
            });
            parts.push(String(line.menuId) + ':' + String(line.quantity) + ':' + tops.join(','));
        });
        return parts.join('\n');
    }

    function planGuestOrderSubmit(sessionId, items, guestMeta) {
        guestMeta = guestMeta || {};
        var payloadSig = canonicalGuestOrderPayload(sessionId, items);
        var slot = guestSubmitFlightBySession[sessionId];

        if (slot && slot.inFlightPromise) {
            if (slot.payloadSig === payloadSig) {
                return {
                    mode: 'join',
                    promise: slot.inFlightPromise
                };
            }
            return {
                mode: 'blocked',
                message: GUEST_SUBMIT_BLOCKED_MESSAGE
            };
        }

        var requestId = guestMeta.requestId || guestMeta.idempotencyKey || generateRequestId();
        return {
            mode: 'new',
            payloadSig: payloadSig,
            clientId: guestMeta.clientId || ensureGuestClientId(),
            requestId: requestId,
            idempotencyKey: requestId
        };
    }

    function trackGuestOrderSubmitFlight(sessionId, payloadSig, clientId, requestId, promise) {
        var tracked = promise;
        guestSubmitFlightBySession[sessionId] = {
            payloadSig: payloadSig,
            clientId: clientId,
            requestId: requestId,
            idempotencyKey: requestId,
            inFlightPromise: tracked
        };
        tracked.finally(function () {
            var current = guestSubmitFlightBySession[sessionId];
            if (current && current.inFlightPromise === tracked) {
                delete guestSubmitFlightBySession[sessionId];
            }
        });
        return tracked;
    }

    function isGuestOrderSubmitInFlight(sessionId) {
        return !!(sessionId && guestSubmitFlightBySession[sessionId]);
    }

    function enrichGuestOrderApiError(err) {
        if (!err || typeof err !== 'object') {
            return err;
        }
        var payload = err.payload;
        if (payload && typeof payload === 'object') {
            if (payload.code === 'CATALOG_STALE' || payload.code === 'PRICE_MISMATCH') {
                markGuestOrderCatalogStale(err, payload.catalogGeneration, payload.message);
            } else if (payload.code === 'NODE_QUARANTINED') {
                var quarantineMsg = String(payload.message || '');
                if (isGuestOrderPriceQuarantineMessage(quarantineMsg)) {
                    markGuestOrderCatalogStale(err, payload.catalogGeneration);
                } else {
                    err.code = 'NODE_QUARANTINED';
                    err.returnToCart = true;
                    err.message = payload.message || '注文を処理できませんでした。店舗にお知らせください。';
                }
            }
        }
        if (err.code !== 'SALE_ENDED' && (err.status === 503 || err.code === 'NODE_QUARANTINED')) {
            if (isGuestOrderPriceQuarantineMessage(err.message)) {
                var staleGen = payload && payload.catalogGeneration != null ? payload.catalogGeneration : null;
                markGuestOrderCatalogStale(err, staleGen);
            }
        }
        var parsed = parseGuestOrderSubmitBody(err.payload, err.requestId || null);
        if (parsed && parsed.allowed === false) {
            if (parsed.errorMessage) {
                err.message = parsed.errorMessage;
                err.errorMessage = parsed.errorMessage;
            }
            if (parsed.errorId) {
                err.errorId = parsed.errorId;
            }
            if (parsed.requestId) {
                err.requestId = parsed.requestId;
            }
        }
        return err;
    }

    function isGuestOrderDuplicateConflict(err) {
        err = enrichGuestOrderApiError(err);
        if (!err || err.status !== 409) {
            return false;
        }
        var payload = err.payload;
        if (!payload || typeof payload !== 'object') {
            return false;
        }
        var code = String(payload.error || '');
        if (code === 'DUPLICATE_PAYLOAD' || code === 'DUPLICATE_IDEMPOTENCY_KEY') {
            return true;
        }
        var msg = String(payload.errorMessage || err.message || '');
        if (msg.indexOf('在庫') >= 0 || msg.indexOf('終了') >= 0) {
            return false;
        }
        return msg.indexOf('同じ注文') >= 0 || msg.indexOf('セッション処理中') >= 0;
    }

    function delayMs(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    function isGuestMenuSoldOut(menu) {
        if (!menu || typeof menu !== 'object') {
            return true;
        }
        if (menu.isAvailable === false) {
            return true;
        }
        var stock = Number(menu.stockQuantity);
        if (Number.isFinite(stock)) {
            return stock <= 0;
        }
        if (menu.soldOut === true || menu.stockStatusLabel === '在庫切れ') {
            return true;
        }
        if (menu.soldOut === false || menu.stockStatusLabel === '在庫あり') {
            return false;
        }
        return false;
    }

    function guestMenuPricingApi() {
        return global.MasterOrderGuestMenuPricing;
    }

    function guestTimeSaleCategoryLabel() {
        var api = guestMenuPricingApi();
        return api && api.GUEST_TIME_SALE_CATEGORY
            ? api.GUEST_TIME_SALE_CATEGORY
            : 'タイムセール';
    }

    function resolveGuestMenuOrderFloorPrice(menu) {
        if (!menu || typeof menu !== 'object') {
            return 0;
        }
        var pricingApi = guestMenuPricingApi();
        if (pricingApi && typeof pricingApi.resolveGuestMenuOrderFloorPrice === 'function') {
            return pricingApi.resolveGuestMenuOrderFloorPrice(menu);
        }
        return resolveGuestMenuDisplayPrice(menu);
    }

    function resolveGuestMenuDisplayPrice(menu, sessionType) {
        if (!menu || typeof menu !== 'object') {
            return 0;
        }
        var pricingApi = guestMenuPricingApi();
        if (pricingApi && typeof pricingApi.buildGuestMenuPriceDisplay === 'function') {
            return pricingApi.buildGuestMenuPriceDisplay(menu).effectivePrice;
        }
        var tax = global.MasterOrderConsumptionTax;
        var resolvedSession = (tax && tax.ServiceSessionType && sessionType)
            ? (String(sessionType).toUpperCase() === String(tax.ServiceSessionType.TAKEOUT)
                ? tax.ServiceSessionType.TAKEOUT
                : tax.ServiceSessionType.DINE_IN)
            : ((tax && tax.ServiceSessionType && tax.ServiceSessionType.DINE_IN) || 'DINE_IN');
        if (resolvedSession === ((tax && tax.ServiceSessionType && tax.ServiceSessionType.TAKEOUT) || 'TAKEOUT')
            && menu.takeoutAvailable
            && menu.takeoutPrice != null
            && Number(menu.takeoutPrice) > 0) {
            return Number(menu.takeoutPrice);
        }
        // 公開済み税込を正本にする（base から再換算して 1 円上振れさせない）
        if (menu.pricing && menu.pricing.display
            && menu.pricing.display.effectivePrice != null
            && Number(menu.pricing.display.effectivePrice) > 0) {
            return Number(menu.pricing.display.effectivePrice);
        }
        if (menu.price != null && Number(menu.price) > 0) {
            return Number(menu.price);
        }
        if (menu.catalogPrice != null && Number(menu.catalogPrice) > 0) {
            return Number(menu.catalogPrice);
        }
        if (tax && menu.basePrice != null && Number(menu.basePrice) > 0) {
            return tax.deriveTaxInclusiveFromBase(
                Number(menu.basePrice),
                menu.taxCategory || (tax.TaxCategory && tax.TaxCategory.STANDARD) || 'STANDARD',
                resolvedSession,
                menu.customTaxRatePercent
            );
        }
        return 0;
    }

    function guestCartLineUnitTotal(cartLine) {
        if (!cartLine || typeof cartLine !== 'object') {
            return 0;
        }
        var unit = cartLine.priceAtOrder != null
            ? cartLine.priceAtOrder
            : (cartLine.unitPrice != null ? cartLine.unitPrice : 0);
        return Number(unit || 0) + Number(cartLine.toppingPrice || 0);
    }

    function guestMenuByIdMap(menus) {
        var menuById = {};
        (Array.isArray(menus) ? menus : []).forEach(function (menu) {
            if (menu && menu.id != null) {
                menuById[String(menu.id)] = menu;
            }
        });
        return menuById;
    }

    function guestCartLinesForPriceReconcile(items, guestMeta) {
        if (guestMeta && Array.isArray(guestMeta.cartLines) && guestMeta.cartLines.length) {
            return guestMeta.cartLines;
        }
        if (guestMeta && Array.isArray(guestMeta.cart) && guestMeta.cart.length) {
            return guestMeta.cart;
        }
        var lines = Array.isArray(items) ? items : [];
        if (!lines.length) {
            return null;
        }
        var hasStoredPrice = lines.some(function (line) {
            return line && (line.priceAtOrder != null || line.unitPrice != null);
        });
        return hasStoredPrice ? lines : null;
    }

    function guestMenusForCartReconcile(menus, allMenus) {
        if (Array.isArray(allMenus) && allMenus.length) {
            return allMenus;
        }
        return Array.isArray(menus) ? menus : [];
    }

    function guestCartPriceUnitsMatch(currentUnit, cartUnit) {
        var current = Math.round(Number(currentUnit) || 0);
        var cart = Math.round(Number(cartUnit) || 0);
        return current === cart;
    }

    function guestCartPriceDriftDirection(cartUnit, currentUnit) {
        var cart = Math.round(Number(cartUnit) || 0);
        var current = Math.round(Number(currentUnit) || 0);
        if (cart > current) {
            return 'sale-benefit';
        }
        if (cart < current) {
            return 'price-increase';
        }
        return 'match';
    }

    function guestCartDriftReason(menu, item) {
        if (!item || item.direction === 'sale-benefit') {
            return item ? item.direction : 'match';
        }
        if (item.direction !== 'price-increase') {
            return item.direction;
        }
        var pricing = menu && menu.pricing;
        var listDisplay = pricing && pricing.display && pricing.display.listPrice;
        var list = listDisplay != null ? Number(listDisplay) : NaN;
        if (Number.isFinite(list) && list > 0 && Number(item.cartUnit) < list) {
            return 'sale-ended';
        }
        if (pricing && pricing.onSale === false && Number(item.currentUnit) > Number(item.cartUnit)) {
            return 'sale-ended';
        }
        return 'price-increase';
    }

    function enrichGuestCartPriceDrift(cart, menus, allMenus) {
        var drift = findGuestCartPriceDrift(cart, menus, allMenus);
        if (!drift.length) {
            return [];
        }
        var menuById = guestMenuByIdMap(guestMenusForCartReconcile(menus, allMenus));
        return drift.map(function (item) {
            var menu = menuById[String(item.menuId)];
            return Object.assign({}, item, {
                reason: guestCartDriftReason(menu, item)
            });
        });
    }

    function formatGuestCartPriceNotice(drift, lang) {
        drift = Array.isArray(drift) ? drift : [];
        if (!drift.length) {
            return '';
        }
        var i18n = global.MasterOrderGuestUiI18n;
        var resolvedLang = lang || getGuestMenuLang();
        function uiT(key) {
            if (i18n && typeof i18n.t === 'function') {
                return i18n.t(key, resolvedLang);
            }
            return key;
        }
        var reasons = drift.map(function (item) {
            return item.reason || item.direction;
        });
        var saleEndedCount = reasons.filter(function (reason) {
            return reason === 'sale-ended';
        }).length;
        if (saleEndedCount && saleEndedCount === drift.length) {
            return uiT('cartSaleEnded');
        }
        if (saleEndedCount > 0) {
            return uiT('cartSaleEndedPartial');
        }
        if (reasons.some(function (reason) {
            return reason === 'price-increase';
        })) {
            return uiT('cartPriceChanged');
        }
        return '';
    }

    function findGuestCartPriceDrift(cart, menus, allMenus) {
        var lines = Array.isArray(cart) ? cart : [];
        var menuList = guestMenusForCartReconcile(menus, allMenus);
        if (!lines.length || !menuList.length) {
            return [];
        }
        var menuById = guestMenuByIdMap(menuList);
        var drift = [];
        lines.forEach(function (line) {
            if (!line || line.menuId == null) {
                return;
            }
            if (line.priceAtOrder == null && line.unitPrice == null) {
                return;
            }
            var menu = menuById[String(line.menuId)];
            if (!menu) {
                return;
            }
            var currentUnit = resolveGuestMenuOrderFloorPrice(menu) + Number(line.toppingPrice || 0);
            var cartUnit = guestCartLineUnitTotal(line);
            if (!guestCartPriceUnitsMatch(currentUnit, cartUnit)) {
                drift.push({
                    menuId: line.menuId,
                    menuName: line.menuName || menu.name || '',
                    cartUnit: cartUnit,
                    currentUnit: currentUnit,
                    direction: guestCartPriceDriftDirection(cartUnit, currentUnit)
                });
            }
        });
        return drift;
    }

    function reconcileGuestCartPrices(cart, menus, allMenus) {
        var lines = Array.isArray(cart) ? cart : [];
        var menuList = guestMenusForCartReconcile(menus, allMenus);
        var drift = findGuestCartPriceDrift(lines, menuList);
        if (!drift.length) {
            return { changed: false, drift: [] };
        }
        var menuById = guestMenuByIdMap(menuList);
        lines.forEach(function (line) {
            if (!line || line.menuId == null) {
                return;
            }
            if (line.priceAtOrder == null && line.unitPrice == null) {
                return;
            }
            var menu = menuById[String(line.menuId)];
            if (!menu) {
                return;
            }
            line.priceAtOrder = resolveGuestMenuOrderFloorPrice(menu);
        });
        return { changed: true, drift: drift };
    }

    /**
     * 注文直前のカート価格同期。
     * セール中に定価が残っている場合はセール価格へ自動で下げて続行可能。
     * 価格が上がった場合（セール終了など）のみ blocked で確認を促す。
     */
    function prepareGuestCartForOrderSubmit(cart, menus, allMenus) {
        var lines = Array.isArray(cart) ? cart : [];
        var menuList = guestMenusForCartReconcile(menus, allMenus);
        var drift = enrichGuestCartPriceDrift(lines, menuList);
        if (!drift.length) {
            return { ready: true, changed: false, blocked: false, saleBenefitApplied: false, drift: [], notice: '' };
        }
        var blocked = drift.some(function (item) {
            return item.direction === 'price-increase';
        });
        var saleBenefitApplied = drift.some(function (item) {
            return item.direction === 'sale-benefit';
        });
        reconcileGuestCartPrices(lines, menuList);
        return {
            ready: !blocked,
            changed: true,
            blocked: blocked,
            saleBenefitApplied: saleBenefitApplied,
            drift: drift,
            notice: formatGuestCartPriceNotice(drift)
        };
    }

    function isGuestOrderPriceStaleError(err) {
        err = enrichGuestOrderApiError(err);
        if (!err) {
            return false;
        }
        if (err.code === 'SALE_ENDED') {
            return false;
        }
        if (err.code === 'CATALOG_STALE' || err.refreshCatalog === true) {
            return true;
        }
        var payload = err.payload;
        if (payload && (payload.code === 'CATALOG_STALE' || payload.code === 'PRICE_MISMATCH')) {
            return true;
        }
        return false;
    }

    function isGuestOrderSaleEndedError(err) {
        err = enrichGuestOrderApiError(err);
        return !!(err && err.code === 'SALE_ENDED');
    }

    function isGuestOrderStockError(err) {
        err = enrichGuestOrderApiError(err);
        if (!err) {
            return false;
        }
        var code = String(err.code || '');
        if (code === 'OUT_OF_STOCK' || code === 'INSUFFICIENT_STOCK' || code === 'STOCK_UNAVAILABLE') {
            return true;
        }
        var payload = err.payload;
        if (payload && typeof payload === 'object') {
            var payloadCode = String(payload.code || payload.error || payload.reasonCode || '');
            if (payloadCode === 'OUT_OF_STOCK'
                || payloadCode === 'INSUFFICIENT_STOCK'
                || payloadCode === 'STOCK_UNAVAILABLE'
                || payloadCode === 'PRICE_MISMATCH'
                || payloadCode === 'CATALOG_STALE') {
                return true;
            }
        }
        var msg = String(
            err.errorMessage
            || err.message
            || (payload && (payload.errorMessage || payload.message))
            || ''
        );
        return msg.indexOf('在庫') >= 0
            || msg.indexOf('お取り扱いできません') >= 0
            || msg.indexOf('お取り扱いしていません') >= 0;
    }

    function formatGuestOrderStockErrorMessage(err, fallback) {
        err = enrichGuestOrderApiError(err);
        var msg = String(
            (err && (err.errorMessage || err.message))
            || (err && err.payload && (err.payload.errorMessage || err.payload.message))
            || ''
        ).trim();
        if (!msg) {
            return fallback || '注文失敗：在庫が不足しています。メニューをご確認ください。';
        }
        // 来客向け: サーバ旧文言の「残りN個」を絶対に出さない
        if (/残り\s*\d+\s*個/.test(msg)) {
            var nameMatch = msg.match(/「([^」]+)」/);
            if (nameMatch && nameMatch[1]) {
                return '「' + nameMatch[1] + '」はご注文の数量が多すぎます。数を減らして再度お試しください。';
            }
            return 'ご注文の数量が多すぎます。数を減らして再度お試しください。';
        }
        return msg
            .replace(/現在お取り扱いできません/g, '在庫切れのため注文できません')
            .replace(/現在お取り扱いしていません/g, '在庫切れのため注文できません');
    }

    function normalizeGuestMenu(menu) {
        if (!menu || typeof menu !== 'object') {
            return null;
        }
        var pricingApi = guestMenuPricingApi();
        var normalized = pricingApi && typeof pricingApi.enrichGuestMenuForDisplay === 'function'
            ? pricingApi.enrichGuestMenuForDisplay(menu)
            : Object.assign({}, menu);
        if (!pricingApi || typeof pricingApi.enrichGuestMenuForDisplay !== 'function') {
            normalized.price = resolveGuestMenuDisplayPrice(normalized);
        }
        if (normalized.isAvailable === false) {
            normalized.soldOut = true;
            normalized.stockStatusLabel = '在庫切れ';
            return normalized;
        }
        var stock = Number(normalized.stockQuantity);
        if (Number.isFinite(stock)) {
            if (stock <= 0) {
                normalized.soldOut = true;
                normalized.stockStatusLabel = '在庫切れ';
            } else {
                normalized.soldOut = false;
                normalized.stockStatusLabel = '在庫あり';
            }
            return normalized;
        }
        if (normalized.soldOut === true || normalized.stockStatusLabel === '在庫切れ') {
            normalized.soldOut = true;
            normalized.stockStatusLabel = '在庫切れ';
            return normalized;
        }
        if (normalized.soldOut === false || normalized.stockStatusLabel === '在庫あり') {
            normalized.soldOut = false;
            if (!normalized.stockStatusLabel) {
                normalized.stockStatusLabel = '在庫あり';
            }
            return normalized;
        }
        return normalized;
    }

    function sumMenuUnitsFromApiItems(items) {
        return (items || []).reduce(function (sum, line) {
            return sum + (line && line.quantity ? Number(line.quantity) : 0);
        }, 0);
    }

    function canonicalGuestOrderItemsSignature(items) {
        var lines = (items || []).slice().sort(function (a, b) {
            var aId = resolveOrderHistoryMenuId(a) || '';
            var bId = resolveOrderHistoryMenuId(b) || '';
            return aId.localeCompare(bId);
        });
        return lines.map(function (line) {
            if (!line) {
                return '';
            }
            var menuId = resolveOrderHistoryMenuId(line) || '';
            // トッピングは int id / UUID / 名前が混在しうる。名前があれば名前で揃える。
            var tops = [];
            var namedTops = normalizeOrderHistoryToppings(line).map(function (top) {
                return top && top.name ? String(top.name) : '';
            }).filter(Boolean).sort();
            if (namedTops.length) {
                tops = namedTops;
            } else if (Array.isArray(line.toppingIds) && line.toppingIds.length) {
                tops = line.toppingIds.slice().map(normalizeToppingIdRef).filter(Boolean).sort();
            } else if (Array.isArray(line.toppings) && line.toppings.length) {
                tops = line.toppings.map(function (top) {
                    if (!top) {
                        return '';
                    }
                    if (top.toppingId != null) {
                        return String(top.toppingId);
                    }
                    if (top.id != null) {
                        return String(top.id);
                    }
                    return '';
                }).filter(Boolean).sort();
            }
            return menuId + ':' + String(line.quantity || 0) + ':' + tops.join(',');
        }).join('\n');
    }

    function guestMenuCategoryLabel(menu) {
        return menu && menu.category ? menu.category : GUEST_MENU_DEFAULT_CATEGORY;
    }

    function guestMenuCategoryLabels(menu) {
        var labels = [];
        if (menu && Array.isArray(menu.categoryNames) && menu.categoryNames.length) {
            labels = menu.categoryNames.slice();
        } else {
            var label = guestMenuCategoryLabel(menu);
            if (label) {
                labels = [label];
            }
        }
        var pricingApi = guestMenuPricingApi();
        if (pricingApi && typeof pricingApi.isGuestMenuTimeSaleActive === 'function'
            && pricingApi.isGuestMenuTimeSaleActive(menu)) {
            var saleLabel = (menu.pricing && typeof menu.pricing.saleLabel === 'string'
                && menu.pricing.saleLabel.trim())
                ? menu.pricing.saleLabel.trim()
                : guestTimeSaleCategoryLabel();
            if (labels.indexOf(saleLabel) < 0) {
                labels.unshift(saleLabel);
            }
        }
        return labels;
    }

    function guestMenuSaleCategoryLabel(menu) {
        var pricingApi = guestMenuPricingApi();
        if (!pricingApi
            || typeof pricingApi.isGuestMenuTimeSaleActive !== 'function'
            || !pricingApi.isGuestMenuTimeSaleActive(menu)) {
            return '';
        }
        if (menu.pricing && typeof menu.pricing.saleLabel === 'string' && menu.pricing.saleLabel.trim()) {
            return menu.pricing.saleLabel.trim();
        }
        return guestTimeSaleCategoryLabel();
    }

    function isGuestTimeSaleCategory(category, menus, activeTimeSales) {
        if (!category) {
            return false;
        }
        if (category === guestTimeSaleCategoryLabel()) {
            return true;
        }
        if (Array.isArray(activeTimeSales)
            && activeTimeSales.some(function (sale) {
                return sale && (sale.saleLabel === category || sale.saleCategoryKey === category);
            })) {
            return true;
        }
        return (menus || []).some(function (menu) {
            return guestMenuSaleCategoryLabel(menu) === category;
        });
    }

    function extractGuestMenuCategories(menus) {
        var saleSet = new Set();
        var normalSet = new Set();
        var pricingApi = guestMenuPricingApi();
        var genericSaleLabel = guestTimeSaleCategoryLabel();
        var hasGenericTimeSale = false;
        (menus || []).forEach(function (menu) {
            var onSale = pricingApi
                && typeof pricingApi.isGuestMenuTimeSaleActive === 'function'
                && pricingApi.isGuestMenuTimeSaleActive(menu);
            var saleLabel = '';
            if (onSale) {
                saleLabel = (menu.pricing && typeof menu.pricing.saleLabel === 'string'
                    && menu.pricing.saleLabel.trim())
                    ? menu.pricing.saleLabel.trim()
                    : '';
                if (saleLabel) {
                    saleSet.add(saleLabel);
                } else {
                    hasGenericTimeSale = true;
                }
            }
            guestMenuCategoryLabels(menu).forEach(function (label) {
                if (!label || label === genericSaleLabel || label === saleLabel || saleSet.has(label)) {
                    return;
                }
                normalSet.add(label);
            });
        });
        var categories = Array.from(saleSet);
        if (hasGenericTimeSale && categories.indexOf(genericSaleLabel) < 0) {
            categories.push(genericSaleLabel);
        }
        Array.from(normalSet).forEach(function (label) {
            if (categories.indexOf(label) < 0) {
                categories.push(label);
            }
        });
        return categories;
    }

    function filterGuestMenusByCategory(menus, activeCategory) {
        var list = Array.isArray(menus) ? menus : [];
        if (!activeCategory) {
            return list;
        }
        var pricingApi = guestMenuPricingApi();
        if (activeCategory === guestTimeSaleCategoryLabel()) {
            return list.filter(function (menu) {
                return pricingApi
                    && typeof pricingApi.isGuestMenuTimeSaleActive === 'function'
                    && pricingApi.isGuestMenuTimeSaleActive(menu);
            });
        }
        // セール別カテゴリ（saleLabel 一致）または通常カテゴリ
        return list.filter(function (menu) {
            if (pricingApi
                && typeof pricingApi.isGuestMenuTimeSaleActive === 'function'
                && pricingApi.isGuestMenuTimeSaleActive(menu)
                && menu.pricing
                && menu.pricing.saleLabel === activeCategory) {
                return true;
            }
            return guestMenuCategoryLabels(menu).indexOf(activeCategory) >= 0;
        });
    }

    function filterGuestMenusByKeyword(menus, keyword) {
        var list = Array.isArray(menus) ? menus : [];
        var trimmed = String(keyword || '').trim();
        if (!trimmed) {
            return list;
        }
        var lower = trimmed.toLowerCase();
        return list.filter(function (menu) {
            return menu && menu.name && String(menu.name).toLowerCase().indexOf(lower) >= 0;
        });
    }

    function resolveGuestMenuActiveCategory(activeCategory, menus) {
        if (!activeCategory) {
            return null;
        }
        if (!Array.isArray(menus) || !menus.length) {
            return activeCategory;
        }
        var hasCategory = menus.some(function (menu) {
            return guestMenuCategoryLabels(menu).indexOf(activeCategory) >= 0;
        });
        return hasCategory ? activeCategory : null;
    }

    function isGuestMenuReadyForOrder(loadState, menus) {
        return loadState === GUEST_MENU_LOAD_STATE.READY
            && Array.isArray(menus)
            && menus.length > 0;
    }

    /**
     * メニューの「+」を出してよいか（閲覧のみ・未接続・読込中は不可）。
     * @param {{ viewOnly?: boolean, orderSending?: boolean, sessionId?: string, pin?: string, menuLoadState?: string, menus?: Array }} options
     */
    function canGuestAddMenuToCart(options) {
        var opts = options || {};
        if (opts.viewOnly === true || opts.orderSending === true) {
            return false;
        }
        var sessionId = String(opts.sessionId || '').trim();
        var pin = String(opts.pin || '').trim();
        if (!sessionId || !pin) {
            return false;
        }
        return isGuestMenuReadyForOrder(opts.menuLoadState, opts.menus);
    }

    /**
     * 来客のメニュー取得エラーを、原因ごとの i18n キーに分類する。
     * - EDGE_BLOCKED / 429 : エッジのレート制限などでアクセスが集中 → 「表示が早すぎます」
     * - OFFLINE            : 端末がオフライン
     * - TIMEOUT            : 応答が遅い
     * - 404                : 店舗/メニュー未検出（QR ミスなど）
     * - 5xx                : サーバー混雑
     * ※ レート制限(429)はエッジで CORS ヘッダが付かず、ブラウザからは status 0 の
     *   ネットワークエラーになる。core-sdk が code=EDGE_BLOCKED に正規化している。
     */
    function classifyGuestLoadErrorKey(err) {
        var status = err && typeof err.status === 'number' ? err.status : null;
        var code = err && err.payload && err.payload.code ? String(err.payload.code) : '';
        if (code === 'OFFLINE') {
            return 'menuLoadOffline';
        }
        if (code === 'TIMEOUT') {
            return 'menuLoadTimeout';
        }
        if (code === 'EDGE_BLOCKED' || status === 429) {
            return 'menuLoadTooFast';
        }
        if (status === 404) {
            return 'menuLoadNotFound';
        }
        if (status != null && status >= 500) {
            return 'menuLoadServerBusy';
        }
        if (status === 0 || status == null) {
            var online = typeof navigator === 'undefined' || navigator.onLine !== false;
            // CORS 欠落・一時ネットワーク障害を「表示が早すぎ」と誤表示しない
            return online ? 'menuLoadGeneric' : 'menuLoadOffline';
        }
        return 'menuLoadGeneric';
    }

    var GUEST_LOAD_ERROR_FALLBACK_JA = {
        menuLoadTooFast: 'メニューの表示が早すぎます。数秒待ってから、もう一度お試しください。',
        menuLoadOffline: 'インターネットに接続できません。通信環境をご確認のうえ、もう一度お試しください。',
        menuLoadTimeout: '通信に時間がかかっています。電波の良い場所で、もう一度お試しください。',
        menuLoadServerBusy: 'ただいま混み合っています。少し待ってから、もう一度お試しください。',
        menuLoadNotFound: 'お店またはメニューが見つかりませんでした。QRコードをもう一度読み取ってください。',
        menuLoadGeneric: 'メニューを読み込めませんでした。もう一度お試しください。'
    };

    /**
     * 来客向けの分かりやすいメニュー取得エラー文言（メニュー言語に追従）。
     * i18n 未ロード時は日本語フォールバック。
     */
    function guestMenuLoadErrorMessage(err, lang) {
        // 来客ネットワークガード等、サーバーが明示メッセージを返す 403 はそのまま伝える。
        var code = err && err.payload && err.payload.code ? String(err.payload.code) : '';
        if (code === 'BLOCKED_NETWORK') {
            var blockedMsg = (err.payload && (err.payload.error || err.payload.message)) || err.message;
            if (blockedMsg) {
                return String(blockedMsg);
            }
        }
        var key = classifyGuestLoadErrorKey(err);
        var resolvedLang = lang || getGuestMenuLang();
        var i18n = global.MasterOrderGuestUiI18n;
        if (i18n && typeof i18n.t === 'function') {
            return i18n.t(key, resolvedLang);
        }
        return GUEST_LOAD_ERROR_FALLBACK_JA[key] || GUEST_LOAD_ERROR_FALLBACK_JA.menuLoadGeneric;
    }

    function formatGuestMenuLoadError(err) {
        return guestMenuLoadErrorMessage(err, getGuestMenuLang());
    }

    /**
     * レート制限・オフライン・一時障害時は、端末キャッシュのメニューを出してエラーを隠す。
     * 店舗不存在(404)や BAN / ネットワーク遮断はキャッシュで誤魔化さない。
     */
    function guestBundleLoadErrorAllowsCacheFallback(err) {
        var key = classifyGuestLoadErrorKey(err);
        return key === 'menuLoadTooFast'
            || key === 'menuLoadOffline'
            || key === 'menuLoadTimeout'
            || key === 'menuLoadServerBusy';
    }

    /**
     * メニュー取得以外の来客操作（トッピング取得・注文送信など）向けの分かりやすい文言。
     * 通信系エラーは中立的な文言（混雑/オフライン/遅延）にし、
     * 在庫不足・PIN 不一致などのドメインエラーはサーバー文言をそのまま返す。
     */
    function guestActionErrorMessage(err, lang) {
        var status = err && typeof err.status === 'number' ? err.status : null;
        var code = err && err.payload && err.payload.code ? String(err.payload.code) : '';
        var resolvedLang = lang || getGuestMenuLang();
        var i18n = global.MasterOrderGuestUiI18n;
        function tr(key) {
            if (i18n && typeof i18n.t === 'function') {
                return i18n.t(key, resolvedLang);
            }
            return GUEST_LOAD_ERROR_FALLBACK_JA[key] || GUEST_LOAD_ERROR_FALLBACK_JA.menuLoadGeneric;
        }
        if (code === 'BLOCKED_NETWORK') {
            var blockedMsg = (err.payload && (err.payload.error || err.payload.message)) || err.message;
            if (blockedMsg) {
                return String(blockedMsg);
            }
        }
        if (isGuestBannedError(err)) {
            return formatGuestConnectError(err);
        }
        if (code === 'OFFLINE') {
            return tr('menuLoadOffline');
        }
        if (code === 'TIMEOUT') {
            return tr('menuLoadTimeout');
        }
        if (code === 'EDGE_BLOCKED' || status === 429 || (status != null && status >= 500)) {
            return tr('menuLoadServerBusy');
        }
        if (status === 0 || status == null) {
            // クライアント側バリデーション等、status 無しの Error は本文を優先（混雑文言で誤魔化ししない）
            var rawMsg = err && err.message ? String(err.message).trim() : '';
            if (rawMsg
                && rawMsg.indexOf('Failed to fetch') < 0
                && rawMsg.indexOf('NetworkError') < 0
                && rawMsg.indexOf('Network request blocked') < 0
                && rawMsg.indexOf('Load failed') < 0) {
                return rawMsg;
            }
            var online = typeof navigator === 'undefined' || navigator.onLine !== false;
            return online ? tr('menuLoadServerBusy') : tr('menuLoadOffline');
        }
        // 400/403/409 等のドメインエラーはサーバーの説明文をそのまま見せる
        if (err && err.message) {
            return String(err.message);
        }
        return tr('menuLoadGeneric');
    }

    function normalizeGuestMenuLang(lang) {
        var raw = String(lang || '').trim().toLowerCase();
        if (!raw) {
            return GUEST_MENU_LANG_DEFAULT;
        }
        if (raw.indexOf('zh') === 0) {
            return 'zh';
        }
        raw = raw.slice(0, 2);
        return GUEST_MENU_LANG_ORDER.indexOf(raw) >= 0 ? raw : GUEST_MENU_LANG_DEFAULT;
    }

    function getGuestMenuLang() {
        try {
            return normalizeGuestMenuLang(localStorage.getItem(GUEST_MENU_LANG_KEY));
        } catch (_ignored) {
            return GUEST_MENU_LANG_DEFAULT;
        }
    }

    function isGuestMenuLangExplicit() {
        try {
            return localStorage.getItem(GUEST_MENU_LANG_EXPLICIT_KEY) === '1';
        } catch (_ignored) {
            return false;
        }
    }

    function setGuestMenuLang(lang, options) {
        options = options || {};
        var normalized = normalizeGuestMenuLang(lang);
        try {
            localStorage.setItem(GUEST_MENU_LANG_KEY, normalized);
            if (options.explicit !== false) {
                localStorage.setItem(GUEST_MENU_LANG_EXPLICIT_KEY, '1');
            }
        } catch (_ignored) { /* ignore */ }
        return normalized;
    }

    function guestMenuLanguageLabel(lang) {
        var code = normalizeGuestMenuLang(lang);
        return GUEST_MENU_LANG_LABELS[code] || code;
    }

    function shouldPromptGuestMenuLanguage(availableLanguages) {
        var langs = Array.isArray(availableLanguages) ? availableLanguages : [];
        if (langs.length <= 1) {
            return false;
        }
        if (!isGuestMenuLangExplicit()) {
            return true;
        }
        var cached = getGuestMenuLang();
        return langs.indexOf(cached) < 0;
    }

    function normalizeGuestAllergyCode(raw) {
        var catalog = allergyCatalog();
        if (catalog && typeof catalog.normalizeCode === 'function') {
            return catalog.normalizeCode(raw);
        }
        if (raw == null) {
            return '';
        }
        if (typeof raw === 'object') {
            raw = raw.name || raw.code || raw.value || '';
        }
        var code = String(raw || '').trim().toUpperCase();
        var known = false;
        guestAllergyOptions('ja').forEach(function (pair) {
            if (pair[0] === code) {
                known = true;
            }
        });
        if (code === 'MATSUTAKE') {
            known = true;
        }
        return known ? code : '';
    }

    function guestAllergyLabel(code, lang) {
        var catalog = allergyCatalog();
        var resolvedLang = lang || getGuestMenuLang();
        if (catalog && typeof catalog.displayLabel === 'function') {
            var normalized = normalizeGuestAllergyCode(code);
            if (normalized) {
                return catalog.displayLabel(normalized, resolvedLang);
            }
        }
        var normalizedCode = normalizeGuestAllergyCode(code);
        var options = guestAllergyOptions(resolvedLang);
        for (var i = 0; i < options.length; i++) {
            if (options[i][0] === normalizedCode) {
                return options[i][1];
            }
        }
        return normalizedCode || String(code || '');
    }

    function normalizeGuestHiddenAllergies(codes) {
        var list = Array.isArray(codes) ? codes : [];
        var seen = {};
        var out = [];
        list.forEach(function (item) {
            var code = normalizeGuestAllergyCode(item);
            if (!code || seen[code]) {
                return;
            }
            seen[code] = true;
            out.push(code);
        });
        return out;
    }

    function getGuestHiddenAllergies() {
        try {
            var raw = localStorage.getItem(GUEST_HIDDEN_ALLERGIES_KEY);
            if (!raw) {
                return [];
            }
            var parsed = JSON.parse(raw);
            // レガシー: 配列のみ
            if (Array.isArray(parsed)) {
                return normalizeGuestHiddenAllergies(parsed);
            }
            if (parsed && typeof parsed === 'object') {
                var expiresAt = Number(parsed.expiresAt);
                if (Number.isFinite(expiresAt) && Date.now() > expiresAt) {
                    localStorage.removeItem(GUEST_HIDDEN_ALLERGIES_KEY);
                    return [];
                }
                return normalizeGuestHiddenAllergies(parsed.codes);
            }
            return [];
        } catch (_ignored) {
            return [];
        }
    }

    function setGuestHiddenAllergies(codes) {
        var normalized = normalizeGuestHiddenAllergies(codes);
        try {
            if (!normalized.length) {
                localStorage.removeItem(GUEST_HIDDEN_ALLERGIES_KEY);
            } else {
                localStorage.setItem(GUEST_HIDDEN_ALLERGIES_KEY, JSON.stringify({
                    codes: normalized,
                    expiresAt: Date.now() + GUEST_HIDDEN_ALLERGIES_TTL_MS,
                    savedAt: Date.now()
                }));
            }
        } catch (_ignored) { /* ignore */ }
        return normalized;
    }

    function guestMenuAllergyCodes(menu) {
        var list = menu && Array.isArray(menu.allergies) ? menu.allergies : [];
        var seen = {};
        var out = [];
        list.forEach(function (item) {
            var code = normalizeGuestAllergyCode(item);
            if (!code || seen[code]) {
                return;
            }
            seen[code] = true;
            out.push(code);
        });
        return out;
    }

    function filterGuestMenusByAllergies(menus, hiddenAllergyCodes) {
        var list = Array.isArray(menus) ? menus : [];
        var hidden = normalizeGuestHiddenAllergies(hiddenAllergyCodes);
        if (!hidden.length) {
            return list;
        }
        var hiddenSet = {};
        hidden.forEach(function (code) {
            hiddenSet[code] = true;
        });
        return list.filter(function (menu) {
            var codes = guestMenuAllergyCodes(menu);
            for (var i = 0; i < codes.length; i++) {
                if (hiddenSet[codes[i]]) {
                    return false;
                }
            }
            return true;
        });
    }

    /**
     * 来客メニュー取得の共通ローダー（競合防止・オフラインキャッシュ・bundle/search 切替）。
     * UI は load() の結果を state に反映し、描画だけ担当する。
     */
    function createGuestMenuPricingRefreshScheduler(options) {
        var api = guestMenuPricingApi();
        if (!api || typeof api.createGuestMenuPricingRefreshScheduler !== 'function') {
            return {
                start: function () {},
                stop: function () {},
                notifyMenusUpdated: function () {},
                tick: function () {}
            };
        }
        options = options || {};
        options = Object.assign({}, options, { refreshOnVisibilityOnly: true });
        return api.createGuestMenuPricingRefreshScheduler(options);
    }

    function createGuestMenuLoader(loaderOptions) {
        loaderOptions = loaderOptions || {};
        var orderSdk = loaderOptions.orderSdk;
        if (!orderSdk) {
            throw new Error('createGuestMenuLoader: orderSdk is required');
        }
        var loadSeq = 0;
        var inflight = false;

        function resolveLoaderLang() {
            if (typeof loaderOptions.getLang === 'function') {
                return normalizeGuestMenuLang(loaderOptions.getLang());
            }
            if (typeof orderSdk.getGuestMenuLang === 'function') {
                return orderSdk.getGuestMenuLang();
            }
            return GUEST_MENU_LANG_DEFAULT;
        }

        function load(opts) {
            opts = opts || {};
            var seq = ++loadSeq;
            inflight = true;
            var viewOnly = !!opts.viewOnly;
            var shopId = opts.shopId;
            if (shopId == null && typeof loaderOptions.getShopId === 'function') {
                shopId = loaderOptions.getShopId();
            }
            var keyword = String(opts.keyword || '').trim();
            var allMenus = Array.isArray(opts.allMenus) ? opts.allMenus : [];
            var currentMenus = Array.isArray(opts.menus) ? opts.menus : [];

            function finish(result) {
                if (!result.stale) {
                    inflight = false;
                }
                return result;
            }

            if (!shopId) {
                if (seq !== loadSeq) {
                    return Promise.resolve(finish({ stale: true }));
                }
                return Promise.resolve(finish({
                    stale: false,
                    loadState: GUEST_MENU_LOAD_STATE.ERROR,
                    error: '店舗情報を取得できませんでした',
                    menus: [],
                    allMenus: allMenus,
                    activeCategory: opts.activeCategory || null,
                    keyword: keyword
                }));
            }

            if (opts.clientFilterOnly && allMenus.length) {
                if (seq !== loadSeq) {
                    return Promise.resolve(finish({ stale: true }));
                }
                var clientFiltered = filterGuestMenusByKeyword(allMenus, keyword);
                return Promise.resolve(finish({
                    stale: false,
                    loadState: clientFiltered.length
                        ? GUEST_MENU_LOAD_STATE.READY
                        : GUEST_MENU_LOAD_STATE.ERROR,
                    menus: clientFiltered,
                    allMenus: allMenus,
                    activeCategory: opts.activeCategory || null,
                    keyword: keyword,
                    shopId: shopId
                }));
            }

            var fetchPromise;
            var requestLang = resolveLoaderLang();
            if (!keyword && typeof orderSdk.loadOrderBundle === 'function') {
                // forceFresh でも端末キャッシュは消さない（ネットワーク失敗時のフォールバック用）。
                // 新鮮さは loadOrderBundle 側でキャッシュ優先返却をスキップして担保する。
                var bundleOptions = { lang: requestLang, forceFresh: opts.forceFresh === true };
                var includeInventory = opts.includeInventory;
                if (includeInventory == null && typeof loaderOptions.getIncludeInventory === 'function') {
                    includeInventory = loaderOptions.getIncludeInventory();
                }
                if (includeInventory == null) {
                    includeInventory = false;
                }
                bundleOptions.includeInventory = includeInventory !== false;
                if (typeof loaderOptions.onBundleRefresh === 'function') {
                    bundleOptions.onBundleRefresh = function (fresh, meta) {
                        if (seq !== loadSeq) {
                            return;
                        }
                        if (!meta || (!meta.generationChanged && !meta.pricingChanged && !meta.inventoryChanged)) {
                            return;
                        }
                        var refreshedMenus = fresh.menus || [];
                        var refreshedInvAt = fresh.inventoryUpdatedAt;
                        if (!bundleOptions.includeInventory) {
                            var stripped = stripGuestInventoryForBrowse(fresh);
                            refreshedMenus = stripped.menus || [];
                            refreshedInvAt = null;
                        }
                        var refreshed = {
                            menus: refreshedMenus,
                            toppings: fresh.toppings || {},
                            recommendMenus: fresh.recommendMenus || null,
                            guestTopLayout: fresh.guestTopLayout || null,
                            requestedLang: fresh.requestedLang,
                            resolvedLang: fresh.resolvedLang,
                            availableLanguages: fresh.availableLanguages,
                            catalogGeneration: fresh.catalogGeneration,
                            catalogPublishedAt: fresh.catalogPublishedAt,
                            isFree: fresh.isFree === true,
                            hasScheduledPromotions: fresh.hasScheduledPromotions === true,
                            pricingRefreshIntervalSec: fresh.pricingRefreshIntervalSec,
                            timesaleUpdatedAt: fresh.timesaleUpdatedAt,
                            activeTimeSales: fresh.activeTimeSales,
                            inventoryUpdatedAt: refreshedInvAt,
                            prefetchToppings: false,
                            catalogRefreshed: true
                        };
                        loaderOptions.onBundleRefresh(refreshed, meta);
                    };
                }
                fetchPromise = orderSdk.loadOrderBundle(shopId, '', bundleOptions).then(function (bundle) {
                    return {
                        menus: bundle.menus || [],
                        toppings: bundle.toppings || {},
                        recommendMenus: bundle.recommendMenus || null,
                        guestTopLayout: bundle.guestTopLayout || null,
                        requestedLang: bundle.requestedLang,
                        resolvedLang: bundle.resolvedLang,
                        availableLanguages: bundle.availableLanguages,
                        catalogGeneration: bundle.catalogGeneration,
                        catalogPublishedAt: bundle.catalogPublishedAt,
                        isFree: bundle.isFree === true,
                        hasScheduledPromotions: bundle.hasScheduledPromotions === true,
                        pricingRefreshIntervalSec: bundle.pricingRefreshIntervalSec,
                        timesaleUpdatedAt: bundle.timesaleUpdatedAt,
                        activeTimeSales: bundle.activeTimeSales,
                        inventoryUpdatedAt: bundle.inventoryUpdatedAt,
                        prefetchToppings: false
                    };
                });
            } else {
                fetchPromise = orderSdk.loadShopMenus({
                    shopId: shopId,
                    name: keyword || undefined,
                    lang: requestLang
                }).then(function (bundle) {
                    return {
                        menus: bundle.menus || [],
                        toppings: {},
                        prefetchToppings: !keyword
                    };
                });
            }

            return fetchPromise.then(function (fetched) {
                if (seq !== loadSeq) {
                    return finish({ stale: true });
                }
                var menus = fetched.menus || [];
                var nextAllMenus = keyword ? allMenus : menus;
                var saveHook = loaderOptions.saveMenuCache;
                if (typeof saveHook === 'function') {
                    Promise.resolve(saveHook(shopId, menus, {
                        catalogGeneration: fetched.catalogGeneration
                    })).catch(function () { /* ignore IDB errors */ });
                }
                return finish({
                    stale: false,
                    loadState: menus.length ? GUEST_MENU_LOAD_STATE.READY : GUEST_MENU_LOAD_STATE.ERROR,
                    menus: menus,
                    allMenus: nextAllMenus,
                    toppings: fetched.toppings,
                    recommendMenus: fetched.recommendMenus,
                    guestTopLayout: fetched.guestTopLayout,
                    prefetchToppings: fetched.prefetchToppings,
                    requestedLang: fetched.requestedLang || requestLang,
                    resolvedLang: fetched.resolvedLang || requestLang,
                    availableLanguages: fetched.availableLanguages,
                    catalogGeneration: fetched.catalogGeneration,
                    catalogPublishedAt: fetched.catalogPublishedAt,
                    isFree: fetched.isFree === true,
                    hasScheduledPromotions: fetched.hasScheduledPromotions === true,
                    pricingRefreshIntervalSec: fetched.pricingRefreshIntervalSec,
                    timesaleUpdatedAt: fetched.timesaleUpdatedAt,
                    activeTimeSales: fetched.activeTimeSales,
                    inventoryUpdatedAt: fetched.inventoryUpdatedAt,
                    activeCategory: resolveGuestMenuActiveCategory(opts.activeCategory, menus),
                    keyword: keyword,
                    shopId: shopId,
                    emptyMessage: menus.length
                        ? null
                        : 'メニューが登録されていないか、公開設定がありません'
                });
            }).catch(function (err) {
                if (seq !== loadSeq) {
                    return finish({ stale: true });
                }
                if (currentMenus.length) {
                    return finish({
                        stale: false,
                        loadState: GUEST_MENU_LOAD_STATE.READY,
                        menus: currentMenus,
                        allMenus: allMenus.length ? allMenus : currentMenus,
                        activeCategory: resolveGuestMenuActiveCategory(opts.activeCategory, currentMenus),
                        keyword: keyword,
                        shopId: shopId,
                        refreshFailed: true
                    });
                }
                var cacheHook = loaderOptions.loadMenuCache;
                if (typeof cacheHook === 'function') {
                    return Promise.resolve(cacheHook(shopId)).then(function (cached) {
                        if (seq !== loadSeq) {
                            return finish({ stale: true });
                        }
                        if (cached && Array.isArray(cached.menus) && cached.menus.length) {
                            return finish({
                                stale: false,
                                loadState: GUEST_MENU_LOAD_STATE.READY,
                                menus: cached.menus,
                                allMenus: keyword ? allMenus : cached.menus,
                                activeCategory: resolveGuestMenuActiveCategory(
                                    opts.activeCategory,
                                    cached.menus
                                ),
                                fromCache: true,
                                cacheSavedAt: cached.savedAt || null,
                                keyword: keyword,
                                shopId: shopId
                            });
                        }
                        return finish({
                            stale: false,
                            loadState: GUEST_MENU_LOAD_STATE.ERROR,
                            error: formatGuestMenuLoadError(err),
                            errorStatus: err && typeof err.status === 'number' ? err.status : null,
                            errorCode: err && err.payload && err.payload.code ? String(err.payload.code) : null,
                            menus: currentMenus,
                            allMenus: allMenus,
                            activeCategory: opts.activeCategory || null,
                            keyword: keyword,
                            shopId: shopId
                        });
                    });
                }
                return finish({
                    stale: false,
                    loadState: GUEST_MENU_LOAD_STATE.ERROR,
                    error: formatGuestMenuLoadError(err),
                    errorStatus: err && typeof err.status === 'number' ? err.status : null,
                    errorCode: err && err.payload && err.payload.code ? String(err.payload.code) : null,
                    menus: currentMenus,
                    allMenus: allMenus,
                    activeCategory: opts.activeCategory || null,
                    keyword: keyword,
                    shopId: shopId
                });
            });
        }

        return {
            load: load,
            isLoading: function () { return inflight; },
            cancelInflight: function () {
                loadSeq += 1;
                inflight = false;
            }
        };
    }

    /**
     * load() の結果を state に反映する。UI 更新は呼び出し側（描画のみ）。
     * @returns {object|null} メタ情報（toppings / error 等）。stale 時は null。
     */
    function mergeGuestMenuLoadResult(state, result) {
        if (!result || result.stale || !state) {
            return null;
        }
        state.menus = result.menus || [];
        if (result.allMenus != null) {
            state.allMenus = result.allMenus;
        } else if (!String(result.keyword || '').trim() && 'allMenus' in state) {
            state.allMenus = state.menus;
        }
        if (result.activeCategory !== undefined) {
            state.activeCategory = result.activeCategory;
        }
        if ('menuLoadState' in state) {
            state.menuLoadState = result.loadState || GUEST_MENU_LOAD_STATE.IDLE;
        }
        if (result.catalogGeneration != null && 'catalogGeneration' in state) {
            state.catalogGeneration = result.catalogGeneration;
        }
        if ('hasScheduledPromotions' in state) {
            state.hasScheduledPromotions = result.hasScheduledPromotions === true;
        }
        if ('pricingRefreshIntervalSec' in state) {
            state.pricingRefreshIntervalSec = result.pricingRefreshIntervalSec != null
                ? Number(result.pricingRefreshIntervalSec)
                : null;
        }
        if ('activeTimeSales' in state) {
            state.activeTimeSales = Array.isArray(result.activeTimeSales) ? result.activeTimeSales : [];
        }
        if ('timesaleUpdatedAt' in state) {
            state.timesaleUpdatedAt = result.timesaleUpdatedAt != null ? String(result.timesaleUpdatedAt) : null;
        }
        if ('inventoryUpdatedAt' in state || result.inventoryUpdatedAt != null) {
            state.inventoryUpdatedAt = result.inventoryUpdatedAt != null
                ? String(result.inventoryUpdatedAt)
                : null;
        }
        if (result.recommendMenus && 'recommendMenus' in state) {
            state.recommendMenus = result.recommendMenus;
        }
        if (result.guestTopLayout && 'guestTopLayout' in state) {
            state.guestTopLayout = result.guestTopLayout;
        }
        if (result.isFree === true) {
            state.isFree = true;
        } else if (result.isFree === false) {
            state.isFree = false;
        }
        return {
            toppings: result.toppings,
            recommendMenus: result.recommendMenus,
            guestTopLayout: result.guestTopLayout,
            prefetchToppings: result.prefetchToppings,
            shopId: result.shopId,
            fromCache: result.fromCache,
            cacheSavedAt: result.cacheSavedAt,
            error: result.error,
            errorStatus: result.errorStatus != null ? result.errorStatus : null,
            errorCode: result.errorCode != null ? result.errorCode : null,
            emptyMessage: result.emptyMessage,
            keyword: result.keyword,
            requestedLang: result.requestedLang,
            resolvedLang: result.resolvedLang,
            availableLanguages: result.availableLanguages,
            catalogGeneration: result.catalogGeneration,
            isFree: result.isFree === true,
            hasScheduledPromotions: result.hasScheduledPromotions === true,
            pricingRefreshIntervalSec: result.pricingRefreshIntervalSec,
            timesaleUpdatedAt: result.timesaleUpdatedAt,
            activeTimeSales: result.activeTimeSales
        };
    }

    function createGuestMenuLoaderForState(state, options) {
        options = options || {};
        var orderSdk = options.orderSdk;
        if (!orderSdk) {
            throw new Error('createGuestMenuLoaderForState: orderSdk is required');
        }
        var offlineApi = options.offline
            || (typeof global !== 'undefined' ? global.MasterOrderOffline : null);
        return createGuestMenuLoader({
            orderSdk: orderSdk,
            getShopId: function () {
                if (typeof options.getShopId === 'function') {
                    return options.getShopId();
                }
                if (state && state.viewOnly && !state.shopId) {
                    return null;
                }
                return state && state.shopId != null ? state.shopId : null;
            },
            getIncludeInventory: typeof options.getIncludeInventory === 'function'
                ? options.getIncludeInventory
                : function () {
                    return !!(state && state.sessionId && state.pin && !state.viewOnly);
                },
            onBundleRefresh: typeof options.onBundleRefresh === 'function'
                ? options.onBundleRefresh
                : undefined,
            saveMenuCache: typeof options.saveMenuCache === 'function'
                ? options.saveMenuCache
                : (offlineApi && typeof offlineApi.saveMenuCache === 'function'
                    ? function (shopId, menus, meta) { return offlineApi.saveMenuCache(shopId, menus, meta); }
                    : undefined),
            loadMenuCache: typeof options.loadMenuCache === 'function'
                ? options.loadMenuCache
                : (offlineApi && typeof offlineApi.loadMenuCache === 'function'
                    ? function (shopId) {
                        var expectedGen = state && state.catalogGeneration != null
                            ? state.catalogGeneration
                            : null;
                        return offlineApi.loadMenuCache(shopId, expectedGen);
                    }
                    : undefined)
        });
    }

    function createOrderSdk(options) {
        options = options || {};
        var fallbackBases = options.fallbackBaseUrls;
        if (!fallbackBases && typeof window !== 'undefined' && window._serverBaseFallbacks) {
            fallbackBases = window._serverBaseFallbacks;
        }
        const http = core.createHttpClient({
            baseUrl: options.apiBaseUrl,
            fallbackBaseUrls: fallbackBases,
            getAccessToken: options.getAccessToken || options.getIdToken,
            onUnauthorized: options.onUnauthorized
        });
        const catalogHttp = core.createHttpClient({
            baseUrl: options.catalogReadBaseUrl || inferGuestCatalogReadBase(),
            fallbackBaseUrls: fallbackBases
        });
        const profileApi = (options.getAccessToken || options.getIdToken)
            ? core.createProfileApi(http, authPaths)
            : null;

        function getGuestConnectOrderHistory(sessionId, pin, shopId, limit) {
            var resolvedSessionId = resolveSessionIdFromContext(sessionId);
            var resolvedPin = resolvePinFromContext(pin);
            if (!resolvedSessionId) {
                return Promise.reject(new Error('OrderSdk: sessionId is required for connect order history'));
            }
            if (!resolvedPin) {
                return Promise.reject(new Error('OrderSdk: PIN is required (missing X-Session-PIN context)'));
            }
            // connect と同じ shop スコープ（UUID → shopPublicId、int → shopId）
            var connectQuery = applyConnectShopScope({}, shopId);
            var cappedLimit = limit != null ? limit : 50;
            return http.get(
                core.withQuery(
                    guestPaths.connectOrders(resolvedSessionId),
                    Object.assign({ limit: cappedLimit }, connectQuery)
                ),
                withGuestOrderHeaders({}, resolvedPin, { clientId: ensureGuestClientId() })
            ).then(function (orders) {
                return Array.isArray(orders)
                    ? orders.map(core.normalizeOrderHistoryItem).filter(Boolean)
                    : [];
            });
        }

        function findRecentGuestOrderMatch(orders, items) {
            var targetSig = canonicalGuestOrderItemsSignature(items);
            var now = Date.now();
            return (orders || []).find(function (order) {
                if (!order) {
                    return false;
                }
                var orderSig = canonicalGuestOrderItemsSignature(order.items);
                if (orderSig !== targetSig) {
                    return false;
                }
                var t = core.parseApiDateTime(order.orderTime);
                if (!t) {
                    return false;
                }
                return now - t.getTime() <= 120000;
            }) || null;
        }

        function reconcileGuestOrderAfterDuplicate(sessionId, pin, shopId, items, attempt) {
            var tryNo = attempt || 0;
            return getGuestConnectOrderHistory(sessionId, pin, shopId, 20).then(function (orders) {
                var match = findRecentGuestOrderMatch(orders, items);
                if (match) {
                    return {
                        orderId: match.orderId,
                        status: match.status || 'PREPARING',
                        totalPrice: match.totalPrice
                    };
                }
                if (tryNo >= 4) {
                    return null;
                }
                return delayMs(400 * (tryNo + 1)).then(function () {
                    return reconcileGuestOrderAfterDuplicate(sessionId, pin, shopId, items, tryNo + 1);
                });
            });
        }

        const sdk = {
            api: http.request,
            connectSession: function (sessionId, pin, shopId) {
                var connectQuery = applyConnectShopScope({}, shopId);
                return http.get(
                    core.withQuery(
                        guestPaths.connectSession(sessionId),
                        connectQuery
                    ),
                    withGuestOrderHeaders({}, pin, { clientId: ensureGuestClientId() })
                );
            },
            getGuestConnectOrderHistory: getGuestConnectOrderHistory,
            connectSessionDetail: function (sessionId, pin, shopId) {
                var connectQuery = applyConnectShopScope({}, shopId);
                // 接続自体を履歴取得でブロックしない（履歴は apply 後に非同期で埋める）
                return http.get(
                    core.withQuery(
                        guestPaths.connectSession(sessionId),
                        connectQuery
                    ),
                    withGuestOrderHeaders({}, pin, { clientId: ensureGuestClientId() })
                )
                    .then(function (session) {
                        return parseSessionConnect(session, sessionId, pin);
                    });
            },
            registerGuestRoster: function (sessionId, pin, shopId) {
                var query = applyConnectShopScope({}, shopId);
                return http.post(
                    core.withQuery(guestPaths.registerGuestRoster(sessionId), query),
                    {},
                    withGuestOrderHeaders({}, pin, { clientId: ensureGuestClientId() })
                );
            },
            confirmGuestPeoples: function (sessionId, pin, peoples, shopId) {
                var query = applyConnectShopScope({}, shopId);
                return http.post(
                    core.withQuery(guestPaths.confirmGuestPeoples(sessionId), query),
                    { peoples: Number(peoples) },
                    withGuestOrderHeaders({}, pin, { clientId: ensureGuestClientId() })
                );
            },
            /**
             * 来客スタッフ依頼（CALL / CHECKOUT）。
             * @param {string} sessionId
             * @param {string} pin
             * @param {'CALL'|'CHECKOUT'|string} type
             * @param {string} [shopId]
             */
            raiseStaffRequest: function (sessionId, pin, type, shopId) {
                var query = applyConnectShopScope({}, shopId);
                return http.post(
                    core.withQuery(guestPaths.staffRequest(sessionId), query),
                    { type: String(type || '').trim().toUpperCase() },
                    withGuestOrderHeaders({}, pin, { clientId: ensureGuestClientId() })
                );
            },
            /** 接続後に履歴だけ補完。UI は待たない。1 時間キャッシュ、注文後は forceRefresh。 */
            fillConnectOrderHistory: function (detail, sessionId, pin, shopId, options) {
                options = options || {};
                if (!detail) {
                    return Promise.resolve(detail);
                }
                var resolvedSessionId = resolveSessionIdFromContext(sessionId || detail.sessionId);
                if (!options.forceRefresh) {
                    if (detail.orderHistory && detail.orderHistory.length) {
                        if (detail.rawOrderHistory && detail.rawOrderHistory.length) {
                            writeGuestOrderHistoryCache(resolvedSessionId, detail.rawOrderHistory);
                        }
                        return Promise.resolve(detail);
                    }
                    var cachedHistory = readGuestOrderHistoryCache(resolvedSessionId);
                    if (cachedHistory && cachedHistory.length) {
                        detail.orderHistory = mapOrderHistory(cachedHistory);
                        detail.rawOrderHistory = cachedHistory;
                        return Promise.resolve(detail);
                    }
                } else {
                    invalidateGuestOrderHistoryCache(resolvedSessionId);
                }
                return getGuestConnectOrderHistory(
                    resolvedSessionId,
                    pin || detail.pin,
                    shopId != null && shopId !== '' ? shopId : detail.shopId,
                    50
                )
                    .then(function (history) {
                        if (!Array.isArray(history) || !history.length) {
                            return detail;
                        }
                        writeGuestOrderHistoryCache(resolvedSessionId, history);
                        detail.orderHistory = mapOrderHistory(history);
                        detail.rawOrderHistory = history;
                        return detail;
                    })
                    .catch(function (err) {
                        if (typeof console !== 'undefined' && console.warn) {
                            console.warn('[OrderSdk] fillConnectOrderHistory failed', err);
                        }
                        var staleHistory = readGuestOrderHistoryCache(resolvedSessionId);
                        if (staleHistory && staleHistory.length) {
                            detail.orderHistory = mapOrderHistory(staleHistory);
                            detail.rawOrderHistory = staleHistory;
                        }
                        return detail;
                    });
            },
            joinSession: function (joinToken) {
                return http.get(guestPaths.joinSession(joinToken));
            },
            openFixedQrSession: function (payload) {
                return http.post(
                    guestPaths.openFixedQrSession(),
                    payload || {},
                    withGuestOrderHeaders({}, null, { clientId: ensureGuestClientId() })
                );
            },
            connectSessionViaJoinToken: function (joinToken, pin, shopId) {
                return http.get(guestPaths.joinSession(joinToken))
                    .then(function (joinInfo) {
                        var sessionId = joinInfo && joinInfo.sessionId;
                        var normalizedPin = normalizeJoinPin(pin);
                        if (!sessionId || !normalizedPin) {
                            throw new Error('合流後は PIN が必要です');
                        }
                        return http.get(
                            core.withQuery(
                                guestPaths.connectSession(sessionId),
                                (function () {
                                    return applyConnectShopScope({}, shopId);
                                })()
                            ),
                            withGuestOrderHeaders({}, normalizedPin, { clientId: ensureGuestClientId() })
                        ).then(function (session) {
                            return parseSessionConnect(session, sessionId, normalizedPin);
                        });
                    });
            },
            submitOrder: function (sessionId, pin, items, guestMeta) {
                var sid = sanitizeGuestSessionId(sessionId);
                var normalizedPin = sanitizeGuestJoinPin(pin);
                if (!sid) {
                    return Promise.reject(new Error('OrderSdk: sessionId is invalid (expected 10-char guest session id)'));
                }
                if (!normalizedPin) {
                    return Promise.reject(new Error('OrderSdk: PIN is required (missing or invalid X-Session-PIN)'));
                }
                var validation = validateGuestOrderSubmission(items);
                if (!validation.valid) {
                    return Promise.reject(new Error(validation.message));
                }
                var plan = planGuestOrderSubmit(sid, items, guestMeta);
                if (plan.mode === 'blocked') {
                    if (shouldLogGuestOrderToConsole(guestMeta)) {
                        logGuestOrderConsole('blocked', {
                            sessionId: sid,
                            message: plan.message
                        });
                    }
                    return Promise.reject(new Error(plan.message));
                }
                if (plan.mode === 'join') {
                    if (shouldLogGuestOrderToConsole(guestMeta)) {
                        logGuestOrderConsole('join', {
                            sessionId: sid,
                            requestId: guestSubmitFlightBySession[sid]
                                ? guestSubmitFlightBySession[sid].requestId
                                : null,
                            note: '同一カートの送信が進行中のため結果を共有します'
                        });
                    }
                    return attachGuestOrderConsoleLogging(
                        plan.promise,
                        buildGuestOrderConsoleRequest(sid, {
                            requestId: guestSubmitFlightBySession[sid]
                                ? guestSubmitFlightBySession[sid].requestId
                                : null,
                            clientId: guestSubmitFlightBySession[sid]
                                ? guestSubmitFlightBySession[sid].clientId
                                : null
                        }, items),
                        guestMeta
                    );
                }
                var requestSnapshot = buildGuestOrderConsoleRequest(sid, plan, items);
                if (shouldLogGuestOrderToConsole(guestMeta)) {
                    logGuestOrderConsole('request', { request: requestSnapshot });
                }
                var postBody = { items: items };
                if (guestMeta && guestMeta.catalogGeneration != null) {
                    postBody.catalogGeneration = guestMeta.catalogGeneration;
                }
                postBody.couponCodes = guestMeta && Array.isArray(guestMeta.couponCodes)
                    ? guestMeta.couponCodes.slice()
                    : [];
                var promise = http.post(
                    guestPaths.submitOrder(sid),
                    postBody,
                    withGuestOrderHeaders({
                        // HA 切替の一瞬 502/ネットワーク切れを隠し、同一 Idempotency-Key で再送
                        retry: { retries: 1, baseDelayMs: 250, maxDelayMs: 800 }
                    }, normalizedPin, {
                        clientId: plan.clientId,
                        idempotencyKey: plan.requestId
                    })
                ).then(function (body) {
                    var result = normalizeGuestOrderSubmitResult(body, plan.requestId);
                    if (!result) {
                        return body;
                    }
                    if (!result.allowed) {
                        throw rejectGuestOrderDenied(result);
                    }
                    return result;
                }).catch(function (err) {
                    err = enrichGuestOrderApiError(err);
                    if (!isGuestOrderDuplicateConflict(err)) {
                        throw err;
                    }
                    return reconcileGuestOrderAfterDuplicate(
                        sid,
                        normalizedPin,
                        guestMeta && guestMeta.shopId,
                        items
                    ).then(function (replayed) {
                        if (replayed) {
                            return {
                                requestId: plan.requestId,
                                allowed: true,
                                errorId: null,
                                errorMessage: null,
                                orderId: replayed.orderId,
                                idempotentReplay: true
                            };
                        }
                        throw err;
                    });
                });
                return trackGuestOrderSubmitFlight(
                    sid,
                    plan.payloadSig,
                    plan.clientId,
                    plan.requestId,
                    attachGuestOrderConsoleLogging(promise, requestSnapshot, guestMeta)
                );
            },
            isGuestOrderSubmitInFlight: function (sessionId) {
                return isGuestOrderSubmitInFlight(sessionId);
            },
            ensureGuestClientId: ensureGuestClientId,
            generateRequestId: generateRequestId,
            generateOrderIdempotencyKey: generateOrderIdempotencyKey,
            parseGuestOrderSubmitBody: parseGuestOrderSubmitBody,
            searchMenus: function (opts) {
                opts = opts || {};
                assertGateCatalogRead();
                return requireGateCatalogShopId(opts.shopId).then(function (catalogShopId) {
                    return catalogHttp.get(core.withQuery(gateGuestPaths.menuSearch(), {
                        shopPublicId: catalogShopId,
                        name: opts.name,
                        lang: opts.lang || getGuestMenuLang()
                    })).then(function (menus) {
                        return Array.isArray(menus)
                            ? menus.map(normalizeGuestMenu).filter(Boolean)
                            : [];
                    });
                });
            },
            getToppingGroupsForMenu: function (menuId, shopId) {
                assertGateCatalogRead();
                if (shopId == null || shopId === '') {
                    return Promise.reject(new Error('shopId is required for topping groups'));
                }
                return requireGateCatalogShopId(shopId).then(function (catalogShopId) {
                    return catalogHttp.get(core.withQuery(gateGuestPaths.toppingGroupsForMenu(menuId), {
                        shopPublicId: catalogShopId
                    }));
                });
            },
            loadOrderToppingCatalog: function (shopId) {
                assertGateCatalogRead();
                return requireGateCatalogShopId(shopId).then(function (catalogShopId) {
                    return catalogHttp.get(gateGuestPaths.orderToppingCatalog(catalogShopId));
                });
            },
            loadOrderBundle: function loadOrderBundle(shopId, name, options) {
                assertGateCatalogRead();
                options = options || {};
                return requireGateCatalogShopId(shopId).then(function (catalogShopId) {
                    var includeInventory = options.includeInventory === true;
                    var lang = options.lang || getGuestMenuLang();
                    var inflightKey = catalogShopId + ':' + lang + ':' + (name || '') + ':'
                        + (includeInventory ? 'inv' : 'cat') + ':'
                        + (options.forceFresh ? 'fresh' : 'swr');
                    if (inflightGuestOrderBundles[inflightKey]) {
                        return inflightGuestOrderBundles[inflightKey];
                    }
                    function trackBundleInflight(promise) {
                        inflightGuestOrderBundles[inflightKey] = promise;
                        promise.then(function () {}, function () {}).then(function () {
                            if (inflightGuestOrderBundles[inflightKey] === promise) {
                                delete inflightGuestOrderBundles[inflightKey];
                            }
                        });
                        return promise;
                    }
                    var cacheKey = GUEST_ORDER_BUNDLE_CACHE_PREFIX + catalogShopId + ':' + lang + ':' + (name || '');
                    var cachedPayload = null;
                    var cached = readGuestSessionJsonCache(cacheKey, GUEST_ORDER_BUNDLE_CACHE_TTL_MS);
                    if (cached && cached.payload) {
                        cachedPayload = cached.payload;
                        var pricingTtl = guestBundleCacheTtlMs(
                            cachedPayload.menus,
                            cachedPayload.hasScheduledPromotions === true,
                            cachedPayload
                        );
                        if (pricingTtl < GUEST_ORDER_BUNDLE_CACHE_TTL_MS) {
                            var pricingCached = readGuestSessionJsonCache(cacheKey, pricingTtl);
                            if (!pricingCached || !pricingCached.payload) {
                                cached = null;
                            } else {
                                cached = pricingCached;
                            }
                        }
                    }
                    var catalogInflightKey = catalogShopId + ':' + lang + ':' + (name || '') + ':cat:swr';
                    var catalogInflight = inflightGuestOrderBundles[catalogInflightKey];
                    if (includeInventory
                        && !options.forceFresh
                        && !name
                        && !options._fromCatalogPrefetch
                        && catalogInflight
                        && !(cached && cached.payload)) {
                        return catalogInflight.then(function (catalogBundle) {
                            void loadOrderBundle(shopId, name, Object.assign({}, options, {
                                _fromCatalogPrefetch: true
                            }));
                            return catalogBundle;
                        }, function () {
                            return loadOrderBundle(shopId, name, Object.assign({}, options, {
                                _fromCatalogPrefetch: true
                            }));
                        });
                    }
                    var readHttp = catalogHttp;
                    var bundlePath = gateGuestPaths.orderBundle(catalogShopId);

                    function normalizeBundle(raw) {
                        raw = raw || {};
                        var recommend = raw.recommendMenus;
                        return {
                            menus: Array.isArray(raw.menus)
                                ? raw.menus.map(normalizeGuestMenu).filter(Boolean)
                                : [],
                            toppings: raw.toppings && typeof raw.toppings === 'object' ? raw.toppings : {},
                            recommendMenus: recommend
                                ? core.normalizeRecommendMenusResponse(recommend)
                                : null,
                            guestTopLayout: raw.guestTopLayout && typeof raw.guestTopLayout === 'object'
                                ? raw.guestTopLayout
                                : null,
                            requestedLang: raw.requestedLang || lang || null,
                            resolvedLang: raw.resolvedLang || lang || getGuestMenuLang(),
                            availableLanguages: Array.isArray(raw.availableLanguages)
                                ? raw.availableLanguages
                                : [GUEST_MENU_LANG_DEFAULT],
                            catalogGeneration: raw.catalogGeneration != null ? Number(raw.catalogGeneration) : null,
                            catalogPublishedAt: raw.catalogPublishedAt || null,
                            isFree: raw.isFree === true,
                            adsEnabled: raw.adsEnabled === true,
                            hasScheduledPromotions: raw.hasScheduledPromotions === true,
                            pricingRefreshIntervalSec: raw.pricingRefreshIntervalSec != null
                                ? Number(raw.pricingRefreshIntervalSec)
                                : null,
                            timesaleUpdatedAt: raw.timesaleUpdatedAt != null ? String(raw.timesaleUpdatedAt) : null,
                            pricingCacheRevision: raw.pricingCacheRevision != null
                                ? String(raw.pricingCacheRevision)
                                : null,
                            inventoryUpdatedAt: raw.inventoryUpdatedAt != null
                                ? String(raw.inventoryUpdatedAt)
                                : null,
                            activeTimeSales: Array.isArray(raw.activeTimeSales) ? raw.activeTimeSales : []
                        };
                    }

                    function finalizeLoadedBundle(bundle) {
                        if (includeInventory) {
                            return bundle;
                        }
                        return stripGuestInventoryForBrowse(bundle);
                    }

                    function fetchFullOrderBundle(invHint) {
                        var bundleQuery = guestCatalogInventoryQuery({
                            name: name || '',
                            lang: lang
                        }, includeInventory);
                        var knownPcr = readGuestPricingCacheRevision(catalogShopId);
                        if (knownPcr && (shouldAttachGuestPricingCacheRevision(catalogShopId, options)
                                || options._probedCurrentPcr === true)) {
                            bundleQuery.pcr = knownPcr;
                        }
                        if (includeInventory) {
                            var inv = invHint != null && String(invHint).trim() !== ''
                                ? String(invHint).trim()
                                : (cachedPayload && cachedPayload.inventoryUpdatedAt
                                    ? String(cachedPayload.inventoryUpdatedAt)
                                    : 'none');
                            bundleQuery.inv = inv;
                        }
                        var headers = {};
                        var prevEtag = readGuestOrderBundleEtag(catalogShopId, lang);
                        if (prevEtag && cachedPayload) {
                            headers['If-None-Match'] = prevEtag;
                        }
                        var getOpts = withGuestCatalogInventoryAccess({
                            headers: headers,
                            acceptNotModified: true,
                            includeResponseMeta: true
                        }, includeInventory);
                        return readHttp.get(
                            core.withQuery(bundlePath, bundleQuery),
                            getOpts
                        ).then(function (result) {
                            rememberGuestOverlayTokenFromHttp(result);
                            var rawBundle = result;
                            var etag = null;
                            if (result && typeof result === 'object' && (
                                result.notModified === true
                                || result.__notModified === true
                                || Object.prototype.hasOwnProperty.call(result, 'body')
                            )) {
                                if (result.notModified || result.__notModified || result.status === 304) {
                                    if (cachedPayload) {
                                        var reused304 = finalizeLoadedBundle(normalizeBundle(cachedPayload));
                                        if (result.etag) {
                                            writeGuestOrderBundleEtag(catalogShopId, lang, result.etag);
                                        }
                                        if (result.pricingCacheRevision) {
                                            writeGuestPricingCacheRevision(
                                                catalogShopId,
                                                String(result.pricingCacheRevision)
                                            );
                                        }
                                        markGuestPricingRevisionProbed(catalogShopId);
                                        writeGuestOrderBundleSessionCache(cacheKey, reused304);
                                        return reused304;
                                    }
                                }
                                etag = result.etag || null;
                                rawBundle = result.body;
                            }
                            var normalized = finalizeLoadedBundle(normalizeBundle(rawBundle));
                            if (result && result.pricingCacheRevision) {
                                writeGuestPricingCacheRevision(
                                    catalogShopId,
                                    String(result.pricingCacheRevision)
                                );
                            }
                            if (normalized.pricingCacheRevision) {
                                writeGuestPricingCacheRevision(catalogShopId, normalized.pricingCacheRevision);
                            }
                            if (!normalized.pricingCacheRevision && bundleQuery.pcr) {
                                writeGuestPricingCacheRevision(catalogShopId, String(bundleQuery.pcr));
                            }
                            if (etag) {
                                writeGuestOrderBundleEtag(catalogShopId, lang, etag);
                            }
                            markGuestPricingRevisionProbed(catalogShopId);
                            writeGuestOrderBundleSessionCache(cacheKey, normalized);
                            return normalized;
                        });
                    }

                    function applyBundleRefresh(stalePayload, fresh) {
                        var generationChanged = fresh.catalogGeneration != null
                            && stalePayload.catalogGeneration != null
                            && Number(fresh.catalogGeneration) !== Number(stalePayload.catalogGeneration);
                        var pricingChanged = guestBundlePricingSignature(fresh)
                            !== guestBundlePricingSignature(stalePayload);
                        var inventoryChanged = guestBundleInventorySignature(fresh)
                            !== guestBundleInventorySignature(stalePayload);
                        if (generationChanged) {
                            invalidateGuestOrderBundleCache(catalogShopId);
                        }
                        writeGuestOrderBundleSessionCache(cacheKey, fresh);
                        if (typeof options.onBundleRefresh === 'function') {
                            try {
                                options.onBundleRefresh(fresh, {
                                    generationChanged: !!generationChanged,
                                    pricingChanged: !!pricingChanged,
                                    inventoryChanged: !!inventoryChanged,
                                    shopId: catalogShopId
                                });
                            } catch (_ignored) { /* UI hook */ }
                        }
                    }

                    function probeThenMaybeFetchBundle(cachedBundle) {
                        return readHttp.get(
                            gateGuestPaths.pricingRevision(catalogShopId),
                            withGuestCatalogInventoryAccess({ includeResponseMeta: true }, includeInventory)
                        ).then(function (result) {
                            rememberGuestOverlayTokenFromHttp(result);
                            var meta = result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'body')
                                ? result.body
                                : result;
                            var catalogUnchanged = cachedBundle && guestCatalogProbeUnchanged(
                                catalogShopId,
                                meta,
                                cachedBundle,
                                { ignoreInventory: !includeInventory }
                            );
                            markGuestPricingRevisionProbed(catalogShopId);
                            if (meta && meta.pricingCacheRevision != null) {
                                writeGuestPricingCacheRevision(catalogShopId, String(meta.pricingCacheRevision));
                            }
                            options._probedCurrentPcr = true;
                            if (!includeInventory) {
                                if (catalogUnchanged) {
                                    var reusedCatalog = finalizeLoadedBundle(normalizeBundle(cachedBundle));
                                    writeGuestOrderBundleSessionCache(cacheKey, reusedCatalog);
                                    return reusedCatalog;
                                }
                                return fetchFullOrderBundle('catalog');
                            }
                            var invHint = meta && meta.inventoryUpdatedAt != null
                                ? String(meta.inventoryUpdatedAt)
                                : (cachedBundle && cachedBundle.inventoryUpdatedAt) || 'none';
                            if (catalogUnchanged
                                && meta.stocks
                                && typeof meta.stocks === 'object') {
                                var overlaid = overlayGuestBundleInventory(
                                    normalizeBundle(cachedBundle),
                                    meta.stocks,
                                    meta.inventoryUpdatedAt
                                );
                                var reusedOverlay = finalizeLoadedBundle(overlaid);
                                writeGuestOrderBundleSessionCache(cacheKey, reusedOverlay);
                                return reusedOverlay;
                            }
                            if (catalogUnchanged) {
                                var reusedProbe = finalizeLoadedBundle(normalizeBundle(cachedBundle));
                                writeGuestOrderBundleSessionCache(cacheKey, reusedProbe);
                                return reusedProbe;
                            }
                            return fetchFullOrderBundle(invHint);
                        }).catch(function () {
                            return fetchFullOrderBundle(includeInventory ? undefined : 'catalog');
                        });
                    }

                    var network;
                    if (options.forceFresh) {
                        network = fetchFullOrderBundle();
                    } else {
                        network = probeThenMaybeFetchBundle(cachedPayload);
                    }
                    network = network.catch(function (err) {
                        var fallback = null;
                        if (cachedPayload && guestBundleLoadErrorAllowsCacheFallback(err)) {
                            try {
                                fallback = finalizeLoadedBundle(normalizeBundle(cachedPayload));
                            } catch (_ignored) {
                                fallback = null;
                            }
                        }
                        if (fallback && guestCachedBundleHasMenus(fallback)) {
                            fallback.fromSessionCache = true;
                            return fallback;
                        }
                        if (err && err instanceof core.ApiError) {
                            throw err;
                        }
                        throw new Error('メニュー情報の取得に失敗しました');
                    });

                    if (options.forceFresh) {
                        // キャッシュ優先はスキップするが、失敗時フォールバック用に消さない
                        clearGuestPricingCacheRevision(catalogShopId);
                        return trackBundleInflight(network);
                    }
                    if (cached && cached.payload && !name) {
                        var stalePayload = finalizeLoadedBundle(normalizeBundle(cached.payload));
                        if (!guestCachedBundleHasMenus(stalePayload)
                            || stalePayload.catalogGeneration == null) {
                            sessionStorage.removeItem(cacheKey);
                            return trackBundleInflight(network);
                        }
                        // 閲覧（PIN なし）でも pcr プローブする。バナーは catalogGeneration が
                        // 変わらないため、60秒スキップだと Staff 保存が来客に届かない。
                        var backgroundFetch = probeThenMaybeFetchBundle(stalePayload);
                        backgroundFetch.then(function (fresh) {
                            if (!fresh || fresh.fromSessionCache) {
                                return;
                            }
                            applyBundleRefresh(stalePayload, fresh);
                        }).catch(function () { /* keep session cache */ });
                        stalePayload.fromSessionCache = true;
                        return Promise.resolve(stalePayload);
                    }
                    return trackBundleInflight(network);
                });
            },
            invalidateGuestOrderBundleCache: invalidateGuestOrderBundleCache,
            invalidateGuestMenuDeviceCaches: invalidateGuestMenuDeviceCaches,
            getGuestMenuLang: getGuestMenuLang,
            setGuestMenuLang: setGuestMenuLang,
            isGuestMenuLangExplicit: isGuestMenuLangExplicit,
            normalizeGuestMenuLang: normalizeGuestMenuLang,
            guestMenuLanguageLabel: guestMenuLanguageLabel,
            shouldPromptGuestMenuLanguage: shouldPromptGuestMenuLanguage,
            filterGuestMenusByAllergies: filterGuestMenusByAllergies,
            getGuestHiddenAllergies: getGuestHiddenAllergies,
            setGuestHiddenAllergies: setGuestHiddenAllergies,
            guestAllergyLabel: guestAllergyLabel,
            guestMenuAllergyCodes: guestMenuAllergyCodes,
            get GUEST_ALLERGY_OPTIONS() {
                return guestAllergyOptions(getGuestMenuLang());
            },
            guestAllergyOptions: guestAllergyOptions,
            GUEST_MENU_LANG_DEFAULT: GUEST_MENU_LANG_DEFAULT,
            GUEST_MENU_LANG_LABELS: GUEST_MENU_LANG_LABELS,
            getRecommendMenus: function (shopId) {
                assertGateCatalogRead();
                return requireGateCatalogShopId(shopId).then(function (catalogShopId) {
                    var lang = getGuestMenuLang();
                    var cacheKey = GUEST_ORDER_BUNDLE_CACHE_PREFIX + catalogShopId + ':' + lang + ':';
                    var cached = readGuestSessionJsonCache(cacheKey, GUEST_ORDER_BUNDLE_CACHE_TTL_MS);
                    if (cached && cached.payload && cached.payload.recommendMenus != null) {
                        return Promise.resolve(
                            core.normalizeRecommendMenusResponse(cached.payload.recommendMenus)
                        );
                    }
                    return catalogHttp.get(core.withQuery(gateGuestPaths.orderBundle(catalogShopId), {
                        lang: lang
                    })).then(function (bundle) {
                        var recommend = core.normalizeRecommendMenusResponse(
                            bundle && bundle.recommendMenus
                        );
                        if (bundle && typeof bundle === 'object') {
                            writeGuestOrderBundleSessionCache(cacheKey, {
                                menus: Array.isArray(bundle.menus) ? bundle.menus : [],
                                toppings: bundle.toppings && typeof bundle.toppings === 'object'
                                    ? bundle.toppings
                                    : {},
                                recommendMenus: recommend,
                                catalogGeneration: bundle.catalogGeneration != null
                                    ? Number(bundle.catalogGeneration)
                                    : null,
                                resolvedLang: bundle.resolvedLang || lang
                            });
                        }
                        return recommend;
                    });
                });
            },
            loadShopMenus: function (opts) {
                opts = opts || {};
                assertGateCatalogRead();
                return requireGateCatalogShopId(opts.shopId).then(function (catalogShopId) {
                    return catalogHttp.get(core.withQuery(gateGuestPaths.menuSearch(), {
                        shopPublicId: catalogShopId,
                        name: opts.name,
                        lang: opts.lang || getGuestMenuLang()
                    })).then(function (menus) {
                        return {
                            menus: Array.isArray(menus)
                                ? menus.map(normalizeGuestMenu).filter(Boolean)
                                : [],
                            resolvedLang: opts.lang || getGuestMenuLang()
                        };
                    });
                });
            },
            createLocalOrderHistoryEntry: createLocalOrderHistoryEntry,
            mergeOrderHistoryWithPending: mergeOrderHistoryWithPending,
            mapOrderHistory: mapOrderHistory,
            resolveOrderHistoryDisplayTotal: resolveOrderHistoryDisplayTotal,
            resolveGuestMenuDisplayName: resolveGuestMenuDisplayName,
            normalizeOrderHistoryItem: normalizeOrderHistoryItem,
            formatOrderHistoryLines: formatOrderHistoryLines,
            validateGuestOrderSubmission: validateGuestOrderSubmission,
            buildGuestOrderSubmitItems: buildGuestOrderSubmitItems,
            validateCartToppingSelections: validateCartToppingSelections,
            formatOrderSendStatusLabel: formatOrderSendStatusLabel,
            ORDER_SEND_STATUS: ORDER_SEND_STATUS,
            normalizeGuestMenu: normalizeGuestMenu,
            resolveGuestMenuDisplayPrice: resolveGuestMenuDisplayPrice,
            resolveGuestMenuOrderFloorPrice: resolveGuestMenuOrderFloorPrice,
            guestMenusForCartReconcile: guestMenusForCartReconcile,
            findGuestCartPriceDrift: findGuestCartPriceDrift,
            enrichGuestCartPriceDrift: enrichGuestCartPriceDrift,
            formatGuestCartPriceNotice: formatGuestCartPriceNotice,
            reconcileGuestCartPrices: reconcileGuestCartPrices,
            prepareGuestCartForOrderSubmit: prepareGuestCartForOrderSubmit,
            isGuestOrderPriceStaleError: isGuestOrderPriceStaleError,
            isGuestOrderSaleEndedError: isGuestOrderSaleEndedError,
            isGuestOrderStockError: isGuestOrderStockError,
            formatGuestOrderStockErrorMessage: formatGuestOrderStockErrorMessage,
            isGuestMenuSoldOut: isGuestMenuSoldOut,
            filterGuestMenusHideSoldOut: filterGuestMenusHideSoldOut,
            stripGuestInventoryForBrowse: stripGuestInventoryForBrowse,
            createSessionResyncMonitor: function (monitorOptions) {
                /** 手動 session 再取得のみ（定期ポーリングなし）。Firestore 非対応時の resync 用。 */
                monitorOptions = monitorOptions || {};
                let activeSessionId = '';
                let activePin = '';
                let activeShopId = null;

                function stop() {
                    activeSessionId = '';
                    activePin = '';
                    activeShopId = null;
                }

                function resync() {
                    if (!activeSessionId || !activePin) {
                        return Promise.resolve(null);
                    }
                    if (typeof document !== 'undefined' && document.hidden) {
                        return Promise.resolve(null);
                    }
                    return http.get(
                        core.withQuery(
                            guestPaths.connectSession(activeSessionId),
                            activeShopId != null && activeShopId !== '' ? { shopId: activeShopId } : {}
                        ),
                        withGuestOrderHeaders({}, activePin, { clientId: ensureGuestClientId() })
                    )
                        .then(function (session) {
                            const detail = parseSessionConnect(session, activeSessionId, activePin);
                            if (typeof monitorOptions.onSessionUpdate === 'function') {
                                monitorOptions.onSessionUpdate(detail);
                            }
                            return detail;
                        });
                }

                function start(sessionId, pin, shopId) {
                    stop();
                    activeSessionId = sessionId;
                    activePin = String(pin || '').trim().toUpperCase();
                    activeShopId = shopId != null && shopId !== '' ? shopId : null;
                }

                return {
                    start: start,
                    stop: stop,
                    resync: resync
                };
            }
        };

        if (profileApi) {
            sdk.getMyProfile = profileApi.getMyProfile;
            sdk.updateMyProfile = profileApi.updateMyProfile;
            sdk.setMyPublicId = profileApi.setMyPublicId;
            sdk.saveProfile = profileApi.saveProfile;
        }

        return sdk;
    }

    function parseGuestQrText(text) {
        var raw = String(text || '').trim();
        if (!raw) {
            return { kind: 'invalid', raw: raw };
        }
        var base = typeof location !== 'undefined' ? location.origin : 'https://order.local';
        var parsed;
        try {
            parsed = new URL(raw, base);
        } catch (_) {
            return { kind: 'invalid', raw: raw };
        }
        var route = parseGuestRoute(parsed.pathname || '/');
        var pathShopSlug = guestRouteShopSlug(route);
        var hashBody = String(parsed.hash || '').replace(/^#/, '');
        var hashParams = new URLSearchParams(hashBody.charAt(0) === '?' ? hashBody : (hashBody ? '?' + hashBody : ''));
        var joinToken = (parsed.searchParams.get(JOIN_TOKEN_PARAM) || hashParams.get(JOIN_TOKEN_PARAM) || '').trim();
        if (joinToken) {
            return { kind: 'join', joinToken: joinToken, raw: raw, url: parsed, pathShopSlug: pathShopSlug };
        }
        var fixed = parseFixedQrCredentialsFromSearch(parsed.search, parsed.pathname);
        if (fixed.shopId && fixed.tableNo > 0 && fixed.passPhrase) {
            return {
                kind: 'fixed',
                shopId: fixed.shopId,
                tableNo: fixed.tableNo,
                passPhrase: fixed.passPhrase,
                raw: raw,
                url: parsed,
                pathShopSlug: pathShopSlug
            };
        }
        if (fixed.tableNo > 0 && fixed.passPhrase && pathShopSlug) {
            return {
                kind: 'fixed',
                shopId: fixed.shopId || null,
                tableNo: fixed.tableNo,
                passPhrase: fixed.passPhrase,
                raw: raw,
                url: parsed,
                pathShopSlug: pathShopSlug
            };
        }
        var creds = parseJoinCredentialsFromSearch(parsed.search);
        if (creds.sessionId && creds.pin) {
            return {
                kind: 'credentials',
                sessionId: creds.sessionId,
                pin: creds.pin,
                raw: raw,
                url: parsed,
                pathShopSlug: pathShopSlug
            };
        }
        if (hashBody) {
            creds = parseJoinCredentialsFromSearch(hashBody.charAt(0) === '?' ? hashBody : '?' + hashBody);
            if (creds.sessionId && creds.pin) {
                return {
                    kind: 'credentials',
                    sessionId: creds.sessionId,
                    pin: creds.pin,
                    raw: raw,
                    url: parsed,
                    pathShopSlug: pathShopSlug
                };
            }
        }
        return { kind: 'invalid', raw: raw, url: parsed, pathShopSlug: pathShopSlug };
    }

    function buildConnectEntryUrl(sessionId, pin, shopSlug) {
        var slug = displayPathSlug(shopSlug) || String(shopSlug || '').trim();
        if (!slug) {
            return '';
        }
        return buildShopScopedGuestUrl(slug, sessionId, pin);
    }

    function buildGuestSessionShareConnectUrl(sessionId, pin, orderPublicBase, shopSlug) {
        var entry = buildConnectEntryUrl(sessionId, pin, shopSlug);
        if (!entry) {
            return '';
        }
        var base = (orderPublicBase || inferGuestOrderPublicBase()).replace(/\/$/, '');
        return base + entry;
    }

    var DEFAULT_FIXED_QR_PEOPLES_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];

    var GUEST_ENTRY_SHELL_CSS = {
        original: [
            ':root{--mo-entry-bg:#0d0d0f;--mo-entry-card:#1a1a1e;--mo-entry-border:#2e2e36;',
            '--mo-entry-text:#f5f5f5;--mo-entry-muted:#9a9aa3;--mo-entry-accent:#f0c040;',
            '--mo-entry-accent-dark:#c8860a;--mo-entry-btn-text:#1a1200;--mo-entry-font:"Noto Sans JP",Arial,sans-serif}'
        ].join(''),
        index2: [
            ':root{--mo-entry-bg:#0d0d0f;--mo-entry-card:#1a1a1e;--mo-entry-border:#2e2e36;',
            '--mo-entry-text:#f5f5f5;--mo-entry-muted:#9a9aa3;--mo-entry-accent:#f0c040;',
            '--mo-entry-accent-dark:#c8860a;--mo-entry-btn-text:#1a1200;',
            '--mo-entry-font:"Noto Sans JP","Helvetica Neue",Arial,sans-serif;--mo-entry-display:"Playfair Display",serif}'
        ].join(''),
        'cursor-1': null,
        'premium-neon': [
            ':root{--mo-entry-bg:#07070c;--mo-entry-card:#12121a;--mo-entry-border:#3d2a6b;',
            '--mo-entry-text:#f2ecff;--mo-entry-muted:#a89cc9;--mo-entry-accent:#b967ff;',
            '--mo-entry-accent-dark:#7b2cbf;--mo-entry-btn-text:#120018;--mo-entry-font:"Noto Sans JP",Arial,sans-serif}'
        ].join('')
    };

    function guestEntryShellKey(shop) {
        var path = String((shop && shop.templateEntryPath) || '/guest-shop/').toLowerCase();
        if (path.indexOf('index2') >= 0 || path.indexOf('guest-shop') >= 0 || path.indexOf('komorebi') >= 0) {
            return 'index2';
        }
        var key = String((shop && shop.templateKey) || '').toLowerCase().replace(/-/g, '_');
        if (key === 'index2' || key === 'komorebi_premium' || key === 'komorebipremium') {
            return 'index2';
        }
        return 'index2';
    }

    function fetchPublicShopById(shopId, apiBase) {
        var id = normalizeShopPublicId(shopId);
        if (id) {
            return Promise.resolve({ shopId: id });
        }
        return Promise.resolve(null);
    }

    function resolvePublicShopDisplayName(shop, creds) {
        var raw = shop && typeof shop === 'object' ? shop : {};
        var name = String(raw.shopName || raw.name || '').trim();
        if (name) {
            return name;
        }
        return '店舗';
    }

    function loadFixedQrEntryShop(creds, apiBase) {
        if (creds.pathShopSlug) {
            return fetchPublicShop(creds.pathShopSlug, apiBase).then(function (shop) {
                if (shop && shop.shopId) {
                    creds.shopId = normalizeShopPublicId(shop.shopId);
                }
                return shop;
            });
        }
        if (creds.shopId) {
            return fetchPublicShopById(creds.shopId, apiBase);
        }
        return Promise.reject(new Error('店舗情報がありません'));
    }

    function stashFixedQrPendingOpen(shopId, tableNo, sessionId, entryPin) {
        if (typeof sessionStorage === 'undefined') {
            return;
        }
        var sid = sanitizeGuestSessionId(sessionId);
        var pin = sanitizeGuestJoinPin(entryPin);
        var shop = normalizeShopPublicId(shopId);
        var table = Number(tableNo || 0);
        if (!sid || !pin || !shop || table <= 0) {
            return;
        }
        try {
            sessionStorage.setItem(FIXED_QR_PENDING_OPEN_KEY, JSON.stringify({
                shopId: shop,
                tableNo: table,
                sessionId: sid,
                entryPin: pin,
                at: Date.now()
            }));
        } catch (_) { /* ignore */ }
    }

    function loadFixedQrPendingOpen(shopId, tableNo) {
        if (typeof sessionStorage === 'undefined') {
            return null;
        }
        var shop = normalizeShopPublicId(shopId);
        var table = Number(tableNo || 0);
        if (!shop || table <= 0) {
            return null;
        }
        try {
            var raw = sessionStorage.getItem(FIXED_QR_PENDING_OPEN_KEY);
            if (!raw) {
                return null;
            }
            var parsed = JSON.parse(raw);
            if (!parsed || normalizeShopPublicId(parsed.shopId) !== shop || Number(parsed.tableNo || 0) !== table) {
                return null;
            }
            var at = Number(parsed.at || 0);
            if (at > 0 && (Date.now() - at) > FIXED_QR_PENDING_OPEN_TTL_MS) {
                sessionStorage.removeItem(FIXED_QR_PENDING_OPEN_KEY);
                return null;
            }
            var sessionId = sanitizeGuestSessionId(parsed.sessionId);
            var entryPin = sanitizeGuestJoinPin(parsed.entryPin);
            if (!sessionId || !entryPin) {
                return null;
            }
            return {
                shopId: shop,
                tableNo: table,
                sessionId: sessionId,
                entryPin: entryPin
            };
        } catch (_) {
            return null;
        }
    }

    function clearFixedQrPendingOpen() {
        if (typeof sessionStorage === 'undefined') {
            return;
        }
        try {
            sessionStorage.removeItem(FIXED_QR_PENDING_OPEN_KEY);
        } catch (_) { /* ignore */ }
    }

    function connectSessionWithRetry(sessionController, sessionId, pin, shopId, options) {
        options = options || {};
        var maxAttempts = Number(options.maxAttempts || 4);
        var delayMs = Number(options.delayMs || 150);

        function attempt(tryNo) {
            return sessionController.connect(sessionId, pin, shopId).catch(function (err) {
                var status = err && err.status;
                if (status === 404 && tryNo < maxAttempts) {
                    return new Promise(function (resolve) {
                        setTimeout(resolve, delayMs * tryNo);
                    }).then(function () {
                        return attempt(tryNo + 1);
                    });
                }
                throw err;
            });
        }

        return attempt(1);
    }

    function tryRecoverFixedQrTableInUse(sessionController, credentials, options) {
        if (!sessionController || !credentials) {
            return Promise.resolve(null);
        }
        var pending = loadFixedQrPendingOpen(credentials.shopId, credentials.tableNo);
        if (!pending) {
            return Promise.resolve(null);
        }
        return connectSessionWithRetry(
            sessionController,
            pending.sessionId,
            pending.entryPin,
            pending.shopId,
            options && options.connectRetry
        ).then(function (detail) {
            clearFixedQrPendingOpen();
            return redirectAfterFixedQrConnect(detail, pending.entryPin, options);
        }).catch(function () {
            return null;
        });
    }

    function parseFixedQrOpenFailure(err) {
        var status = err && err.status;
        var message = (err && err.message) ? String(err.message) : '接続に失敗しました';
        var bodyText = '';
        try {
            if (err && err.body != null) {
                bodyText = typeof err.body === 'string' ? err.body : JSON.stringify(err.body);
            } else if (err && err.responseBody != null) {
                bodyText = String(err.responseBody);
            } else if (err && err.data != null) {
                bodyText = typeof err.data === 'string' ? err.data : JSON.stringify(err.data);
            }
        } catch (e) {
            bodyText = '';
        }
        var combined = (message + ' ' + bodyText).toLowerCase();
        if (status === 400) {
            return { code: 'INVALID_INPUT', message: message || 'リクエストが不正です' };
        }
        if (status === 409) {
            return {
                code: 'TABLE_IN_USE',
                message: 'この卓はすでにセッションが開始されています。接続を再試行しています…'
            };
        }
        if (status === 403) {
            if (isGuestBannedError(err)) {
                return {
                    code: 'GUEST_BANNED',
                    message: formatGuestConnectError(err)
                };
            }
            if (combined.indexOf('access denied') >= 0
                    || combined.indexOf('forbidden origin') >= 0
                    || combined.indexOf('csrf') >= 0) {
                return {
                    code: 'SECURITY_BLOCKED',
                    message: '接続がセキュリティ設定により拒否されました。ページを再読み込みして再試行してください。'
                };
            }
            if (combined.indexOf('営業時間外') >= 0
                    || combined.indexOf('outside_hours') >= 0
                    || combined.indexOf('outside hours') >= 0) {
                return {
                    code: 'OUTSIDE_HOURS',
                    message: '現在は営業時間外のため接続できません。営業時間を確認してください。'
                };
            }
            if (combined.indexOf('パスフレーズ') >= 0 || combined.indexOf('passphrase') >= 0 || combined.indexOf('passwd') >= 0) {
                return { code: 'INVALID_PASSPHRASE', message: 'PASSWD が正しくありません。スタッフに確認してください。' };
            }
            // サーバがプレーンテキスト「パスフレーズが正しくありません」を返す場合
            if (combined.indexOf('正しくありません') >= 0) {
                return { code: 'INVALID_PASSPHRASE', message: 'PASSWD が正しくありません。スタッフに確認してください。' };
            }
            // Spring Boot 本番は include-message=never で error:"Forbidden" だけになることがある
            if (message === 'Forbidden' || message === 'HTTP 403') {
                return {
                    code: 'FORBIDDEN',
                    message: '接続が拒否されました。営業時間外か、卓の PASSWD をスタッフに確認してください。'
                };
            }
            return {
                code: 'FORBIDDEN',
                message: message || '接続が拒否されました。スタッフに確認してください。'
            };
        }
        if (status === 404) {
            return {
                code: 'CONNECT_FAILED',
                message: 'セッション接続に失敗しました。卓の状態を確認してから再試行してください。'
            };
        }
        if (status === 423) {
            return { code: 'PIN_LOCKED', message: 'PIN の試行上限に達しました。スタッフにお声がけください。' };
        }
        if (status === 429) {
            return { code: 'RATE_LIMITED', message: '接続試行が多すぎます。しばらく待ってから再試行してください。' };
        }
        return { code: 'UNKNOWN', message: message };
    }

    function redirectAfterFixedQrConnect(detail, pin, options) {
        options = options || {};
        if (typeof options.onConnected === 'function') {
            return options.onConnected(detail, pin);
        }
        if (options.redirect !== false && typeof location !== 'undefined') {
            var target = buildConnectShopUrl(
                detail,
                detail.sessionId,
                pin,
                options.shopIdHint
            );
            if (target) {
                guestLocationReplace(target);
            }
        }
        return detail;
    }

    function confirmSessionPeoplesAndConnect(sessionController, payload, options) {
        options = options || {};
        var sdk = options.orderSdk || (sessionController && sessionController.sdk);
        if (!sdk || typeof sdk.confirmGuestPeoples !== 'function') {
            return Promise.reject(new Error('confirmGuestPeoples is unavailable'));
        }
        var sessionId = payload && payload.sessionId;
        var pin = payload && payload.pin;
        var peoples = payload && payload.peoples != null ? Number(payload.peoples) : 0;
        var shopId = payload && payload.shopId;
        if (!sessionId || !pin || peoples < 1) {
            return Promise.reject(new Error('sessionId / PIN / peoples が必要です'));
        }
        return sdk.confirmGuestPeoples(sessionId, pin, peoples, shopId).then(function () {
            return sessionController.connect(sessionId, pin, shopId).then(function (detail) {
                if (typeof options.onConnected === 'function') {
                    return Promise.resolve(options.onConnected(detail, pin)).then(function () {
                        return detail;
                    });
                }
                return detail;
            });
        });
    }

    function openFixedQrSessionAndConnect(sessionController, payload, options) {
        options = options || {};
        var sdk = options.orderSdk || (sessionController && sessionController.sdk);
        if (!sdk || typeof sdk.openFixedQrSession !== 'function') {
            return Promise.reject(new Error('orderSdk が必要です'));
        }
        var body = {
            shopId: requireShopPublicId(payload.shopId),
            tableNo: payload.tableNo,
            passPhrase: payload.passPhrase,
            peoples: payload.peoples != null ? payload.peoples : 1
        };
        if (!body.shopId) {
            return Promise.reject(new Error('店舗ID（UUID）がありません'));
        }
        return sdk.openFixedQrSession(body).then(function (opened) {
            if (!opened || !opened.sessionId || !opened.entryPin) {
                throw new Error('セッションの開始に失敗しました');
            }
            stashFixedQrPendingOpen(
                opened.shopId,
                body.tableNo,
                opened.sessionId,
                opened.entryPin
            );
            var connectOptions = Object.assign({}, options, {
                shopIdHint: opened.shopId != null ? opened.shopId : payload.shopId
            });
            if (opened.connectDetail) {
                clearFixedQrPendingOpen();
                var detail = parseSessionConnect(opened.connectDetail, opened.sessionId, opened.entryPin);
                var enriched = enrichConnectDetailWithOpenMeta(detail, opened, payload);
                // open 応答に名簿が無い場合は connect で確保する（シェア合流と番号を揃える）
                if (!enriched.myGuestAlias && !opened.ordererNo && !(opened.connectDetail && opened.connectDetail.myGuestAlias)) {
                    return connectSessionWithRetry(
                        sessionController,
                        opened.sessionId,
                        opened.entryPin,
                        opened.shopId,
                        connectOptions.connectRetry
                    ).then(function (connected) {
                        var merged = enrichConnectDetailWithOpenMeta(connected, opened, payload);
                        return redirectAfterFixedQrConnect(merged, opened.entryPin, connectOptions);
                    });
                }
                return redirectAfterFixedQrConnect(enriched, opened.entryPin, connectOptions);
            }
            return connectSessionWithRetry(
                sessionController,
                opened.sessionId,
                opened.entryPin,
                opened.shopId,
                connectOptions.connectRetry
            ).then(function (detail) {
                clearFixedQrPendingOpen();
                var enriched = enrichConnectDetailWithOpenMeta(detail, opened, payload);
                return redirectAfterFixedQrConnect(enriched, opened.entryPin, connectOptions);
            });
        });
    }

    function clearGuestEntryBootState() {
        if (typeof document === 'undefined') {
            return;
        }
        document.documentElement.classList.remove(
            'mo-shop-public-boot',
            'mo-connect-shop-boot',
            'mo-fixed-qr-entry-boot'
        );
        if (document.body) {
            document.body.classList.remove('mo-fixed-qr-entry-page');
            document.body.removeAttribute('data-mo-entry-shell');
        }
        var boot = document.getElementById('screenBoot');
        if (boot) {
            boot.classList.remove('active');
        }
        var entryRoot = document.getElementById('moFixedQrEntryRoot');
        if (entryRoot) {
            entryRoot.replaceChildren();
        }
    }

    function ensureFixedQrEntryStyles(shellKey) {
        if (typeof document === 'undefined') {
            return;
        }
        var key = shellKey || 'original';
        var css = GUEST_ENTRY_SHELL_CSS[key] || GUEST_ENTRY_SHELL_CSS.original;
        if (key === 'cursor-1' && !css) {
            css = GUEST_ENTRY_SHELL_CSS.original;
        }
        var node = document.getElementById('mo-fixed-qr-entry-style');
        if (!node) {
            node = document.createElement('style');
            node.id = 'mo-fixed-qr-entry-style';
            document.head.appendChild(node);
        }
        node.textContent = css + [
            'html.mo-fixed-qr-entry-boot .app-container{display:none!important}',
            '#moFixedQrEntryRoot{display:none;min-height:100vh}',
            'html.mo-fixed-qr-entry-boot #moFixedQrEntryRoot{display:block}',
            'body.mo-fixed-qr-entry-page{background:var(--mo-entry-bg);color:var(--mo-entry-text);',
            'font-family:var(--mo-entry-font);margin:0}',
            '.mo-fixed-qr-entry-wrap{max-width:480px;margin:0 auto;min-height:100vh;padding:24px 16px 40px}',
            '.mo-fixed-qr-entry-card{background:var(--mo-entry-card);border:1px solid var(--mo-entry-border);',
            'border-radius:14px;padding:20px}',
            '.mo-fixed-qr-entry-title{margin:0 0 6px;font-size:22px;font-weight:700;color:var(--mo-entry-accent)}',
            'body[data-mo-entry-shell="index2"] .mo-fixed-qr-entry-title{font-family:var(--mo-entry-display)}',
            '.mo-fixed-qr-entry-sub{margin:0 0 16px;font-size:14px;color:var(--mo-entry-muted);line-height:1.5}',
            '.mo-fixed-qr-entry-label{font-size:12px;color:var(--mo-entry-muted);margin:0 0 8px}',
            '.mo-fixed-qr-peoples-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:12px}',
            '.mo-fixed-qr-peoples-btn{padding:12px 0;border-radius:10px;border:1px solid var(--mo-entry-border);',
            'background:#121216;color:var(--mo-entry-text);font-size:16px;font-weight:700;cursor:pointer}',
            '.mo-fixed-qr-peoples-btn.selected{border-color:var(--mo-entry-accent);',
            'box-shadow:0 0 0 1px var(--mo-entry-accent) inset;color:var(--mo-entry-accent)}',
            '.mo-fixed-qr-peoples-custom{display:flex;gap:8px;align-items:center;margin-bottom:12px}',
            '.mo-fixed-qr-peoples-custom input{flex:1;padding:12px;border-radius:10px;border:1px solid var(--mo-entry-border);',
            'background:#121216;color:var(--mo-entry-text);font-size:15px}',
            '.mo-fixed-qr-entry-submit{width:100%;padding:14px;border-radius:12px;border:none;font-size:16px;',
            'font-weight:700;cursor:pointer;background:linear-gradient(135deg,var(--mo-entry-accent),var(--mo-entry-accent-dark));',
            'color:var(--mo-entry-btn-text)}',
            '.mo-fixed-qr-entry-submit:disabled{opacity:.55;cursor:not-allowed}',
            '.mo-fixed-qr-entry-status{margin-top:12px;font-size:14px;min-height:20px}',
            '.mo-fixed-qr-entry-status.error{color:#e74c3c}',
            '.mo-fixed-qr-entry-status.ok{color:#2ecc71}',
            '.mo-fixed-qr-entry-join{margin-top:16px;padding-top:16px;border-top:1px dashed var(--mo-entry-border)}',
            '.mo-fixed-qr-entry-join a{color:var(--mo-entry-accent)}'
        ].join('');
        document.body.setAttribute('data-mo-entry-shell', key);
        document.body.classList.add('mo-fixed-qr-entry-page');
    }

    function applyGuestEntryBranding(shop) {
        guestUrlApi.applyBranding(shop);
    }

    /**
     * 固定QR Entry（人数選択 → セッション開始 → メニュー）
     */
    function createFixedQrEntryController(options) {
        options = options || {};
        var root = options.root;
        var sessionController = options.sessionController;
        var orderSdkInstance = options.orderSdk || (sessionController && sessionController.sdk);
        var apiBase = options.apiBaseUrl || inferGuestApiBase();
        var peoplesOptions = Array.isArray(options.peoplesOptions) && options.peoplesOptions.length
            ? options.peoplesOptions.slice()
            : DEFAULT_FIXED_QR_PEOPLES_OPTIONS.slice();
        var preloadedShop = options.shop || options.initialShop || null;
        var state = {
            credentials: options.credentials || null,
            shop: preloadedShop,
            selectedPeoples: peoplesOptions[0] || 1,
            busy: false,
            inflightOpen: null
        };

        function setStatus(message, type) {
            if (typeof options.onStatus === 'function') {
                options.onStatus(message, type || '');
            }
            if (type === 'error' && message && typeof console !== 'undefined' && console.error) {
                console.error('[MasterOrder fixed QR entry]', message);
            }
            var statusEl = root && root.querySelector('.mo-fixed-qr-entry-status');
            if (statusEl) {
                statusEl.textContent = message || '';
                statusEl.className = 'mo-fixed-qr-entry-status' + (type ? ' ' + type : '');
            }
        }

        function renderJoinHint() {
            if (!root) {
                return;
            }
            var join = root.querySelector('.mo-fixed-qr-entry-join');
            if (!join) {
                join = document.createElement('div');
                join.className = 'mo-fixed-qr-entry-join';
                var label = document.createElement('p');
                label.className = 'mo-fixed-qr-entry-label';
                label.textContent = 'この卓は利用中です';
                var sub = document.createElement('p');
                sub.className = 'mo-fixed-qr-entry-sub';
                sub.append('代表者の合流QRを読み取るか、');
                var link = document.createElement('a');
                link.href = '/scan';
                link.textContent = 'スキャン画面';
                sub.appendChild(link);
                sub.append('から Session ID と PIN で合流してください。');
                join.append(label, sub);
                var card = root.querySelector('.mo-fixed-qr-entry-card');
                if (card) {
                    card.appendChild(join);
                }
            }
            join.hidden = false;
        }

        function renderForm() {
            if (!root) {
                return;
            }
            var creds = state.credentials || {};
            var tableNo = Number(creds.tableNo || 0);
            var shopName = resolvePublicShopDisplayName(state.shop, creds);
            root.replaceChildren();
            var wrap = document.createElement('div');
            wrap.className = 'mo-fixed-qr-entry-wrap';
            var card = document.createElement('div');
            card.className = 'mo-fixed-qr-entry-card';
            var title = document.createElement('h1');
            title.className = 'mo-fixed-qr-entry-title';
            title.textContent = shopName;
            var sub = document.createElement('p');
            sub.className = 'mo-fixed-qr-entry-sub';
            sub.textContent = tableNo > 0
                ? ('テーブル ' + tableNo + ' — 人数を選んで注文を開始してください')
                : '人数を選んで注文を開始してください';
            var label = document.createElement('p');
            label.className = 'mo-fixed-qr-entry-label';
            label.textContent = '人数';
            var grid = document.createElement('div');
            grid.className = 'mo-fixed-qr-peoples-grid';
            peoplesOptions.forEach(function (count) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'mo-fixed-qr-peoples-btn'
                    + (count === state.selectedPeoples ? ' selected' : '');
                btn.textContent = String(count) + '名';
                btn.dataset.peoples = String(count);
                btn.addEventListener('click', function () {
                    state.selectedPeoples = count;
                    grid.querySelectorAll('.mo-fixed-qr-peoples-btn').forEach(function (node) {
                        node.classList.toggle('selected', Number(node.dataset.peoples || 0) === count);
                    });
                    var customInput = root.querySelector('.mo-fixed-qr-peoples-custom input');
                    if (customInput) {
                        customInput.value = '';
                    }
                });
                grid.appendChild(btn);
            });
            var customRow = document.createElement('div');
            customRow.className = 'mo-fixed-qr-peoples-custom';
            var customInput = document.createElement('input');
            customInput.type = 'number';
            customInput.min = '1';
            customInput.max = '99';
            customInput.inputMode = 'numeric';
            customInput.placeholder = 'その他（1〜99）';
            customInput.addEventListener('input', function () {
                var n = Number(customInput.value || 0);
                if (n >= 1 && n <= 99) {
                    state.selectedPeoples = n;
                    grid.querySelectorAll('.mo-fixed-qr-peoples-btn').forEach(function (node) {
                        node.classList.remove('selected');
                    });
                }
            });
            customRow.appendChild(customInput);
            var submit = document.createElement('button');
            submit.type = 'button';
            submit.className = 'mo-fixed-qr-entry-submit';
            submit.textContent = '注文を開始';
            submit.addEventListener('click', function () {
                void submitPeoples();
            });
            var status = document.createElement('div');
            status.className = 'mo-fixed-qr-entry-status';
            card.append(title, sub, label, grid, customRow, submit, status);
            wrap.appendChild(card);
            root.appendChild(wrap);
        }

        function submitPeoples() {
            if (state.inflightOpen) {
                return state.inflightOpen;
            }
            if (state.busy || !state.credentials || !sessionController) {
                return Promise.resolve();
            }
            var peoples = Number(state.selectedPeoples || 0);
            if (peoples < 1 || peoples > 99) {
                setStatus('人数は 1〜99 で指定してください', 'error');
                return Promise.resolve();
            }
            state.busy = true;
            var isSessionMode = !!(state.credentials.sessionId && state.credentials.pin);
            setStatus(isSessionMode ? '人数を設定しています…' : 'セッションを開始しています…', 'ok');
            var submitBtn = root && root.querySelector('.mo-fixed-qr-entry-submit');
            if (submitBtn) {
                submitBtn.disabled = true;
            }
            if (isSessionMode) {
                state.inflightOpen = confirmSessionPeoplesAndConnect(sessionController, {
                    sessionId: state.credentials.sessionId,
                    pin: state.credentials.pin,
                    peoples: peoples,
                    shopId: state.credentials.shopId
                }, {
                    orderSdk: orderSdkInstance,
                    onConnected: options.onConnected
                }).catch(function (err) {
                    var message = (err && err.message) ? String(err.message) : '人数の設定に失敗しました';
                    setStatus(message, 'error');
                    throw err;
                }).finally(function () {
                    state.busy = false;
                    state.inflightOpen = null;
                    if (submitBtn) {
                        submitBtn.disabled = false;
                    }
                });
                return state.inflightOpen;
            }
            state.inflightOpen = openFixedQrSessionAndConnect(sessionController, {
                shopId: state.credentials.shopId,
                tableNo: state.credentials.tableNo,
                passPhrase: state.credentials.passPhrase,
                peoples: peoples
            }, {
                orderSdk: orderSdkInstance,
                onConnected: options.onConnected,
                redirect: options.redirect,
                shopIdHint: state.credentials.shopId
            }).catch(function (err) {
                var parsed = parseFixedQrOpenFailure(err);
                if (parsed.code === 'GUEST_BANNED' || isGuestBannedError(err)) {
                    if (typeof options.onGuestBanned === 'function') {
                        try {
                            options.onGuestBanned(err);
                        } catch (_cbErr) { /* ignore */ }
                    }
                    setStatus(parsed.message, 'error');
                    throw err;
                }
                var canRecover = parsed.code === 'TABLE_IN_USE' || (err && err.status === 404);
                if (canRecover) {
                    if (parsed.code === 'TABLE_IN_USE') {
                        setStatus(parsed.message, 'ok');
                    }
                    return tryRecoverFixedQrTableInUse(sessionController, state.credentials, {
                        orderSdk: orderSdkInstance,
                        onConnected: options.onConnected,
                        redirect: options.redirect
                    }).then(function (recovered) {
                        if (recovered) {
                            setStatus('接続しました。メニューへ移動します。', 'ok');
                            return recovered;
                        }
                        if (parsed.code === 'TABLE_IN_USE') {
                            setStatus(
                                'この卓は利用中です。代表者の合流QRを読み取るか、PINで合流してください。',
                                'error'
                            );
                            renderJoinHint();
                        } else {
                            setStatus(parsed.message, 'error');
                        }
                        throw err;
                    });
                }
                setStatus(parsed.message, 'error');
                throw err;
            }).finally(function () {
                state.busy = false;
                state.inflightOpen = null;
                if (submitBtn) {
                    submitBtn.disabled = false;
                }
            });
            return state.inflightOpen;
        }

        function start(fromSearch) {
            var creds = state.credentials;
            if (!creds && fromSearch != null) {
                creds = parseFixedQrCredentialsFromSearch(
                    fromSearch,
                    typeof location !== 'undefined' ? location.pathname : ''
                );
                state.credentials = creds;
            }
            var isSessionMode = !!(creds && creds.sessionId && creds.pin);
            if (!isSessionMode && (!creds || creds.tableNo <= 0 || !creds.passPhrase)) {
                setStatus('固定QRの情報が不足しています', 'error');
                return Promise.resolve(false);
            }
            if (isSessionMode && (!creds.sessionId || !creds.pin)) {
                setStatus('セッション情報が不足しています', 'error');
                return Promise.resolve(false);
            }
            setStatus('店舗情報を読み込み中…', '');
            if (preloadedShop && resolvePublicShopDisplayName(preloadedShop) !== '店舗') {
                state.shop = preloadedShop;
                if (preloadedShop.shopId) {
                    var resolvedShopId = requireShopPublicId(preloadedShop.shopId);
                    if (resolvedShopId) {
                        creds.shopId = resolvedShopId;
                        state.credentials = creds;
                    }
                }
                var preloadedShellKey = guestEntryShellKey(preloadedShop);
                ensureFixedQrEntryStyles(preloadedShellKey);
                applyGuestEntryBranding(preloadedShop);
                renderForm();
                setStatus('', '');
                return Promise.resolve(true);
            }
            return loadFixedQrEntryShop(creds, apiBase).then(function (shop) {
                state.shop = shop;
                state.credentials = creds;
                var shellKey = guestEntryShellKey(shop);
                ensureFixedQrEntryStyles(shellKey);
                applyGuestEntryBranding(shop);
                renderForm();
                setStatus('', '');
                return true;
            }).catch(function () {
                ensureFixedQrEntryStyles('original');
                renderForm();
                setStatus('', '');
                return true;
            });
        }

        return {
            start: start,
            submitPeoples: submitPeoples,
            getCredentials: function () { return state.credentials; },
            setCredentials: function (creds) { state.credentials = creds; }
        };
    }

    /**
     * /Shop/{slug}/?tableNo=&passPhrase= から開いたとき、人数選択 UI を表示する。
     * @returns {Promise<{ handled: boolean, ok?: boolean, controller?: object }>}
     */
    function tryBootstrapFixedQrTableEntry(options) {
        options = options || {};
        if (!isFixedQrConnectEntryPath()) {
            return Promise.resolve({ handled: false });
        }
        var fixedCreds = parseFixedQrCredentialsFromSearch(
            typeof location !== 'undefined' ? location.search : '',
            typeof location !== 'undefined' ? location.pathname : '');
        if (fixedCreds.tableNo <= 0 || !fixedCreds.passPhrase) {
            return Promise.resolve({ handled: false });
        }
        var shop = options.shop || null;
            var shopId = shop && shop.shopId != null
            ? requireShopPublicId(shop.shopId)
            : requireShopPublicId(fixedCreds.shopId);
        var slug = String(
            (options.guestRoute && options.guestRoute.shopSlug)
            || options.shopSlug
            || (shop && (shop.urlSlug || shop.shopSlug))
            || ''
        ).trim();
        if (!options.root || !options.sessionController) {
            return Promise.reject(new Error('root and sessionController are required'));
        }
        var controller = createFixedQrEntryController({
            root: options.root,
            sessionController: options.sessionController,
            orderSdk: options.orderSdk,
            apiBaseUrl: options.apiBaseUrl || inferGuestApiBase(),
            shop: shop,
            credentials: {
                shopId: shopId,
                tableNo: fixedCreds.tableNo,
                passPhrase: fixedCreds.passPhrase,
                pathShopSlug: slug
            },
            onConnected: options.onConnected,
            onGuestBanned: options.onGuestBanned,
            redirect: options.redirect
        });
        return controller.start().then(function (ok) {
            return { handled: true, ok: !!ok, controller: controller };
        });
    }

    /**
     * 都度QR（sessionId+PIN）接続で人数未確定のとき、固定QRと同型の人数 UI を表示する。
     * @returns {Promise<{ handled: boolean, ok?: boolean, controller?: object }>}
     */
    function tryBootstrapSessionPeoplesEntry(options) {
        options = options || {};
        var sessionId = String(options.sessionId || '').trim();
        var pin = String(options.pin || '').trim().toUpperCase();
        if (!sessionId || !pin) {
            return Promise.resolve({ handled: false });
        }
        if (!options.root || !options.sessionController) {
            return Promise.reject(new Error('root and sessionController are required'));
        }
        var shop = options.shop || null;
        var shopId = shop && shop.shopId != null
            ? requireShopPublicId(shop.shopId)
            : requireShopPublicId(options.shopId);
        var tableNo = Number(options.tableNo || options.tableNumber || 0);
        var controller = createFixedQrEntryController({
            root: options.root,
            sessionController: options.sessionController,
            orderSdk: options.orderSdk,
            apiBaseUrl: options.apiBaseUrl || inferGuestApiBase(),
            shop: shop,
            credentials: {
                shopId: shopId,
                sessionId: sessionId,
                pin: pin,
                tableNo: tableNo
            },
            onConnected: options.onConnected,
            onGuestBanned: options.onGuestBanned,
            redirect: false
        });
        return controller.start().then(function (ok) {
            return { handled: true, ok: !!ok, controller: controller };
        });
    }

    function resolveFixedQrShopId(payload, options) {
        var shopId = payload && normalizeShopPublicId(payload.shopId);
        if (!shopId && options && options.shopId != null) {
            shopId = normalizeShopPublicId(options.shopId);
        }
        if (shopId) {
            return Promise.resolve(shopId);
        }
        var slug = (payload && payload.pathShopSlug) || '';
        if (!slug) {
            return Promise.reject(new Error('店舗情報がありません。店舗のQRから開いてください。'));
        }
        return fetchPublicShop(slug, options && options.apiBase).then(function (shop) {
            if (!shop || !shop.shopId) {
                throw new Error('店舗情報を取得できませんでした');
            }
            return normalizeShopPublicId(shop.shopId);
        });
    }

    function connectFromGuestQrText(sessionController, text, options) {
        options = options || {};
        var sdk = options.orderSdk || (sessionController && sessionController.sdk);
        var payload = parseGuestQrText(text);
        if (payload.kind === 'join') {
            if (!payload.joinToken) {
                return Promise.reject(new Error('合流トークンが不正です'));
            }
            if (options.pin) {
                return sessionController.connectViaJoinToken(payload.joinToken, options.pin, options.shopId);
            }
            return Promise.resolve({
                kind: 'join',
                joinToken: payload.joinToken,
                needsPin: true
            });
        }
        if (payload.kind === 'fixed') {
            if (options.peoples != null && Number(options.peoples) > 0) {
                return resolveFixedQrShopId(payload, options).then(function (resolvedShopId) {
                    return openFixedQrSessionAndConnect(sessionController, {
                        shopId: requireShopPublicId(resolvedShopId),
                        tableNo: payload.tableNo,
                        passPhrase: payload.passPhrase,
                        peoples: Number(options.peoples)
                    }, options);
                });
            }
            return Promise.resolve({
                kind: 'fixed',
                needsPeoples: true,
                credentials: payload
            });
        }
        if (payload.kind === 'credentials') {
            var scopeShopId = options.shopId != null ? options.shopId : null;
            return sessionController.connect(payload.sessionId, payload.pin, scopeShopId).then(function (detail) {
                if (typeof options.onConnected === 'function') {
                    return options.onConnected(detail, payload.pin);
                }
                if (options.redirect !== false && typeof location !== 'undefined') {
                    var target = buildConnectShopUrl(detail, detail.sessionId, payload.pin);
                    if (target) {
                        guestLocationReplace(target);
                    }
                }
                return detail;
            });
        }
        return Promise.reject(new Error('MasterOrder用のQRではありません'));
    }

    function guestQrDecodeSupported() {
        var mod = global.MasterOrderGuestQrScannerSdk;
        if (mod && typeof mod.guestQrDecodeSupported === 'function') {
            return mod.guestQrDecodeSupported();
        }
        return typeof BarcodeDetector !== 'undefined' || typeof global.jsQR === 'function';
    }

    function guestQrCameraSupported() {
        var mod = global.MasterOrderGuestQrScannerSdk;
        if (mod && typeof mod.guestQrCameraSupported === 'function') {
            return mod.guestQrCameraSupported();
        }
        return !!(typeof navigator !== 'undefined'
            && navigator.mediaDevices
            && typeof navigator.mediaDevices.getUserMedia === 'function');
    }

    var GUEST_QR_SCANNER_SCRIPT = '/js/sdk/guest-qr-scanner-sdk.js?v=guest-qr-scanner-v1';
    var GUEST_JSQR_SCRIPT = '/js/vendor/jsqr.js';
    var guestQrScannerModulePromise = null;

    function loadGuestScriptOnce(src) {
        return new Promise(function (resolve, reject) {
            if (typeof document === 'undefined') {
                reject(new Error('document is required to load ' + src));
                return;
            }
            var existing = document.querySelector('script[data-masterorder-src="' + src + '"]');
            if (existing) {
                if (existing.getAttribute('data-masterorder-loaded') === '1') {
                    resolve();
                    return;
                }
                existing.addEventListener('load', function () { resolve(); });
                existing.addEventListener('error', function () {
                    reject(new Error('Failed to load ' + src));
                });
                return;
            }
            var script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.setAttribute('data-cfasync', 'false');
            script.setAttribute('data-masterorder-src', src);
            script.onload = function () {
                script.setAttribute('data-masterorder-loaded', '1');
                resolve();
            };
            script.onerror = function () {
                reject(new Error('Failed to load ' + src));
            };
            document.head.appendChild(script);
        });
    }

    function ensureGuestQrScannerModule() {
        if (global.MasterOrderGuestQrScannerSdk
            && typeof global.MasterOrderGuestQrScannerSdk.createGuestQrScanner === 'function') {
            return Promise.resolve(global.MasterOrderGuestQrScannerSdk);
        }
        if (guestQrScannerModulePromise) {
            return guestQrScannerModulePromise;
        }
        guestQrScannerModulePromise = Promise.resolve()
            .then(function () {
                if (typeof global.jsQR === 'function' || typeof BarcodeDetector !== 'undefined') {
                    return null;
                }
                return loadGuestScriptOnce(GUEST_JSQR_SCRIPT);
            })
            .then(function () {
                if (global.MasterOrderGuestQrScannerSdk
                    && typeof global.MasterOrderGuestQrScannerSdk.createGuestQrScanner === 'function') {
                    return global.MasterOrderGuestQrScannerSdk;
                }
                return loadGuestScriptOnce(GUEST_QR_SCANNER_SCRIPT).then(function () {
                    if (!global.MasterOrderGuestQrScannerSdk
                        || typeof global.MasterOrderGuestQrScannerSdk.createGuestQrScanner !== 'function') {
                        throw new Error('guest-qr-scanner-sdk.js failed to register');
                    }
                    return global.MasterOrderGuestQrScannerSdk;
                });
            })
            .catch(function (err) {
                guestQrScannerModulePromise = null;
                throw err;
            });
        return guestQrScannerModulePromise;
    }

    /**
     * 来客 QR スキャナ（遅延ロード: jsqr + guest-qr-scanner-sdk）
     * start / scanFile 時にモジュールを読み込む。
     */
    function createGuestQrScanner(options) {
        var inner = null;
        var innerPromise = null;

        function ensureInner() {
            if (inner) {
                return Promise.resolve(inner);
            }
            if (!innerPromise) {
                innerPromise = ensureGuestQrScannerModule().then(function (mod) {
                    inner = mod.createGuestQrScanner(options || {});
                    return inner;
                });
            }
            return innerPromise;
        }

        return {
            start: function () {
                return ensureInner().then(function (scanner) {
                    return scanner.start();
                });
            },
            stop: function () {
                if (inner && typeof inner.stop === 'function') {
                    inner.stop();
                }
            },
            scanFile: function (file) {
                return ensureInner().then(function (scanner) {
                    return scanner.scanFile(file);
                });
            },
            supportsCamera: guestQrCameraSupported,
            supportsDecode: guestQrDecodeSupported,
            ensureLoaded: ensureInner
        };
    }

    function createOrderSessionController(options) {
        options = options || {};
        const orderSdk = options.orderSdk || createOrderSdk({ apiBaseUrl: options.apiBaseUrl });
        const monitor = orderSdk.createSessionResyncMonitor({
            onSessionUpdate: options.onSessionUpdate
        });
        const guestFirestore = options.guestFirestore || null;

        function resolveControllerShopId(shopId) {
            if (shopId != null && shopId !== '') {
                return shopId;
            }
            if (options.shopId != null && options.shopId !== '') {
                return options.shopId;
            }
            if (typeof options.getShopId === 'function') {
                return options.getShopId();
            }
            return null;
        }

        function shopIdMatchesHint(detailShopId, shopIdHint) {
            if (shopIdHint == null || shopIdHint === '') {
                return true;
            }
            if (detailShopId == null || detailShopId === '') {
                return true;
            }
            var normDetail = normalizeShopPublicId(detailShopId);
            var normHint = normalizeShopPublicId(shopIdHint);
            if (normDetail && normHint && normDetail === normHint) {
                return true;
            }
            return false;
        }
        let guestFirestoreUnsub = null;
        let lastGuestDetail = null;
        var SESSION_INACTIVE_GRACE_MS = 10000;
        var sessionConnectCompletedAt = 0;
        var lastSessionActivityAt = 0;
        var guestBannedEmitted = false;
        var defenseProbeInFlight = null;
        var DEFENSE_PROBE_MIN_INTERVAL_MS = 30000;
        var lastDefenseProbeAt = 0;

        function touchSessionActivity() {
            lastSessionActivityAt = Date.now();
        }

        function withinSessionInactiveGrace() {
            var now = Date.now();
            if (sessionConnectCompletedAt && (now - sessionConnectCompletedAt) < SESSION_INACTIVE_GRACE_MS) {
                return true;
            }
            return lastSessionActivityAt > 0 && (now - lastSessionActivityAt) < SESSION_INACTIVE_GRACE_MS;
        }

        function emitGuestBanned(err) {
            if (guestBannedEmitted) {
                return true;
            }
            guestBannedEmitted = true;
            clearSessionCredentials();
            stop();
            if (typeof options.onGuestBanned === 'function') {
                try {
                    options.onGuestBanned(err);
                } catch (callbackErr) {
                    if (typeof console !== 'undefined' && console.error) {
                        console.error('[MasterOrder] onGuestBanned failed:', callbackErr);
                    }
                }
            }
            return true;
        }

        function rejectIfGuestBanned(err) {
            if (isGuestBannedError(err)) {
                emitGuestBanned(err);
            }
            return Promise.reject(err);
        }

        function stopGuestFirestoreWatch() {
            if (guestFirestoreUnsub) {
                guestFirestoreUnsub();
                guestFirestoreUnsub = null;
            }
            lastGuestDetail = null;
        }

        function applyDetail(detail) {
            var meta = {
                shopId: detail.shopId,
                shopSlug: resolveShopPublicSlug(detail) || resolveConnectSlug(detail)
            };
            if (meta.shopSlug && String(meta.shopSlug).indexOf('shop-') === 0) {
                meta.shopSlug = '';
            }
            saveSessionCredentials(detail.sessionId, detail.pin, meta);
            stripJoinCredentialsFromUrl();
            touchSessionActivity();
            lastGuestDetail = detail;
            if (typeof options.onSessionUpdate === 'function') {
                options.onSessionUpdate(detail);
            }
            return detail;
        }

        function emitSessionDetail(detail) {
            if (!detail) {
                return detail;
            }
            lastGuestDetail = detail;
            if (typeof options.onSessionUpdate === 'function') {
                options.onSessionUpdate(detail);
            }
            return detail;
        }

        function mapFirestoreOrdersToHistory(orders) {
            return mapOrderHistory(Array.isArray(orders) ? orders : [], options);
        }

        function startGuestFirestoreWatch(detail) {
            if (!guestFirestore || !guestFirestore.enabled || !guestFirestore.sdk) {
                return false;
            }
            if (!detail || !detail.shopId || !detail.sessionId) {
                return false;
            }
            stopGuestFirestoreWatch();
            lastGuestDetail = detail;
            guestFirestoreUnsub = guestFirestore.sdk.watchSession(
                detail.shopId,
                detail.sessionId,
                {
                    onOrders: function (orders) {
                        if (!lastGuestDetail) {
                            return;
                        }
                        touchSessionActivity();
                        var incoming = mapFirestoreOrdersToHistory(orders);
                        var mergedHistory = mergeOrderHistoryWithPending(
                            lastGuestDetail.orderHistory,
                            incoming
                        );
                        var updated = Object.assign({}, lastGuestDetail, {
                            orderHistory: mergedHistory
                        });
                        emitSessionDetail(updated);
                    },
                    onSessionInactive: function () {
                        if (withinSessionInactiveGrace()) {
                            if (typeof console !== 'undefined' && console.warn) {
                                console.warn(
                                    '[GuestFirestore] session inactive ignored (activity grace)',
                                    detail && detail.sessionId
                                );
                            }
                            return;
                        }
                        if (typeof options.onSessionEnded === 'function') {
                            options.onSessionEnded(lastGuestDetail);
                        }
                    },
                    onError: function (err) {
                        if (typeof options.onGuestFirestoreError === 'function') {
                            options.onGuestFirestoreError(err);
                        }
                    }
                }
            );
            return true;
        }

        function startRealtimeAfterConnect(detail, shopId) {
            sessionConnectCompletedAt = Date.now();
            var canWatch = guestFirestore && guestFirestore.enabled && guestFirestore.sdk
                && detail.shopId && detail.sessionId
                && guestFirestore.auth && guestFirestore.auth.currentUser;
            if (canWatch && startGuestFirestoreWatch(detail)) {
                monitor.stop();
                return;
            }
            stopGuestFirestoreWatch();
            monitor.start(detail.sessionId, detail.pin, detail.shopId || shopId);
        }

        function afterConnectDetail(detail, shopId) {
            detail = enrichConnectDetailPublicShopId(detail, shopId);
            // メニュー bundle は pcr / catalogGeneration で更新検知（接続のたびに破棄しない）
            // メニュー表示を Firebase サインインで待たせない。先に apply → 裏で auth + watch。
            // connect 連打を避けるため、ポーリングは Firebase 可否が分かるまで開始しない。
            guestBannedEmitted = false;
            sessionConnectCompletedAt = Date.now();
            var applied = applyDetail(detail);

            var historyFill = typeof orderSdk.fillConnectOrderHistory === 'function'
                ? orderSdk.fillConnectOrderHistory(detail, detail.sessionId, detail.pin, detail.shopId || shopId)
                    .then(function (filled) {
                        if (!filled) {
                            return detail;
                        }
                        var currentHistory = lastGuestDetail && lastGuestDetail.orderHistory;
                        if (filled.orderHistory && filled.orderHistory.length) {
                            filled = Object.assign({}, filled, {
                                orderHistory: mergeOrderHistoryWithPending(
                                    currentHistory,
                                    filled.orderHistory
                                )
                            });
                        }
                        emitSessionDetail(filled);
                        return filled;
                    })
                    .catch(function () {
                        return detail;
                    })
                : Promise.resolve(detail);

            var firebaseReady = Promise.resolve(detail);
            if (guestFirestore && guestFirestore.enabled
                && detail.firebaseCustomToken
                && guestFirestore.auth
                && guestFirestore.sdk
                && typeof guestFirestore.sdk.signInWithCustomToken === 'function') {
                firebaseReady = guestFirestore.sdk.signInWithCustomToken(
                    guestFirestore.auth,
                    detail.firebaseCustomToken
                ).then(function () {
                    return detail;
                }).catch(function (err) {
                    if (typeof console !== 'undefined' && console.warn) {
                        console.warn('[GuestFirestore] custom token sign-in failed; falling back to polling', err);
                    }
                    return detail;
                });
            }

            void Promise.all([firebaseReady, historyFill]).then(function (parts) {
                var d = parts[0] || detail;
                startRealtimeAfterConnect(d, shopId);
            });

            return applied;
        }

        function connect(sessionId, pin, shopId) {
            const normalizedPin = String(pin || '').trim().toUpperCase();
            var resolvedShopId = resolveControllerShopId(shopId);
            if (resolvedShopId == null || resolvedShopId === '') {
                const creds = loadSessionCredentials();
                if (creds.shopId != null && creds.shopId !== '') {
                    resolvedShopId = creds.shopId;
                }
            }
            if (resolvedShopId == null || resolvedShopId === '') {
                return orderSdk.connectSessionDetail(sessionId, normalizedPin, null)
                    .then(function (detail) {
                        if (!detail || detail.shopId == null || detail.shopId === '') {
                            return Promise.reject(new Error('店舗情報がありません。店舗のQRから開いてください。'));
                        }
                        return afterConnectDetail(detail, detail.shopId);
                    })
                    .catch(rejectIfGuestBanned);
            }
            return orderSdk.connectSessionDetail(sessionId, normalizedPin, resolvedShopId)
                .then(function (detail) {
                    if (!shopIdMatchesHint(detail.shopId, resolvedShopId)) {
                        clearSessionCredentials();
                        return Promise.reject(Object.assign(
                            new Error(GUEST_CONNECT_CREDENTIALS_WRONG),
                            { status: 404 }));
                    }
                    return afterConnectDetail(detail, resolvedShopId);
                })
                .catch(rejectIfGuestBanned);
        }

        function connectViaJoinToken(joinToken, pin, shopId) {
            const token = String(joinToken || '').trim();
            const normalizedPin = normalizeJoinPin(pin);
            if (!token) {
                return Promise.reject(new Error('合流トークンが必要です'));
            }
            if (!normalizedPin) {
                return Promise.reject(new Error('合流には PIN が必要です'));
            }
            const resolvedShopId = resolveControllerShopId(shopId);
            if (resolvedShopId == null || resolvedShopId === '') {
                return Promise.reject(new Error('店舗情報がありません。店舗のQRから開いてください。'));
            }
            return orderSdk.connectSessionViaJoinToken(token, normalizedPin, resolvedShopId)
                .then(function (detail) {
                    if (!shopIdMatchesHint(detail.shopId, resolvedShopId)) {
                        clearSessionCredentials();
                        return Promise.reject(Object.assign(
                            new Error(GUEST_CONNECT_CREDENTIALS_WRONG),
                            { status: 404 }));
                    }
                    return afterConnectDetail(detail, resolvedShopId);
                })
                .catch(rejectIfGuestBanned);
        }

        function credentialsMatchCurrentShop(creds) {
            if (!creds || !creds.sessionId || !creds.pin) {
                return false;
            }
            const resolvedShopId = resolveControllerShopId(null);
            const resolvedShopSlug = typeof options.getShopSlug === 'function'
                ? String(options.getShopSlug() || '').trim()
                : '';
            if (resolvedShopId != null && resolvedShopId !== '') {
                if (creds.shopId != null && normalizeShopPublicId(creds.shopId) !== normalizeShopPublicId(resolvedShopId)) {
                    return false;
                }
                if (creds.shopId == null && (resolvedShopSlug || creds.shopSlug)) {
                    return false;
                }
            }
            if (resolvedShopSlug) {
                if (creds.shopSlug && !guestSlugMatches(resolvedShopSlug, creds.shopSlug)) {
                    return false;
                }
                if (!creds.shopSlug && creds.shopId == null) {
                    return false;
                }
            }
            return true;
        }

        function tryAutoReconnect() {
            const creds = loadSessionCredentials();
            if (!credentialsMatchCurrentShop(creds)) {
                if (creds.sessionId || creds.pin) {
                    clearSessionCredentials();
                }
                return Promise.resolve(null);
            }
            var resolvedShopId = resolveControllerShopId(null);
            if ((resolvedShopId == null || resolvedShopId === '')
                    && creds.shopId != null && creds.shopId !== '') {
                resolvedShopId = creds.shopId;
            }
            if (resolvedShopId == null || resolvedShopId === '') {
                if (!creds.sessionId || !creds.pin) {
                    return Promise.resolve(null);
                }
                return connect(creds.sessionId, creds.pin, null).catch(function (err) {
                    if (isGuestBannedError(err)) {
                        return Promise.reject(err);
                    }
                    clearSessionCredentials();
                    return null;
                });
            }
            return connect(creds.sessionId, creds.pin, resolvedShopId).catch(function (err) {
                if (isGuestBannedError(err)) {
                    return Promise.reject(err);
                }
                clearSessionCredentials();
                return null;
            });
        }

        function resync(options) {
            options = options || {};
            if (!options.forceServer && guestFirestore && guestFirestore.enabled && guestFirestoreUnsub) {
                return Promise.resolve(lastGuestDetail);
            }
            if (options.forceOrderHistory && lastGuestDetail && lastGuestDetail.sessionId) {
                invalidateGuestOrderHistoryCache(lastGuestDetail.sessionId);
            }
            return monitor.resync().then(function (detail) {
                if (!detail) {
                    return detail;
                }
                var merged = Object.assign({}, detail, {
                    orderHistory: mergeOrderHistoryWithPending(
                        lastGuestDetail && lastGuestDetail.orderHistory,
                        detail.orderHistory
                    )
                });
                if (!options.forceOrderHistory) {
                    emitSessionDetail(merged);
                    return merged;
                }
                if (typeof orderSdk.fillConnectOrderHistory !== 'function') {
                    emitSessionDetail(merged);
                    return merged;
                }
                return orderSdk.fillConnectOrderHistory(
                    detail,
                    detail.sessionId,
                    detail.pin,
                    detail.shopId,
                    { forceRefresh: true }
                ).then(function (filled) {
                    if (!filled) {
                        return detail;
                    }
                    var mergedFilled = Object.assign({}, filled, {
                        orderHistory: mergeOrderHistoryWithPending(
                            lastGuestDetail && lastGuestDetail.orderHistory,
                            filled.orderHistory
                        )
                    });
                    emitSessionDetail(mergedFilled);
                    lastGuestDetail = mergedFilled;
                    return mergedFilled;
                });
            }).catch(rejectIfGuestBanned);
        }

        /**
         * Firestore 監視中でも connect を叩き、BAN / IP 防衛を再確認する。
         * 認識できたら onGuestBanned でセッションから叩き出す。
         */
        function probeDefense(options) {
            options = options || {};
            if (guestBannedEmitted) {
                return Promise.resolve(null);
            }
            var detail = lastGuestDetail;
            if (!detail || !detail.sessionId || !detail.pin) {
                return Promise.resolve(null);
            }
            var now = Date.now();
            if (!options.force
                    && lastDefenseProbeAt
                    && (now - lastDefenseProbeAt) < DEFENSE_PROBE_MIN_INTERVAL_MS) {
                return defenseProbeInFlight || Promise.resolve(null);
            }
            if (defenseProbeInFlight) {
                return defenseProbeInFlight;
            }
            lastDefenseProbeAt = now;
            var shopId = detail.shopId != null && detail.shopId !== ''
                ? detail.shopId
                : resolveControllerShopId(null);
            defenseProbeInFlight = orderSdk.connectSessionDetail(
                detail.sessionId,
                detail.pin,
                shopId
            ).then(function (fresh) {
                defenseProbeInFlight = null;
                touchSessionActivity();
                if (fresh) {
                    emitSessionDetail(Object.assign({}, detail, fresh, {
                        orderHistory: mergeOrderHistoryWithPending(
                            detail.orderHistory,
                            fresh.orderHistory
                        )
                    }));
                }
                return fresh;
            }).catch(function (err) {
                defenseProbeInFlight = null;
                if (isGuestBannedError(err)) {
                    emitGuestBanned(err);
                    return null;
                }
                return null;
            });
            return defenseProbeInFlight;
        }

        function stop() {
            monitor.stop();
            stopGuestFirestoreWatch();
        }

        return {
            connect: connect,
            connectViaJoinToken: connectViaJoinToken,
            tryAutoReconnect: tryAutoReconnect,
            resync: resync,
            probeDefense: probeDefense,
            stop: stop,
            sdk: orderSdk,
            monitor: monitor
        };
    }

    var CONNECT_FAIL_I18N_FALLBACKS = {
        connectFailPrefix: '接続失敗: ',
        connectFailMenuCountdown: '{seconds}秒後にメニューへ戻ります',
        connectFailGoMenuBtn: 'メニューへ移動',
        connectFailMenuRedirecting: 'メニューへ移動しています...'
    };

    function resolveConnectFailureTranslate(options) {
        var custom = options && typeof options.translate === 'function' ? options.translate : null;
        var ui = global.MasterOrderGuestUiI18n;
        var lang = 'ja';
        if (options && options.lang) {
            lang = options.lang;
        } else if (global.MasterOrderSdk && typeof global.MasterOrderSdk.getGuestMenuLang === 'function') {
            lang = global.MasterOrderSdk.getGuestMenuLang();
        } else if (ui && typeof ui.normalizeLang === 'function') {
            lang = ui.normalizeLang(null);
        }
        return function (key, vars) {
            if (custom) {
                return custom(key, vars);
            }
            if (ui) {
                return vars ? ui.format(key, lang, vars) : ui.t(key, lang);
            }
            var text = CONNECT_FAIL_I18N_FALLBACKS[key] || key;
            if (!vars) {
                return text;
            }
            return String(text).replace(/\{(\w+)\}/g, function (_m, name) {
                return vars[name] != null ? String(vars[name]) : '';
            });
        };
    }

    function formatConnectFailureError(error, translate) {
        var msg = formatGuestConnectError(error);
        if (msg === GUEST_CONNECT_CREDENTIALS_WRONG) {
            return msg;
        }
        return translate('connectFailPrefix') + msg;
    }

    /**
     * セッション接続失敗時の復帰 UI（カウントダウン + メニューへ移動ボタン）。
     * @param {{
     *   hostElement: Element,
     *   error?: *,
     *   seconds?: number,
     *   onGoToMenu: function,
     *   translate?: function(string, object=): string,
     *   lang?: string
     * }} options
     * @returns {{ cancel: function, goNow: function }}
     */
    function createSessionConnectFailureRecovery(options) {
        options = options || {};
        var hostElement = options.hostElement;
        if (!hostElement || typeof hostElement.appendChild !== 'function') {
            throw new Error('hostElement is required for createSessionConnectFailureRecovery');
        }
        var seconds = options.seconds != null ? Math.floor(Number(options.seconds)) : 10;
        if (!isFinite(seconds) || seconds < 0) {
            seconds = 10;
        }
        var onGoToMenu = typeof options.onGoToMenu === 'function' ? options.onGoToMenu : function () {};
        var translate = resolveConnectFailureTranslate(options);
        var remaining = seconds;
        var timerId = null;
        var done = false;

        hostElement.className = 'status-msg connect-fail-recovery-host';
        if (typeof hostElement.replaceChildren === 'function') {
            hostElement.replaceChildren();
        } else {
            hostElement.textContent = '';
        }

        var root = global.document.createElement('div');
        root.className = 'connect-fail-recovery';

        var errorEl = global.document.createElement('p');
        errorEl.className = 'connect-fail-recovery__error error';
        errorEl.textContent = formatConnectFailureError(options.error, translate);

        var countdownEl = global.document.createElement('p');
        countdownEl.className = 'connect-fail-recovery__countdown';

        var btn = global.document.createElement('button');
        btn.type = 'button';
        btn.className = 'connect-fail-recovery__btn btn-connect';
        btn.textContent = translate('connectFailGoMenuBtn');

        function updateCountdown() {
            countdownEl.textContent = translate('connectFailMenuCountdown', { seconds: remaining });
        }

        function finish() {
            if (done) {
                return;
            }
            done = true;
            if (timerId != null) {
                global.clearInterval(timerId);
                timerId = null;
            }
            btn.disabled = true;
            countdownEl.textContent = translate('connectFailMenuRedirecting');
            try {
                onGoToMenu();
            } catch (e) {
                if (typeof console !== 'undefined' && console.error) {
                    console.error('[MasterOrder] session connect failure recovery onGoToMenu failed:', e);
                }
            }
        }

        function cancel() {
            if (done) {
                return;
            }
            done = true;
            if (timerId != null) {
                global.clearInterval(timerId);
                timerId = null;
            }
        }

        btn.addEventListener('click', function () {
            finish();
        });

        root.appendChild(errorEl);
        root.appendChild(countdownEl);
        root.appendChild(btn);
        hostElement.appendChild(root);
        updateCountdown();

        if (remaining <= 0) {
            finish();
        } else {
            timerId = global.setInterval(function () {
                remaining -= 1;
                if (remaining <= 0) {
                    finish();
                    return;
                }
                updateCountdown();
            }, 1000);
        }

        return {
            cancel: cancel,
            goNow: finish
        };
    }

    var orderApi = {
        VERSION: SDK_VERSION,
        createOrderSdk: createOrderSdk,
        createOrderSessionController: createOrderSessionController,
        createSessionConnectFailureRecovery: createSessionConnectFailureRecovery,
        formatOrderTime: formatOrderTime,
        mapOrderHistory: mapOrderHistory,
        parseSessionConnect: parseSessionConnect,
        createLocalOrderHistoryEntry: createLocalOrderHistoryEntry,
        mergeOrderHistoryWithPending: mergeOrderHistoryWithPending,
        resolveOrderHistoryDisplayTotal: resolveOrderHistoryDisplayTotal,
        normalizeOrderHistoryItem: normalizeOrderHistoryItem,
        saveSessionCredentials: saveSessionCredentials,
        loadSessionCredentials: loadSessionCredentials,
        loadGuestReconnectCredentials: loadGuestReconnectCredentials,
        clearSessionCredentials: clearSessionCredentials,
        parseJoinCredentialsFromLocation: parseJoinCredentialsFromLocation,
        resolveGuestConnectCredentials: resolveGuestConnectCredentials,
        parseJoinTokenFromLocation: parseJoinTokenFromLocation,
        stashJoinCredentialsForRoute: stashJoinCredentialsForRoute,
        isOnCorrectGuestTemplate: isOnCorrectGuestTemplate,
        isSameGuestNavigationTarget: isSameGuestNavigationTarget,
        buildOrderJoinUrl: buildOrderJoinUrl,
        buildOrderJoinUrlFromToken: buildOrderJoinUrlFromToken,
        buildFixedQrConnectUrl: buildFixedQrConnectUrl,
        buildConnectEntryUrl: buildConnectEntryUrl,
        buildGuestSessionShareConnectUrl: buildGuestSessionShareConnectUrl,
        parseFixedQrCredentialsFromSearch: parseFixedQrCredentialsFromSearch,
        stripJoinCredentialsFromUrl: stripJoinCredentialsFromUrl,
        normalizeRecommendMenusResponse: core.normalizeRecommendMenusResponse,
        sumGuestOrderMenuQuantities: sumGuestOrderMenuQuantities,
        validateGuestOrderSubmission: validateGuestOrderSubmission,
        buildGuestOrderSubmitItems: buildGuestOrderSubmitItems,
        validateCartToppingSelections: validateCartToppingSelections,
        formatOrderSendStatusLabel: formatOrderSendStatusLabel,
        ensureGuestClientId: ensureGuestClientId,
        generateRequestId: generateRequestId,
        generateOrderIdempotencyKey: generateOrderIdempotencyKey,
        parseGuestOrderSubmitBody: parseGuestOrderSubmitBody,
        isGuestOrderSubmitInFlight: isGuestOrderSubmitInFlight,
        ORDER_SEND_STATUS: ORDER_SEND_STATUS,
        MAX_MENU_UNITS_PER_GUEST_ORDER: MAX_MENU_UNITS_PER_GUEST_ORDER,
        guestUrl: guestUrlApi,
        parseGuestRoute: parseGuestRoute,
        isShopScopedGuestRoute: isShopScopedGuestRoute,
        guestRouteShopSlug: guestRouteShopSlug,
        buildShopScopedScanPath: buildShopScopedScanPath,
        buildShopScopedGuestPath: buildShopScopedGuestPath,
        buildShopScopedGuestUrl: buildShopScopedGuestUrl,
        buildShopScopedScanUrl: buildShopScopedScanUrl,
        GUEST_SHOP_PATH_PREFIX: GUEST_SHOP_PATH_PREFIX,
        buildShopPublicUrl: buildShopPublicUrl,
        resolveShopPublicSlug: resolveShopPublicSlug,
        guestSlugMatches: guestSlugMatches,
        stripLegacyMoQueryParams: stripLegacyMoQueryParams,
        isFixedQrConnectEntryPath: isFixedQrConnectEntryPath,
        readFixedQrParamsFromLocation: readFixedQrParamsFromLocation,
        tryBootstrapFixedQrTableEntry: tryBootstrapFixedQrTableEntry,
        tryBootstrapSessionPeoplesEntry: tryBootstrapSessionPeoplesEntry,
        confirmSessionPeoplesAndConnect: confirmSessionPeoplesAndConnect,
        buildConnectShopUrl: buildConnectShopUrl,
        guestLocationReplace: guestLocationReplace,
        enrichConnectDetailWithOpenMeta: enrichConnectDetailWithOpenMeta,
        connectSlugsMatch: connectSlugsMatch,
        fetchPublicShop: fetchPublicShop,
        fetchPublicShopById: fetchPublicShopById,
        applyGuestBranding: applyGuestBranding,
        applyGuestShopBanner: applyGuestShopBanner,
        resolveGuestIsFree: resolveGuestIsFree,
        shouldShowGuestAds: shouldShowGuestAds,
        guestEntryShellKey: guestEntryShellKey,
        navigateToTemplateIfNeeded: navigateToTemplateIfNeeded,
        parseGuestQrText: parseGuestQrText,
        connectFromGuestQrText: connectFromGuestQrText,
        createFixedQrEntryController: createFixedQrEntryController,
        clearGuestEntryBootState: clearGuestEntryBootState,
        openFixedQrSessionAndConnect: openFixedQrSessionAndConnect,
        parseFixedQrOpenFailure: parseFixedQrOpenFailure,
        DEFAULT_FIXED_QR_PEOPLES_OPTIONS: DEFAULT_FIXED_QR_PEOPLES_OPTIONS,
        createGuestMenuPricingRefreshScheduler: createGuestMenuPricingRefreshScheduler,
        createGuestMenuLoader: createGuestMenuLoader,
        createGuestMenuLoaderForState: createGuestMenuLoaderForState,
        mergeGuestMenuLoadResult: mergeGuestMenuLoadResult,
        GUEST_MENU_DEFAULT_CATEGORY: GUEST_MENU_DEFAULT_CATEGORY,
        GUEST_MENU_LOAD_STATE: GUEST_MENU_LOAD_STATE,
        filterGuestMenusByKeyword: filterGuestMenusByKeyword,
        extractGuestMenuCategories: extractGuestMenuCategories,
        isGuestTimeSaleCategory: isGuestTimeSaleCategory,
        guestMenuSaleCategoryLabel: guestMenuSaleCategoryLabel,
        filterGuestMenusByCategory: filterGuestMenusByCategory,
        filterGuestMenusByAllergies: filterGuestMenusByAllergies,
        getGuestHiddenAllergies: getGuestHiddenAllergies,
        setGuestHiddenAllergies: setGuestHiddenAllergies,
        guestAllergyLabel: guestAllergyLabel,
        guestMenuAllergyCodes: guestMenuAllergyCodes,
        get GUEST_ALLERGY_OPTIONS() {
            return guestAllergyOptions(getGuestMenuLang());
        },
        guestAllergyOptions: guestAllergyOptions,
        resolveGuestMenuActiveCategory: resolveGuestMenuActiveCategory,
        isGuestMenuReadyForOrder: isGuestMenuReadyForOrder,
        canGuestAddMenuToCart: canGuestAddMenuToCart,
        formatGuestMenuLoadError: formatGuestMenuLoadError,
        guestMenuLoadErrorMessage: guestMenuLoadErrorMessage,
        guestActionErrorMessage: guestActionErrorMessage,
        classifyGuestLoadErrorKey: classifyGuestLoadErrorKey,
        guestMenuCategoryLabel: guestMenuCategoryLabel,
        createGuestQrScanner: createGuestQrScanner,
        guestQrCameraSupported: guestQrCameraSupported,
        guestQrDecodeSupported: guestQrDecodeSupported,
        buildProfileFullName: core.buildProfileFullName,
        resolveDisplayFamilyName: core.resolveDisplayFamilyName,
        normalizeUserProfile: core.normalizeUserProfile,
        normalizeGuestMenu: normalizeGuestMenu,
        isGuestMenuSoldOut: isGuestMenuSoldOut,
        filterGuestMenusHideSoldOut: filterGuestMenusHideSoldOut,
        stripGuestInventoryForBrowse: stripGuestInventoryForBrowse,
        getGuestMenuLang: getGuestMenuLang,
        setGuestMenuLang: setGuestMenuLang,
        isGuestMenuLangExplicit: isGuestMenuLangExplicit,
        normalizeGuestMenuLang: normalizeGuestMenuLang,
        guestMenuLanguageLabel: guestMenuLanguageLabel,
        shouldPromptGuestMenuLanguage: shouldPromptGuestMenuLanguage,
        GUEST_MENU_LANG_DEFAULT: GUEST_MENU_LANG_DEFAULT,
        GUEST_MENU_LANG_LABELS: GUEST_MENU_LANG_LABELS,
        resolveGuestMenuDisplayName: resolveGuestMenuDisplayName,
        resolveGuestMenuDisplayPrice: resolveGuestMenuDisplayPrice,
        resolveGuestMenuOrderFloorPrice: resolveGuestMenuOrderFloorPrice,
        guestTimeSaleCategoryLabel: guestTimeSaleCategoryLabel,
        guestMenusForCartReconcile: guestMenusForCartReconcile,
        findGuestCartPriceDrift: findGuestCartPriceDrift,
        enrichGuestCartPriceDrift: enrichGuestCartPriceDrift,
        formatGuestCartPriceNotice: formatGuestCartPriceNotice,
        reconcileGuestCartPrices: reconcileGuestCartPrices,
        prepareGuestCartForOrderSubmit: prepareGuestCartForOrderSubmit,
        isGuestOrderPriceStaleError: isGuestOrderPriceStaleError,
        isGuestOrderSaleEndedError: isGuestOrderSaleEndedError,
        isGuestOrderStockError: isGuestOrderStockError,
        formatGuestOrderStockErrorMessage: formatGuestOrderStockErrorMessage,
        formatGuestConnectError: formatGuestConnectError,
        isGuestBannedError: isGuestBannedError,
        GUEST_CONNECT_CREDENTIALS_WRONG: GUEST_CONNECT_CREDENTIALS_WRONG,
        invalidateGuestMenuDeviceCaches: invalidateGuestMenuDeviceCaches,
        formatOrderHistoryLines: formatOrderHistoryLines,
        resolveSessionBillSplit: resolveSessionBillSplit,
        formatYenAmount: formatYenAmount,
        formatSessionBillSplitMessage: formatSessionBillSplitMessage
    };

    global.MasterOrderOrderSdk = orderApi;
    global.MasterOrderSdk = orderApi;
})(typeof window !== 'undefined' ? window : globalThis);
