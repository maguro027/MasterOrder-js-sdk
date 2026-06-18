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

    var SDK_VERSION = '1.2.0';

    const core = global.MasterOrderCoreSdk;
    if (!core) {
        throw new Error('MasterOrderCoreSdk is required before order-sdk.js');
    }
    const apiRouteRegistry = global.MasterOrderApiRoutes;
    if (!apiRouteRegistry || !apiRouteRegistry.paths || !apiRouteRegistry.paths.guest) {
        throw new Error('MasterOrderApiRoutes is required. Load api-routes.js before order-sdk.js');
    }
    const guestPaths = apiRouteRegistry.paths.guest;
    const authPaths = apiRouteRegistry.paths.auth || apiRouteRegistry.paths.staff;

    const DEFAULT_RESYNC_INTERVAL_MS = 20000;
    const HIDDEN_RESYNC_INTERVAL_MS = 120000;
    const MAX_MENU_UNITS_PER_GUEST_ORDER = 19;
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
    const GUEST_MENU_LANG_DEFAULT = 'ja';
    const GUEST_MENU_LANG_LABELS = {
        ja: '日本語',
        en: 'English',
        zh: '中文',
        ko: '한국어'
    };
    const GUEST_MENU_LANG_ORDER = ['ja', 'en', 'zh', 'ko'];
    const LEGACY_GUEST_QUERY_KEYS = [
        'mo_shop_id',
        'mo_shop_slug',
        'mo_template_key',
        'mo_view_only',
        'mo_logo_url',
        'mo_has_custom_css'
    ];

    function isFixedQrConnectEntryPath() {
        if (typeof location === 'undefined') {
            return false;
        }
        var path = String(location.pathname || '/').replace(/\/+$/, '') || '/';
        return path === '/connect';
    }

    function stripLegacyMoQueryParams(options) {
        if (typeof history === 'undefined' || typeof location === 'undefined') {
            return;
        }
        options = options || {};
        var params = new URLSearchParams(location.search || '');
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
        if (/<\/style|<script|javascript:|expression\s*\(|@import|url\s*\(\s*["']?data:/i.test(raw)) {
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
    var GUEST_JOIN_PIN_RE = /^[0-9]{7}$/;
    var GUEST_LEGACY_PIN_RE = /^[A-Z0-9]{4,8}$/;
    var SAFE_GUEST_RELATIVE_PATH_RE = /^\/[A-Za-z0-9][A-Za-z0-9._\-/]*$/;
    var SAFE_CONNECT_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._\-]*$/;
    var KNOWN_TEMPLATE_ENTRY_PATHS = {
        index2: '/index2.html',
        original: '/index.html',
        index: '/index.html',
        'cursor-1': '/OrderPages/Cursor-1/index.html',
        'premium-neon': '/OrderPages/Premium-Neon/index.html'
    };

    function sanitizeGuestSessionId(sessionId) {
        var id = String(sessionId || '').trim();
        return GUEST_SESSION_ID_RE.test(id) ? id : '';
    }

    function sanitizeGuestJoinPin(pin) {
        var normalized = normalizeJoinPin(pin);
        if (GUEST_JOIN_PIN_RE.test(normalized)) {
            return normalized;
        }
        if (GUEST_LEGACY_PIN_RE.test(normalized)) {
            return normalized;
        }
        return '';
    }

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
        return /^\d+$/.test(shopId) && /^\d+$/.test(tableNo) && passPhrase.length > 0 && passPhrase.length <= 128;
    }

    function safeLocationReplace(pathOrUrl) {
        if (typeof location === 'undefined') {
            return false;
        }
        var raw = String(pathOrUrl || '').trim();
        if (!raw) {
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

    function parseGuestRoute(pathname) {
        var parts = String(pathname || '/').split('/').filter(Boolean);
        if (parts.length === 0) {
            return { type: 'root' };
        }
        if (parts[0] === 'scan') {
            return { type: 'scan' };
        }
        if (parts[0] === 'connect') {
            if (parts.length >= 2) {
                try {
                    return { type: 'connect-shop', shopSlug: decodeURIComponent(parts[1]) };
                } catch (_) {
                    return { type: 'connect-shop', shopSlug: parts[1] };
                }
            }
            return { type: 'connect' };
        }
        if (parts[0] === 'view' && parts.length >= 2) {
            try {
                return { type: 'view-shop', shopSlug: decodeURIComponent(parts[1]) };
            } catch (_) {
                return { type: 'view-shop', shopSlug: parts[1] };
            }
        }
        return { type: 'other' };
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
        if (shopId != null && Number(shopId) > 0) {
            return 'shop-' + String(shopId);
        }
        return '';
    }

    function resolveConnectShopId(detail, shopIdHint) {
        if (!detail || typeof detail !== 'object') {
            detail = {};
        }
        var raw = detail.raw && typeof detail.raw === 'object' ? detail.raw : {};
        var shopId = detail.shopId != null ? detail.shopId : raw.shopId;
        if ((shopId == null || Number(shopId) <= 0) && shopIdHint != null && Number(shopIdHint) > 0) {
            shopId = Number(shopIdHint);
        }
        return shopId != null ? Number(shopId) : 0;
    }

    function connectPathSlug(detail, shopIdHint) {
        if (!detail || typeof detail !== 'object') {
            return '';
        }
        var shopId = resolveConnectShopId(detail, shopIdHint);
        if (shopId > 0) {
            return 'shop-' + String(shopId);
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

    /**
     * ゲスト接続後の店舗メニュー遷移。/connect/{slug} は従来どおり location.replace を使う
     * （safeLocationReplace だけだと非 ASCII スラッグ等で遷移に失敗することがある）。
     */
    function guestLocationReplace(pathOrUrl) {
        if (typeof location === 'undefined') {
            return false;
        }
        var raw = String(pathOrUrl || '').trim();
        if (!raw) {
            return false;
        }
        if (raw.charAt(0) === '/' && isConnectShopRelativePath(raw)) {
            location.replace(raw);
            return true;
        }
        return safeLocationReplace(raw);
    }

    function connectShopPath(shopSlug) {
        var slug = String(shopSlug || '').trim();
        if (!slug) {
            return '/scan';
        }
        return '/connect/' + encodeURIComponent(slug);
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
        if (shopId != null && Number(shopId) > 0 && route === 'shop-' + String(shopId)) {
            return true;
        }
        return false;
    }

    function guestCredentialsQuery(sessionId, pin) {
        stashJoinCredentialsForRoute(sessionId, pin);
        return '';
    }

    function templateEntryPathForShop(shop) {
        if (!shop) {
            return '';
        }
        var path = shop.templateEntryPath || '';
        if (!path && shop.templateKey) {
            var key = String(shop.templateKey).toLowerCase();
            path = KNOWN_TEMPLATE_ENTRY_PATHS[key] || '/index.html';
        }
        if (!path) {
            return '';
        }
        return isSafeSameOriginRelativePath(path) ? path : '/index.html';
    }

    function currentGuestShell() {
        if (typeof document === 'undefined') {
            return '';
        }
        var meta = document.querySelector('meta[name="mo-guest-shell"]');
        return meta ? String(meta.getAttribute('content') || '').trim() : '';
    }

    function templateShellForPath(path) {
        return String(path || '').toLowerCase().indexOf('index2') >= 0 ? 'index2' : 'original';
    }

    function navigateToTemplateIfNeeded(shop, sessionId, pin) {
        var targetPath = templateEntryPathForShop(shop);
        if (!targetPath || typeof location === 'undefined') {
            return false;
        }
        var targetShell = templateShellForPath(targetPath);
        var currentShell = currentGuestShell();
        if (currentShell && currentShell === targetShell) {
            return false;
        }
        safeLocationReplace(targetPath + guestCredentialsQuery(sessionId, pin));
        return true;
    }

    function buildConnectShopUrl(detail, sessionId, pin, shopIdHint) {
        if (!detail || typeof detail !== 'object') {
            return '';
        }
        var shopSlug = connectPathSlug(detail, shopIdHint);
        if (!shopSlug) {
            return '';
        }
        stashJoinCredentialsForRoute(sessionId || detail.sessionId, pin || detail.pin);
        return connectShopPath(shopSlug);
    }

    function enrichConnectDetailWithOpenMeta(detail, opened, payload) {
        var next = detail && typeof detail === 'object' ? Object.assign({}, detail) : {};
        var raw = next.raw && typeof next.raw === 'object' ? Object.assign({}, next.raw) : {};
        var shopId = resolveConnectShopId(next, opened && opened.shopId != null
            ? opened.shopId
            : (payload && payload.shopId));
        if (shopId > 0) {
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

    function inferGuestApiBase() {
        var fromLocation = core.inferPublicApiBaseFromLocation();
        if (fromLocation) {
            return fromLocation.replace(/\/$/, '');
        }
        return (global._serverBase || 'http://localhost:8080').replace(/\/$/, '');
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

    function fetchPublicShop(shopSlug, apiBase) {
        var base = (apiBase || inferGuestApiBase()).replace(/\/$/, '');
        var slug = displayPathSlug(shopSlug) || String(shopSlug || '').trim();
        if (!slug) {
            return Promise.resolve(null);
        }
        var http = core.createHttpClient({ baseUrl: base });
        return http.get(guestPaths.shopBySlug(slug)).catch(function (err) {
            if (err && err.status === 404) {
                return null;
            }
            if (err && err instanceof core.ApiError) {
                throw err;
            }
            throw new Error('店舗情報の取得に失敗しました');
        });
    }

    function applyGuestBranding(shop) {
        if (!shop || !shop.customBrandingEnabled || typeof document === 'undefined') {
            return;
        }
        if (shop.logoUrl && isSafeBrandingAssetUrl(shop.logoUrl)) {
            document.querySelectorAll('.shop-name, #headerShopName').forEach(function (el) {
                if (!el) {
                    return;
                }
                el.style.backgroundImage = 'url(' + shop.logoUrl + ')';
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
        if (item.menuId != null && item.menuId !== '') {
            return String(item.menuId);
        }
        if (item.menuPublicId != null && item.menuPublicId !== '') {
            return String(item.menuPublicId);
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

    function normalizeOrderHistoryItem(item) {
        if (!item) {
            return null;
        }
        return {
            menuId: resolveOrderHistoryMenuId(item),
            menuName: resolveOrderHistoryMenuName(item),
            quantity: item.quantity != null ? Number(item.quantity) : 0
        };
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

    function formatOrderHistoryLines(order, menus, options) {
        options = options || {};
        var lineSeparator = options.lineSeparator || DEFAULT_LINE_SEPARATOR;
        var lang = options.lang || getGuestMenuLang();
        var items = order && Array.isArray(order.items) ? order.items : [];
        if (items.length) {
            return items.map(function (item) {
                var normalized = normalizeOrderHistoryItem(item);
                if (!normalized) {
                    return '';
                }
                var name = resolveGuestMenuDisplayName(normalized.menuId, menus, normalized.menuName);
                return name + lineSeparator + normalized.quantity;
            }).filter(function (line) { return !!line; });
        }
        if (order && Array.isArray(order.lines) && order.lines.length) {
            return order.lines.slice();
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
                total: Number(order.totalPrice || 0),
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

    function parseSessionConnect(session, sessionId, pin) {
        const raw = session || {};
        const normalizedPin = String(pin || raw.entryPin || '').trim().toUpperCase();
        const resolvedSessionId = raw.sessionId || raw.id || sessionId || '';
        const orderHistory = mapOrderHistory(raw);

        return {
            raw: raw,
            sessionId: resolvedSessionId,
            pin: normalizedPin,
            shopId: raw.shopId != null ? raw.shopId : null,
            shopName: raw.shopName || (raw.shop && raw.shop.name) || '',
            shopSlug: raw.shopSlug || '',
            tableNumber: Number(raw.tableNumber || 0),
            peoples: Number(raw.peoples || 0),
            templateKey: raw.templateKey || 'Original',
            templateEntryPath: raw.templateEntryPath || '/index.html',
            orderPageLogoUrl: raw.orderPageLogoUrl || null,
            orderPageCustomCss: raw.orderPageCustomCss || null,
            customBrandingEnabled: raw.customBrandingEnabled === true,
            totalAmount: Number(raw.totalAmount || 0),
            orderHistory: orderHistory,
            rawOrderHistory: Array.isArray(raw.orderHistory) ? raw.orderHistory : [],
            firebaseCustomToken: raw.firebaseCustomToken || null
        };
    }

    function isPendingLocalOrderHistoryEntry(entry) {
        return !!(entry && entry.orderId == null);
    }

    /**
     * 注文直後のローカル履歴を、resync / Firestore 更新で消さないようマージする。
     * サーバー側の件数が追いつくまで orderId 未設定のエントリを保持する。
     */
    function mergeOrderHistoryWithPending(current, incoming) {
        const server = Array.isArray(incoming) ? incoming : [];
        const prev = Array.isArray(current) ? current : [];
        if (!prev.length) {
            return server;
        }
        const pending = prev.filter(isPendingLocalOrderHistoryEntry);
        if (!pending.length) {
            return server.length ? server : prev;
        }
        if (server.length >= prev.length) {
            return server;
        }
        const confirmedCount = prev.length - pending.length;
        const extraPending = pending.slice(Math.max(0, server.length - confirmedCount));
        return server.concat(extraPending);
    }

    function createLocalOrderHistoryEntry(cartItems, options) {
        options = options || {};
        const lineSeparator = options.lineSeparator || DEFAULT_LINE_SEPARATOR;
        const timeZone = options.timeZone || core.DEFAULT_TIME_ZONE;
        const items = Array.isArray(cartItems) ? cartItems : [];

        const normalizedItems = items.map(normalizeOrderHistoryItem).filter(function (item) { return !!item; });

        const total = items.reduce(function (sum, item) {
            const unit = Number(item.priceAtOrder || item.unitPrice || 0)
                + Number(item.toppingPrice || 0);
            const qty = Number(item.quantity || 0);
            return sum + unit * qty;
        }, 0);

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

    function countSelectedInGroup(toppingIds, group) {
        const toppings = Array.isArray(group.toppings) ? group.toppings : [];
        const orderableIds = toppings.filter(isOrderablePublicTopping).map(function (t) {
            return Number(t.id);
        });
        if (!toppingIds || !toppingIds.length || !orderableIds.length) {
            return 0;
        }
        return toppingIds.filter(function (id) {
            return orderableIds.indexOf(Number(id)) >= 0;
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

        function validateMenu(menuId) {
            return loadGroups(menuId).then(function (groups) {
                const lines = cart.filter(function (item) {
                    return item && String(item.menuId) === String(menuId);
                });
                for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
                    const line = lines[lineIndex];
                    const toppingIds = Array.isArray(line.toppingIds) ? line.toppingIds : [];
                    for (let g = 0; g < groups.length; g += 1) {
                        const group = groups[g];
                        if (!group) {
                            continue;
                        }
                        const minSelect = Number(group.minSelect || 0);
                        const maxSelect = Number(group.maxSelect || 0);
                        const effectiveMax = maxSelect > 0 ? maxSelect : Math.max(minSelect, 99);
                        const groupName = group.groupName || 'トッピング';
                        const orderableCount = (Array.isArray(group.toppings) ? group.toppings : [])
                            .filter(isOrderablePublicTopping).length;
                        const selected = countSelectedInGroup(toppingIds, group);

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
                return { valid: true, message: '' };
            });
        }

        return menuIds.reduce(function (chain, menuId) {
            return chain.then(function (prev) {
                if (!prev.valid) {
                    return prev;
                }
                return validateMenu(menuId);
            });
        }, Promise.resolve({ valid: true, message: '' }));
    }

    function normalizeJoinPin(pin) {
        return String(pin || '').trim().toUpperCase();
    }

    function parseJoinCredentialsFromSearch(search) {
        const params = new URLSearchParams(search || '');
        const sessionId = sanitizeGuestSessionId(params.get(JOIN_SESSION_PARAM) || params.get('id') || '');
        const pin = sanitizeGuestJoinPin(params.get(JOIN_PIN_PARAM) || params.get('pass') || '');
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

        var fromContext = parseSessionContextFromStorage();
        if (fromContext) {
            return fromContext;
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

        const hash = (loc.hash || '').replace(/^#/, '');
        if (hash) {
            const fromHash = parseJoinCredentialsFromSearch(
                hash.charAt(0) === '?' ? hash : '?' + hash
            );
            if (fromHash.sessionId && fromHash.pin) {
                return fromHash;
            }
        }

        var fromSearch = parseJoinCredentialsFromSearch(loc.search);
        if (fromSearch.sessionId && fromSearch.pin) {
            stripLegacyMoQueryParams();
            return fromSearch;
        }
        return fromSearch;
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

    function buildFixedQrConnectUrl(baseUrl, shopId, tableNo, passPhrase) {
        const base = String(baseUrl || '').replace(/\/$/, '');
        const sid = shopId != null ? String(shopId).trim() : '';
        const table = tableNo != null ? String(tableNo).trim() : '';
        const pass = String(passPhrase || '').trim();
        if (!base || !sid || !table || !pass) {
            return '';
        }
        const params = new URLSearchParams();
        params.set(FIXED_QR_SHOP_PARAM, sid);
        params.set(FIXED_QR_TABLE_PARAM, table);
        params.set(FIXED_QR_PASS_PARAM, pass);
        return base + '/connect?' + params.toString();
    }

    function parseFixedQrCredentialsFromSearch(search) {
        const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
        const shopId = Number(params.get(FIXED_QR_SHOP_PARAM) || params.get('shop') || 0);
        const tableNo = Number(params.get(FIXED_QR_TABLE_PARAM) || params.get('table') || 0);
        const passPhrase = String(params.get(FIXED_QR_PASS_PARAM) || params.get('passPhrase') || '').trim();
        return {
            shopId: shopId,
            tableNo: tableNo,
            passPhrase: passPhrase
        };
    }

    function buildOrderJoinUrlFromToken(baseUrl, joinToken) {
        const base = String(baseUrl || '').replace(/\/$/, '');
        const token = String(joinToken || '').trim();
        if (!base || !token) {
            return '';
        }
        return base + '/?' + JOIN_TOKEN_PARAM + '=' + encodeURIComponent(token);
    }

    function buildOrderJoinUrl(baseUrl, sessionId, pin) {
        const base = String(baseUrl || '').replace(/\/$/, '');
        const id = sanitizeGuestSessionId(sessionId);
        const normalizedPin = sanitizeGuestJoinPin(pin);
        if (!base || !id || !normalizedPin) {
            return '';
        }
        const params = new URLSearchParams();
        params.set(JOIN_SESSION_PARAM, id);
        params.set(JOIN_PIN_PARAM, normalizedPin);
        return base + '/#' + params.toString();
    }

    function stripJoinCredentialsFromUrl(cleanPath) {
        if (typeof history === 'undefined' || typeof location === 'undefined') {
            return;
        }
        const path = cleanPath != null ? String(cleanPath) : (location.pathname || '/');
        const params = new URLSearchParams(location.search || '');
        params.delete(JOIN_SESSION_PARAM);
        params.delete(JOIN_PIN_PARAM);
        const keepIdPass = /^\/connect(\/|$)/.test(path);
        if (!keepIdPass) {
            params.delete('id');
            params.delete('pass');
        }
        LEGACY_GUEST_QUERY_KEYS.forEach(function (key) {
            params.delete(key);
        });
        const qs = params.toString();
        history.replaceState(history.state, document.title, qs ? path + '?' + qs : path);
    }

    function saveSessionCredentials(sessionId, pin) {
        if (typeof localStorage === 'undefined') {
            return;
        }
        if (sessionId) {
            localStorage.setItem(LS_SESSION_ID, sessionId);
        }
        if (pin) {
            localStorage.setItem(LS_PIN, String(pin).trim().toUpperCase());
        }
    }

    function loadSessionCredentials() {
        if (typeof localStorage === 'undefined') {
            return { sessionId: '', pin: '' };
        }
        return {
            sessionId: localStorage.getItem(LS_SESSION_ID) || '',
            pin: localStorage.getItem(LS_PIN) || ''
        };
    }

    function clearSessionCredentials() {
        if (typeof localStorage === 'undefined') {
            return;
        }
        localStorage.removeItem(LS_SESSION_ID);
        localStorage.removeItem(LS_PIN);
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

    function ensureGuestClientId() {
        try {
            var existing = localStorage.getItem(GUEST_CLIENT_ID_STORAGE_KEY);
            if (existing && String(existing).trim()) {
                return String(existing).trim();
            }
            var created = (global.crypto && crypto.randomUUID)
                ? crypto.randomUUID()
                : ('guest-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12));
            localStorage.setItem(GUEST_CLIENT_ID_STORAGE_KEY, created);
            return created;
        } catch (_ignored) {
            return 'guest-' + Date.now();
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
        return !guestMeta || guestMeta.consoleLog !== false;
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
            var tops = (line.toppingIds || []).slice().sort(function (x, y) {
                return x - y;
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

    function normalizeGuestMenu(menu) {
        if (!menu || typeof menu !== 'object') {
            return null;
        }
        var normalized = Object.assign({}, menu);
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

    function guestMenuCategoryLabel(menu) {
        return menu && menu.category ? menu.category : GUEST_MENU_DEFAULT_CATEGORY;
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

    function extractGuestMenuCategories(menus) {
        var set = new Set();
        (menus || []).forEach(function (menu) {
            set.add(guestMenuCategoryLabel(menu));
        });
        return Array.from(set);
    }

    function filterGuestMenusByCategory(menus, activeCategory) {
        var list = Array.isArray(menus) ? menus : [];
        if (!activeCategory) {
            return list;
        }
        return list.filter(function (menu) {
            return guestMenuCategoryLabel(menu) === activeCategory;
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
            return guestMenuCategoryLabel(menu) === activeCategory;
        });
        return hasCategory ? activeCategory : null;
    }

    function isGuestMenuReadyForOrder(loadState, menus) {
        return loadState === GUEST_MENU_LOAD_STATE.READY
            && Array.isArray(menus)
            && menus.length > 0;
    }

    function formatGuestMenuLoadError(err) {
        var msg = err && err.message ? String(err.message) : 'unknown error';
        return 'メニュー取得失敗。APIサーバーまたはネットワーク状態を確認してください: ' + msg;
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

    /**
     * 来客メニュー取得の共通ローダー（競合防止・オフラインキャッシュ・bundle/search 切替）。
     * UI は load() の結果を state に反映し、描画だけ担当する。
     */
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
            if (shopId == null && !viewOnly) {
                shopId = 1;
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
                fetchPromise = orderSdk.loadOrderBundle(shopId, '', { lang: requestLang }).then(function (bundle) {
                    return {
                        menus: bundle.menus || [],
                        toppings: bundle.toppings || {},
                        requestedLang: bundle.requestedLang,
                        resolvedLang: bundle.resolvedLang,
                        availableLanguages: bundle.availableLanguages,
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
                    Promise.resolve(saveHook(shopId, menus)).catch(function () { /* ignore IDB errors */ });
                }
                return finish({
                    stale: false,
                    loadState: menus.length ? GUEST_MENU_LOAD_STATE.READY : GUEST_MENU_LOAD_STATE.ERROR,
                    menus: menus,
                    allMenus: nextAllMenus,
                    toppings: fetched.toppings,
                    prefetchToppings: fetched.prefetchToppings,
                    requestedLang: fetched.requestedLang || requestLang,
                    resolvedLang: fetched.resolvedLang || requestLang,
                    availableLanguages: fetched.availableLanguages,
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
        return {
            toppings: result.toppings,
            prefetchToppings: result.prefetchToppings,
            shopId: result.shopId,
            fromCache: result.fromCache,
            cacheSavedAt: result.cacheSavedAt,
            error: result.error,
            emptyMessage: result.emptyMessage,
            keyword: result.keyword,
            requestedLang: result.requestedLang,
            resolvedLang: result.resolvedLang,
            availableLanguages: result.availableLanguages
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
                return state && state.shopId != null ? state.shopId : 1;
            },
            saveMenuCache: typeof options.saveMenuCache === 'function'
                ? options.saveMenuCache
                : (offlineApi && typeof offlineApi.saveMenuCache === 'function'
                    ? function (shopId, menus) { return offlineApi.saveMenuCache(shopId, menus); }
                    : undefined),
            loadMenuCache: typeof options.loadMenuCache === 'function'
                ? options.loadMenuCache
                : (offlineApi && typeof offlineApi.loadMenuCache === 'function'
                    ? function (shopId) { return offlineApi.loadMenuCache(shopId); }
                    : undefined)
        });
    }

    function createOrderSdk(options) {
        options = options || {};
        const http = core.createHttpClient({
            baseUrl: options.apiBaseUrl,
            getAccessToken: options.getAccessToken || options.getIdToken,
            onUnauthorized: options.onUnauthorized
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
            var connectQuery = shopId != null && shopId !== '' ? { shopId: shopId } : {};
            var cappedLimit = limit != null ? limit : 50;
            return http.get(
                core.withQuery(
                    guestPaths.connectOrders(resolvedSessionId),
                    Object.assign({ limit: cappedLimit }, connectQuery)
                ),
                withSessionPin({}, resolvedPin)
            ).then(function (orders) {
                return Array.isArray(orders)
                    ? orders.map(core.normalizeOrderHistoryItem).filter(Boolean)
                    : [];
            });
        }

        function findRecentGuestOrderMatch(orders, items) {
            var targetUnits = sumMenuUnitsFromApiItems(items);
            var now = Date.now();
            return (orders || []).find(function (order) {
                if (!order) {
                    return false;
                }
                var orderUnits = (order.items || []).reduce(function (sum, line) {
                    return sum + (line && line.quantity ? Number(line.quantity) : 0);
                }, 0);
                if (orderUnits !== targetUnits) {
                    return false;
                }
                var t = core.parseApiDateTime(order.orderTime);
                if (!t) {
                    return true;
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
                return http.get(
                    core.withQuery(
                        guestPaths.connectSession(sessionId),
                        shopId != null && shopId !== '' ? { shopId: shopId } : {}
                    ),
                    withSessionPin({}, pin)
                );
            },
            getGuestConnectOrderHistory: getGuestConnectOrderHistory,
            connectSessionDetail: function (sessionId, pin, shopId) {
                var connectQuery = shopId != null && shopId !== '' ? { shopId: shopId } : {};
                return http.get(
                    core.withQuery(
                        guestPaths.connectSession(sessionId),
                        connectQuery
                    ),
                    withSessionPin({}, pin)
                )
                    .then(function (session) {
                        var detail = parseSessionConnect(session, sessionId, pin);
                        if (detail.orderHistory && detail.orderHistory.length) {
                            return detail;
                        }
                        return getGuestConnectOrderHistory(sessionId, pin, shopId, 50)
                            .then(function (history) {
                                detail.orderHistory = mapOrderHistory(history);
                                detail.rawOrderHistory = Array.isArray(history) ? history : [];
                                return detail;
                            })
                            .catch(function () {
                                return detail;
                            });
                    });
            },
            joinSession: function (joinToken) {
                return http.get(guestPaths.joinSession(joinToken));
            },
            openFixedQrSession: function (payload) {
                return http.post(guestPaths.openFixedQrSession(), payload || {});
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
                                shopId != null && shopId !== '' ? { shopId: shopId } : {}
                            ),
                            withSessionPin({}, normalizedPin)
                        ).then(function (session) {
                            return parseSessionConnect(session, sessionId, normalizedPin);
                        });
                    });
            },
            submitOrder: function (sessionId, pin, items, guestMeta) {
                var validation = validateGuestOrderSubmission(items);
                if (!validation.valid) {
                    return Promise.reject(new Error(validation.message));
                }
                var plan = planGuestOrderSubmit(sessionId, items, guestMeta);
                if (plan.mode === 'blocked') {
                    if (shouldLogGuestOrderToConsole(guestMeta)) {
                        logGuestOrderConsole('blocked', {
                            sessionId: sessionId,
                            message: plan.message
                        });
                    }
                    return Promise.reject(new Error(plan.message));
                }
                if (plan.mode === 'join') {
                    if (shouldLogGuestOrderToConsole(guestMeta)) {
                        logGuestOrderConsole('join', {
                            sessionId: sessionId,
                            requestId: guestSubmitFlightBySession[sessionId]
                                ? guestSubmitFlightBySession[sessionId].requestId
                                : null,
                            note: '同一カートの送信が進行中のため結果を共有します'
                        });
                    }
                    return attachGuestOrderConsoleLogging(
                        plan.promise,
                        buildGuestOrderConsoleRequest(sessionId, {
                            requestId: guestSubmitFlightBySession[sessionId]
                                ? guestSubmitFlightBySession[sessionId].requestId
                                : null,
                            clientId: guestSubmitFlightBySession[sessionId]
                                ? guestSubmitFlightBySession[sessionId].clientId
                                : null
                        }, items),
                        guestMeta
                    );
                }
                var requestSnapshot = buildGuestOrderConsoleRequest(sessionId, plan, items);
                if (shouldLogGuestOrderToConsole(guestMeta)) {
                    logGuestOrderConsole('request', { request: requestSnapshot });
                }
                var promise = http.post(
                    guestPaths.submitOrder(sessionId),
                    { items: items },
                    withGuestOrderHeaders({}, pin, {
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
                        sessionId,
                        pin,
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
                    sessionId,
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
                return http.get(core.withQuery(guestPaths.menuSearch(), {
                    shopId: opts.shopId,
                    name: opts.name,
                    lang: opts.lang || getGuestMenuLang(),
                    _: Date.now()
                })).then(function (menus) {
                    return Array.isArray(menus)
                        ? menus.map(normalizeGuestMenu).filter(Boolean)
                        : [];
                });
            },
            getToppingGroupsForMenu: function (menuId) {
                return http.get(guestPaths.toppingGroupsForMenu(menuId));
            },
            loadOrderToppingCatalog: function (shopId) {
                return http.get(guestPaths.orderToppingCatalog(shopId));
            },
            loadOrderBundle: function (shopId, name, options) {
                options = options || {};
                return http.get(core.withQuery(guestPaths.orderBundle(shopId), {
                    name: name || '',
                    lang: options.lang || getGuestMenuLang(),
                    _: Date.now()
                })).then(function (bundle) {
                    var raw = bundle || {};
                    return {
                        menus: Array.isArray(raw.menus)
                            ? raw.menus.map(normalizeGuestMenu).filter(Boolean)
                            : [],
                        toppings: raw.toppings && typeof raw.toppings === 'object' ? raw.toppings : {},
                        requestedLang: raw.requestedLang || options.lang || null,
                        resolvedLang: raw.resolvedLang || options.lang || getGuestMenuLang(),
                        availableLanguages: Array.isArray(raw.availableLanguages)
                            ? raw.availableLanguages
                            : [GUEST_MENU_LANG_DEFAULT]
                    };
                });
            },
            getGuestMenuLang: getGuestMenuLang,
            setGuestMenuLang: setGuestMenuLang,
            isGuestMenuLangExplicit: isGuestMenuLangExplicit,
            normalizeGuestMenuLang: normalizeGuestMenuLang,
            guestMenuLanguageLabel: guestMenuLanguageLabel,
            shouldPromptGuestMenuLanguage: shouldPromptGuestMenuLanguage,
            GUEST_MENU_LANG_DEFAULT: GUEST_MENU_LANG_DEFAULT,
            GUEST_MENU_LANG_LABELS: GUEST_MENU_LANG_LABELS,
            getRecommendMenus: function (shopId) {
                return http.get(guestPaths.recommendMenus(shopId))
                    .then(core.normalizeRecommendMenusResponse);
            },
            loadShopMenus: function (opts) {
                opts = opts || {};
                var shopId = opts.shopId;
                return http.get(core.withQuery(guestPaths.menuSearch(), {
                    shopId: shopId,
                    name: opts.name,
                    lang: opts.lang || getGuestMenuLang(),
                    _: Date.now()
                })).then(function (menus) {
                    return {
                        menus: Array.isArray(menus)
                            ? menus.map(normalizeGuestMenu).filter(Boolean)
                            : [],
                        resolvedLang: opts.lang || getGuestMenuLang()
                    };
                });
            },
            createLocalOrderHistoryEntry: createLocalOrderHistoryEntry,
            mergeOrderHistoryWithPending: mergeOrderHistoryWithPending,
            mapOrderHistory: mapOrderHistory,
            resolveGuestMenuDisplayName: resolveGuestMenuDisplayName,
            formatOrderHistoryLines: formatOrderHistoryLines,
            validateGuestOrderSubmission: validateGuestOrderSubmission,
            validateCartToppingSelections: validateCartToppingSelections,
            formatOrderSendStatusLabel: formatOrderSendStatusLabel,
            ORDER_SEND_STATUS: ORDER_SEND_STATUS,
            normalizeGuestMenu: normalizeGuestMenu,
            isGuestMenuSoldOut: isGuestMenuSoldOut,
            createSessionResyncMonitor: function (monitorOptions) {
                monitorOptions = monitorOptions || {};
                const visibleIntervalMs = Number(monitorOptions.intervalMs || DEFAULT_RESYNC_INTERVAL_MS);
                const hiddenIntervalMs = Number(monitorOptions.hiddenIntervalMs || HIDDEN_RESYNC_INTERVAL_MS);
                let timerId = null;
                let activeSessionId = '';
                let activePin = '';
                let activeShopId = null;

                function stop() {
                    if (timerId != null) {
                        clearInterval(timerId);
                        timerId = null;
                    }
                    if (typeof document !== 'undefined') {
                        document.removeEventListener('visibilitychange', scheduleTick);
                    }
                    activeSessionId = '';
                    activePin = '';
                    activeShopId = null;
                }

                function effectiveIntervalMs() {
                    if (typeof document !== 'undefined' && document.hidden) {
                        return hiddenIntervalMs;
                    }
                    return visibleIntervalMs;
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
                        withSessionPin({}, activePin)
                    )
                        .then(function (session) {
                            const detail = parseSessionConnect(session, activeSessionId, activePin);
                            if (typeof monitorOptions.onSessionUpdate === 'function') {
                                monitorOptions.onSessionUpdate(detail);
                            }
                            return detail;
                        });
                }

                function scheduleTick() {
                    if (timerId != null) {
                        clearInterval(timerId);
                    }
                    timerId = setInterval(function () {
                        resync().catch(function () { /* ignore transient resync errors */ });
                    }, effectiveIntervalMs());
                }

                function start(sessionId, pin, shopId) {
                    stop();
                    activeSessionId = sessionId;
                    activePin = String(pin || '').trim().toUpperCase();
                    activeShopId = shopId != null && shopId !== '' ? shopId : null;
                    if (typeof document !== 'undefined') {
                        document.addEventListener('visibilitychange', scheduleTick);
                    }
                    scheduleTick();
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
        var hashBody = String(parsed.hash || '').replace(/^#/, '');
        var hashParams = new URLSearchParams(hashBody.charAt(0) === '?' ? hashBody : (hashBody ? '?' + hashBody : ''));
        var joinToken = (parsed.searchParams.get(JOIN_TOKEN_PARAM) || hashParams.get(JOIN_TOKEN_PARAM) || '').trim();
        if (joinToken) {
            return { kind: 'join', joinToken: joinToken, raw: raw, url: parsed };
        }
        var fixed = parseFixedQrCredentialsFromSearch(parsed.search);
        if (fixed.shopId > 0 && fixed.tableNo > 0 && fixed.passPhrase) {
            return {
                kind: 'fixed',
                shopId: fixed.shopId,
                tableNo: fixed.tableNo,
                passPhrase: fixed.passPhrase,
                raw: raw,
                url: parsed
            };
        }
        var creds = parseJoinCredentialsFromSearch(parsed.search);
        if (creds.sessionId && creds.pin) {
            return {
                kind: 'credentials',
                sessionId: creds.sessionId,
                pin: creds.pin,
                raw: raw,
                url: parsed
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
                    url: parsed
                };
            }
        }
        return { kind: 'invalid', raw: raw, url: parsed };
    }

    function buildConnectEntryUrl(sessionId, pin) {
        var id = sanitizeGuestSessionId(sessionId);
        var normalizedPin = sanitizeGuestJoinPin(pin);
        if (!id || !normalizedPin) {
            return '';
        }
        return '/connect?id=' + encodeURIComponent(id) + '&pass=' + encodeURIComponent(normalizedPin);
    }

    function buildGuestSessionShareConnectUrl(sessionId, pin, orderPublicBase) {
        var entry = buildConnectEntryUrl(sessionId, pin);
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
        var path = String((shop && shop.templateEntryPath) || '/index.html').toLowerCase();
        if (path.indexOf('index2') >= 0) {
            return 'index2';
        }
        if (path.indexOf('cursor-1') >= 0) {
            return 'cursor-1';
        }
        if (path.indexOf('premium-neon') >= 0) {
            return 'premium-neon';
        }
        var key = String((shop && shop.templateKey) || '').toLowerCase();
        if (key === 'index2') {
            return 'index2';
        }
        if (key === 'premium-neon') {
            return 'premium-neon';
        }
        return 'original';
    }

    function fetchPublicShopById(shopId, apiBase) {
        var id = Number(shopId || 0);
        if (!id) {
            return Promise.resolve(null);
        }
        return guestUrlApi.fetchPublicShop('shop-' + id, apiBase);
    }

    function stashFixedQrPendingOpen(shopId, tableNo, sessionId, entryPin) {
        if (typeof sessionStorage === 'undefined') {
            return;
        }
        var sid = sanitizeGuestSessionId(sessionId);
        var pin = sanitizeGuestJoinPin(entryPin);
        var shop = Number(shopId || 0);
        var table = Number(tableNo || 0);
        if (!sid || !pin || shop <= 0 || table <= 0) {
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
        var shop = Number(shopId || 0);
        var table = Number(tableNo || 0);
        if (shop <= 0 || table <= 0) {
            return null;
        }
        try {
            var raw = sessionStorage.getItem(FIXED_QR_PENDING_OPEN_KEY);
            if (!raw) {
                return null;
            }
            var parsed = JSON.parse(raw);
            if (!parsed || Number(parsed.shopId || 0) !== shop || Number(parsed.tableNo || 0) !== table) {
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
        if (status === 409) {
            return {
                code: 'TABLE_IN_USE',
                message: 'この卓はすでにセッションが開始されています。接続を再試行しています…'
            };
        }
        if (status === 403) {
            return { code: 'INVALID_PASSPHRASE', message: 'PASSWD が正しくありません。スタッフに確認してください。' };
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

    function openFixedQrSessionAndConnect(sessionController, payload, options) {
        options = options || {};
        var sdk = options.orderSdk || (sessionController && sessionController.sdk);
        if (!sdk || typeof sdk.openFixedQrSession !== 'function') {
            return Promise.reject(new Error('orderSdk が必要です'));
        }
        var body = {
            shopId: payload.shopId,
            tableNo: payload.tableNo,
            passPhrase: payload.passPhrase,
            peoples: payload.peoples != null ? payload.peoples : 1
        };
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
        var state = {
            credentials: options.credentials || null,
            shop: null,
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
                join.innerHTML = '<p class="mo-fixed-qr-entry-label">この卓は利用中です</p>'
                    + '<p class="mo-fixed-qr-entry-sub">代表者の合流QRを読み取るか、'
                    + '<a href="/scan">スキャン画面</a>から Session ID と PIN で合流してください。</p>';
                root.querySelector('.mo-fixed-qr-entry-card').appendChild(join);
            }
            join.hidden = false;
        }

        function renderForm() {
            if (!root) {
                return;
            }
            var creds = state.credentials || {};
            var tableNo = Number(creds.tableNo || 0);
            var shopName = (state.shop && state.shop.shopName) || ('Shop ' + (creds.shopId || ''));
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
            sub.textContent = 'テーブル ' + tableNo + ' — 人数を選んで注文を開始してください';
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
            setStatus('セッションを開始しています…', 'ok');
            var submitBtn = root && root.querySelector('.mo-fixed-qr-entry-submit');
            if (submitBtn) {
                submitBtn.disabled = true;
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
                creds = parseFixedQrCredentialsFromSearch(fromSearch);
                state.credentials = creds;
            }
            if (!creds || creds.shopId <= 0 || creds.tableNo <= 0 || !creds.passPhrase) {
                setStatus('固定QRの情報が不足しています', 'error');
                return Promise.resolve(false);
            }
            setStatus('店舗情報を読み込み中…', '');
            return fetchPublicShopById(creds.shopId, apiBase).then(function (shop) {
                state.shop = shop;
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
            if (options.useConnectEntryUrl !== false && typeof location !== 'undefined') {
                var base = options.orderPublicBase || inferGuestOrderPublicBase();
                var entryUrl = buildFixedQrConnectUrl(
                    base,
                    payload.shopId,
                    payload.tableNo,
                    payload.passPhrase
                );
                if (entryUrl && options.redirect !== false) {
                    safeLocationReplace(entryUrl);
                    return Promise.resolve({
                        kind: 'fixed',
                        needsPeoples: true,
                        credentials: payload
                    });
                }
            }
            if (options.peoples != null && Number(options.peoples) > 0) {
                return openFixedQrSessionAndConnect(sessionController, {
                    shopId: payload.shopId,
                    tableNo: payload.tableNo,
                    passPhrase: payload.passPhrase,
                    peoples: Number(options.peoples)
                }, options);
            }
            return Promise.resolve({
                kind: 'fixed',
                needsPeoples: true,
                credentials: payload
            });
        }
        if (payload.kind === 'credentials') {
            if (options.useConnectEntryUrl && typeof location !== 'undefined') {
                var entry = buildConnectEntryUrl(payload.sessionId, payload.pin);
                if (entry) {
                    safeLocationReplace(entry);
                    return Promise.resolve(null);
                }
            }
            return sessionController.connect(payload.sessionId, payload.pin).then(function (detail) {
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
        return typeof BarcodeDetector !== 'undefined' || typeof global.jsQR === 'function';
    }

    function guestQrCameraSupported() {
        return !!(typeof navigator !== 'undefined'
            && navigator.mediaDevices
            && typeof navigator.mediaDevices.getUserMedia === 'function');
    }

    function decodeGuestQrImageData(imageData, detector) {
        if (!imageData) {
            return '';
        }
        if (typeof global.jsQR === 'function') {
            var jsResult = global.jsQR(
                imageData.data,
                imageData.width,
                imageData.height,
                { inversionAttempts: 'attemptBoth' }
            );
            if (jsResult && jsResult.data) {
                return String(jsResult.data).trim();
            }
        }
        return '';
    }

    async function decodeGuestQrBitmap(bitmap) {
        var text = '';
        if (typeof BarcodeDetector !== 'undefined') {
            try {
                var codes = await new BarcodeDetector({ formats: ['qr_code'] }).detect(bitmap);
                if (codes && codes.length && codes[0].rawValue) {
                    text = String(codes[0].rawValue).trim();
                }
            } catch (_) { /* fallback to jsQR */ }
        }
        if (!text && typeof document !== 'undefined') {
            var canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            var ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(bitmap, 0, 0);
            text = decodeGuestQrImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
        }
        return text;
    }

    async function decodeGuestQrVideoFrame(videoEl, scratch) {
        if (!videoEl || videoEl.readyState < 2) {
            return '';
        }
        var text = '';
        if (typeof BarcodeDetector !== 'undefined') {
            scratch.detector = scratch.detector || new BarcodeDetector({ formats: ['qr_code'] });
            try {
                var codes = await scratch.detector.detect(videoEl);
                if (codes && codes.length && codes[0].rawValue) {
                    text = String(codes[0].rawValue).trim();
                }
            } catch (_) { /* jsQR fallback */ }
        }
        if (!text && typeof document !== 'undefined' && videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
            scratch.canvas = scratch.canvas || document.createElement('canvas');
            scratch.ctx = scratch.ctx || scratch.canvas.getContext('2d', { willReadFrequently: true });
            scratch.canvas.width = videoEl.videoWidth;
            scratch.canvas.height = videoEl.videoHeight;
            scratch.ctx.drawImage(videoEl, 0, 0);
            text = decodeGuestQrImageData(
                scratch.ctx.getImageData(0, 0, scratch.canvas.width, scratch.canvas.height),
                scratch.detector
            );
        }
        return text;
    }

  /**
   * 来客 QR スキャナ（BarcodeDetector + jsQR、iOS Safari 対応）
   * @param {object} options
   * @param {HTMLVideoElement} options.videoEl
   * @param {function(string, object): void} [options.onScan] text, parseGuestQrText の結果
   * @param {function(string, string): void} [options.onStatus] message, type
   * @param {function(Error): void} [options.onError]
   */
    function createGuestQrScanner(options) {
        options = options || {};
        var videoEl = options.videoEl || null;
        var state = {
            running: false,
            stream: null,
            rafId: null,
            scratch: {},
            lastFrameAt: 0
        };

        function emitStatus(message, type) {
            if (typeof options.onStatus === 'function') {
                options.onStatus(message, type || '');
            }
        }

        function emitError(err) {
            if (typeof options.onError === 'function') {
                options.onError(err);
            }
        }

        function stop() {
            state.running = false;
            if (state.rafId != null) {
                cancelAnimationFrame(state.rafId);
                state.rafId = null;
            }
            if (state.stream) {
                state.stream.getTracks().forEach(function (track) {
                    track.stop();
                });
                state.stream = null;
            }
            if (videoEl) {
                try {
                    videoEl.pause();
                } catch (_) { /* ignore */ }
                videoEl.srcObject = null;
            }
        }

        async function handleDecodedText(text) {
            var trimmed = String(text || '').trim();
            if (!trimmed) {
                return false;
            }
            stop();
            emitStatus('QRを読み取りました。接続しています…', 'ok');
            var payload = parseGuestQrText(trimmed);
            if (typeof options.onScan === 'function') {
                await options.onScan(trimmed, payload);
            }
            return true;
        }

        async function scanFile(file) {
            if (!file) {
                throw new Error('画像ファイルがありません');
            }
            if (!guestQrDecodeSupported()) {
                throw new Error('このブラウザはQR画像読み取りに未対応です');
            }
            var bitmap = await createImageBitmap(file);
            try {
                var text = await decodeGuestQrBitmap(bitmap);
                if (!text) {
                    throw new Error('QRコードを検出できませんでした');
                }
                await handleDecodedText(text);
                return text;
            } finally {
                if (bitmap && typeof bitmap.close === 'function') {
                    bitmap.close();
                }
            }
        }

        async function start() {
            if (!videoEl) {
                throw new Error('video 要素が必要です');
            }
            if (!guestQrCameraSupported()) {
                throw new Error('カメラを利用できません');
            }
            if (!guestQrDecodeSupported()) {
                throw new Error('QR読み取りを開始できません（jsQR を読み込んでください）');
            }
            stop();
            videoEl.setAttribute('playsinline', 'true');
            videoEl.setAttribute('webkit-playsinline', 'true');
            videoEl.muted = true;
            state.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            });
            videoEl.srcObject = state.stream;
            await videoEl.play();
            state.running = true;
            emitStatus('QRをカメラにかざしてください', 'ok');

            var loop = function () {
                if (!state.running) {
                    return;
                }
                var now = Date.now();
                if (now - state.lastFrameAt >= 120) {
                    state.lastFrameAt = now;
                    decodeGuestQrVideoFrame(videoEl, state.scratch).then(function (text) {
                        if (!state.running || !text) {
                            return;
                        }
                        handleDecodedText(text).catch(function (err) {
                            emitError(err);
                        });
                    }).catch(function () { /* retry next frame */ });
                }
                state.rafId = requestAnimationFrame(loop);
            };
            state.rafId = requestAnimationFrame(loop);
        }

        return {
            start: start,
            stop: stop,
            scanFile: scanFile,
            supportsCamera: guestQrCameraSupported,
            supportsDecode: guestQrDecodeSupported
        };
    }

    function createOrderSessionController(options) {
        options = options || {};
        const orderSdk = options.orderSdk || createOrderSdk({ apiBaseUrl: options.apiBaseUrl });
        const monitor = orderSdk.createSessionResyncMonitor({
            intervalMs: options.intervalMs,
            onSessionUpdate: options.onSessionUpdate
        });
        const guestFirestore = options.guestFirestore || null;
        let guestFirestoreUnsub = null;
        let lastGuestDetail = null;
        var SESSION_INACTIVE_GRACE_MS = 10000;
        var sessionConnectCompletedAt = 0;
        var lastSessionActivityAt = 0;

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

        function stopGuestFirestoreWatch() {
            if (guestFirestoreUnsub) {
                guestFirestoreUnsub();
                guestFirestoreUnsub = null;
            }
            lastGuestDetail = null;
        }

        function applyDetail(detail) {
            saveSessionCredentials(detail.sessionId, detail.pin);
            stripJoinCredentialsFromUrl();
            touchSessionActivity();
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
                        var updated = Object.assign({}, lastGuestDetail, {
                            orderHistory: mapFirestoreOrdersToHistory(orders)
                        });
                        lastGuestDetail = updated;
                        if (typeof options.onSessionUpdate === 'function') {
                            options.onSessionUpdate(updated);
                        }
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

        function afterConnectDetail(detail, shopId) {
            var chain = Promise.resolve(detail);
            if (guestFirestore && guestFirestore.enabled
                && detail.firebaseCustomToken
                && guestFirestore.auth
                && guestFirestore.sdk
                && typeof guestFirestore.sdk.signInWithCustomToken === 'function') {
                chain = chain.then(function (d) {
                    return guestFirestore.sdk.signInWithCustomToken(
                        guestFirestore.auth,
                        d.firebaseCustomToken
                    ).then(function () {
                        return d;
                    }).catch(function (err) {
                        if (typeof console !== 'undefined' && console.warn) {
                            console.warn('[GuestFirestore] custom token sign-in failed; falling back to polling', err);
                        }
                        return d;
                    });
                });
            }
            return chain.then(function (d) {
                sessionConnectCompletedAt = Date.now();
                var canWatch = guestFirestore && guestFirestore.enabled && guestFirestore.sdk
                    && d.shopId && d.sessionId
                    && guestFirestore.auth && guestFirestore.auth.currentUser;
                if (canWatch && startGuestFirestoreWatch(d)) {
                    return applyDetail(d);
                }
                monitor.start(d.sessionId, d.pin, d.shopId || shopId);
                return applyDetail(d);
            });
        }

        function connect(sessionId, pin, shopId) {
            const normalizedPin = String(pin || '').trim().toUpperCase();
            return orderSdk.connectSessionDetail(sessionId, normalizedPin, shopId)
                .then(function (detail) {
                    return afterConnectDetail(detail, shopId);
                });
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
            return orderSdk.connectSessionViaJoinToken(token, normalizedPin, shopId)
                .then(function (detail) {
                    return afterConnectDetail(detail, shopId);
                });
        }

        function tryAutoReconnect() {
            const creds = loadSessionCredentials();
            if (!creds.sessionId || !creds.pin) {
                return Promise.resolve(null);
            }
            return connect(creds.sessionId, creds.pin, options.shopId).catch(function () {
                return null;
            });
        }

        function resync() {
            if (guestFirestore && guestFirestore.enabled && guestFirestoreUnsub) {
                return Promise.resolve(lastGuestDetail);
            }
            return monitor.resync();
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
            stop: stop,
            sdk: orderSdk,
            monitor: monitor
        };
    }

    var orderApi = {
        VERSION: SDK_VERSION,
        createOrderSdk: createOrderSdk,
        createOrderSessionController: createOrderSessionController,
        formatOrderTime: formatOrderTime,
        mapOrderHistory: mapOrderHistory,
        parseSessionConnect: parseSessionConnect,
        createLocalOrderHistoryEntry: createLocalOrderHistoryEntry,
        mergeOrderHistoryWithPending: mergeOrderHistoryWithPending,
        saveSessionCredentials: saveSessionCredentials,
        loadSessionCredentials: loadSessionCredentials,
        clearSessionCredentials: clearSessionCredentials,
        parseJoinCredentialsFromLocation: parseJoinCredentialsFromLocation,
        parseJoinTokenFromLocation: parseJoinTokenFromLocation,
        stashJoinCredentialsForRoute: stashJoinCredentialsForRoute,
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
        stripLegacyMoQueryParams: stripLegacyMoQueryParams,
        buildConnectShopUrl: buildConnectShopUrl,
        guestLocationReplace: guestLocationReplace,
        enrichConnectDetailWithOpenMeta: enrichConnectDetailWithOpenMeta,
        buildConnectEntryUrl: buildConnectEntryUrl,
        buildGuestSessionShareConnectUrl: buildGuestSessionShareConnectUrl,
        connectSlugsMatch: connectSlugsMatch,
        fetchPublicShop: fetchPublicShop,
        fetchPublicShopById: fetchPublicShopById,
        applyGuestBranding: applyGuestBranding,
        guestEntryShellKey: guestEntryShellKey,
        navigateToTemplateIfNeeded: navigateToTemplateIfNeeded,
        parseGuestQrText: parseGuestQrText,
        connectFromGuestQrText: connectFromGuestQrText,
        createFixedQrEntryController: createFixedQrEntryController,
        openFixedQrSessionAndConnect: openFixedQrSessionAndConnect,
        parseFixedQrOpenFailure: parseFixedQrOpenFailure,
        DEFAULT_FIXED_QR_PEOPLES_OPTIONS: DEFAULT_FIXED_QR_PEOPLES_OPTIONS,
        createGuestMenuLoader: createGuestMenuLoader,
        createGuestMenuLoaderForState: createGuestMenuLoaderForState,
        mergeGuestMenuLoadResult: mergeGuestMenuLoadResult,
        GUEST_MENU_DEFAULT_CATEGORY: GUEST_MENU_DEFAULT_CATEGORY,
        GUEST_MENU_LOAD_STATE: GUEST_MENU_LOAD_STATE,
        filterGuestMenusByKeyword: filterGuestMenusByKeyword,
        extractGuestMenuCategories: extractGuestMenuCategories,
        filterGuestMenusByCategory: filterGuestMenusByCategory,
        resolveGuestMenuActiveCategory: resolveGuestMenuActiveCategory,
        isGuestMenuReadyForOrder: isGuestMenuReadyForOrder,
        formatGuestMenuLoadError: formatGuestMenuLoadError,
        guestMenuCategoryLabel: guestMenuCategoryLabel,
        createGuestQrScanner: createGuestQrScanner,
        guestQrCameraSupported: guestQrCameraSupported,
        guestQrDecodeSupported: guestQrDecodeSupported,
        buildProfileFullName: core.buildProfileFullName,
        resolveDisplayFamilyName: core.resolveDisplayFamilyName,
        normalizeUserProfile: core.normalizeUserProfile,
        normalizeGuestMenu: normalizeGuestMenu,
        isGuestMenuSoldOut: isGuestMenuSoldOut,
        getGuestMenuLang: getGuestMenuLang,
        setGuestMenuLang: setGuestMenuLang,
        isGuestMenuLangExplicit: isGuestMenuLangExplicit,
        normalizeGuestMenuLang: normalizeGuestMenuLang,
        guestMenuLanguageLabel: guestMenuLanguageLabel,
        shouldPromptGuestMenuLanguage: shouldPromptGuestMenuLanguage,
        GUEST_MENU_LANG_DEFAULT: GUEST_MENU_LANG_DEFAULT,
        GUEST_MENU_LANG_LABELS: GUEST_MENU_LANG_LABELS,
        resolveGuestMenuDisplayName: resolveGuestMenuDisplayName,
        formatOrderHistoryLines: formatOrderHistoryLines
    };

    global.MasterOrderGuestUrl = guestUrlApi;
    global.MasterOrderOrderSdk = orderApi;
    global.MasterOrderSdk = orderApi;

    if (typeof location !== 'undefined') {
        stripLegacyMoQueryParams();
    }
})(typeof window !== 'undefined' ? window : globalThis);
