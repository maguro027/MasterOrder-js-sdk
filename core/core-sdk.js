/**
 * MasterOrder Core SDK — Staff / Order 共通基盤。
 *
 * - HTTP クライアント（fetch ラッパー、ApiError、Bearer / PIN ヘッダ）
 * - SSE クライアント（チケット発行は Staff SDK 側）
 * - DTO 正規化、日時フォーマット、リアルタイムイベント解析
 * - API ベース URL 推論（HTTPS 混在コンテンツ対策）
 *
 * 依存: api-routes.js → core-sdk.js
 * グローバル: MasterOrderCoreSdk
 */
(function (global) {
    'use strict';

    var SDK_VERSION = '1.1.1';

    class ApiError extends Error {
        constructor(message, status, payload) {
            super(message || 'API error');
            this.name = 'ApiError';
            this.status = status;
            this.payload = payload;
        }
    }

    function joinUrl(baseUrl, path) {
        const b = String(baseUrl || '').replace(/\/$/, '');
        const p = String(path || '').replace(/^\//, '');
        return b + '/' + p;
    }

    /**
     * HTTPS ページから http API を叩くと混在コンテンツでブロックされるため、
     * 同一ホストの本番系 URL は https に寄せる。
     * localhost / 127.0.0.1 は Docker で 8080 が平文 HTTP のことが多く、https に書き換えると ERR_SSL_PROTOCOL_ERROR になるため除外する。
     * Docker 内部名（server 等）を https にしてもブラウザから解決・TLS できないため、その場合は書き換えない。
     */
    /**
     * 公開 UI の Host から API ベース URL を推論（案 C: masterorder-* フラット名）。
     * 旧 staff.example.com → api.example.com も移行期間用に残す。
     */
    function inferPublicApiBaseFromHostname(hostname) {
        var h = String(hostname || '').toLowerCase().trim();
        if (!h || h === 'localhost' || h === '127.0.0.1' || h === '[::1]') {
            return null;
        }
        if (h === 'api' || h.startsWith('api.')) {
            return 'https://' + h;
        }
        var parts = h.split('.');
        if (parts.length >= 2 && parts[0].indexOf('masterorder-') === 0 && parts[0] !== 'masterorder-api') {
            parts[0] = 'masterorder-api';
            return 'https://' + parts.join('.');
        }
        if (parts.length >= 2 && parts[0] === 'staff') {
            return 'https://api.' + parts.slice(1).join('.');
        }
        if (parts.length >= 2 && parts[0] === 'order') {
            return 'https://api.' + parts.slice(1).join('.');
        }
        if (parts.length >= 2) {
            return 'https://api.' + parts.slice(1).join('.');
        }
        return 'https://' + h + ':8080';
    }

    function inferPublicApiBaseFromLocation(loc) {
        var locationRef = loc || (typeof window !== 'undefined' ? window.location : null);
        if (!locationRef || locationRef.protocol !== 'https:') {
            return null;
        }
        return inferPublicApiBaseFromHostname(locationRef.hostname);
    }

    function inferPublicOrderBaseFromHostname(hostname) {
        var h = String(hostname || '').toLowerCase().trim();
        if (!h) {
            return null;
        }
        var parts = h.split('.');
        if (parts.length >= 2 && parts[0].indexOf('masterorder-') === 0 && parts[0] !== 'masterorder-order') {
            parts[0] = 'masterorder-order';
            return 'https://' + parts.join('.');
        }
        if (parts.length >= 2 && parts[0] === 'staff') {
            return 'https://order.' + parts.slice(1).join('.');
        }
        return null;
    }

    function inferPublicOrderBaseFromLocation(loc) {
        var locationRef = loc || (typeof window !== 'undefined' ? window.location : null);
        if (!locationRef || locationRef.protocol !== 'https:') {
            return null;
        }
        var inferred = inferPublicOrderBaseFromHostname(locationRef.hostname);
        if (inferred) {
            return inferred;
        }
        return locationRef.origin || null;
    }

    function coerceApiBaseToHttpsWhenSecurePage(url) {
        if (!url || typeof window === 'undefined' || !window.isSecureContext) {
            return url;
        }
        const s = String(url);
        if (!s.startsWith('http://')) {
            return url;
        }
        try {
            const u = new URL(s);
            const host = (u.hostname || '').toLowerCase();
            if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
                return s;
            }
            if (u.hostname === 'server' || u.hostname === 'order' || u.hostname === 'client') {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn(
                        'MasterOrderCoreSdk: API base is a Docker service name ('
                            + u.hostname
                            + '). Set SERVER_BASE / window._serverBase to the public https API URL.'
                    );
                }
                return s;
            }
            return 'https://' + s.slice('http://'.length);
        } catch (_e) {
            return s;
        }
    }

    function parseBody(contentType, text) {
        if (!text) return null;
        if ((contentType || '').includes('application/json')) {
            try {
                return JSON.parse(text);
            } catch (_ignored) {
                return text;
            }
        }
        return text;
    }

    function looksLikeCloudflareChallengeHtml(text) {
        if (!text || typeof text !== 'string') {
            return false;
        }
        var s = text.slice(0, 4000);
        return s.indexOf('Just a moment') >= 0
            || s.indexOf('challenges.cloudflare.com') >= 0
            || s.indexOf('cf-browser-verification') >= 0
            || s.indexOf('Enable JavaScript and cookies to continue') >= 0
            || (s.indexOf('<html') >= 0 && s.indexOf('cloudflare') >= 0 && s.indexOf('challenge') >= 0);
    }

    function sanitizeSensitiveForLog(value) {
        if (value == null) {
            return value;
        }
        var s = String(value);
        s = s.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
        s = s.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_TOKEN]');
        return s;
    }

    function toApiError(status, payload) {
        if (typeof payload === 'string' && looksLikeCloudflareChallengeHtml(payload)) {
            return new ApiError(
                'ネットワーク保護の確認に失敗しました。通信環境を変えるか、しばらくしてから再試行してください。',
                status || 403,
                { code: 'CF_CHALLENGE', edgeBlocked: true }
            );
        }
        if (payload && typeof payload === 'object') {
            const rawMsg = payload.detail || payload.errorMessage || payload.message || payload.error || payload.reason || ('HTTP ' + status);
            const msg = sanitizeSensitiveForLog(String(rawMsg));
            if (looksLikeCloudflareChallengeHtml(msg)) {
                return new ApiError(
                    'ネットワーク保護の確認に失敗しました。通信環境を変えるか、しばらくしてから再試行してください。',
                    status || 403,
                    { code: 'CF_CHALLENGE', edgeBlocked: true, nested: payload }
                );
            }
            return new ApiError(msg, status, payload);
        }
        if (typeof payload === 'string' && payload.trim()) {
            var trimmed = payload.trim();
            if (trimmed.charAt(0) === '{' && trimmed.indexOf('"message"') >= 0) {
                try {
                    var parsed = JSON.parse(trimmed);
                    if (parsed && typeof parsed === 'object') {
                        var nested = parsed.detail || parsed.errorMessage || parsed.message || parsed.error || parsed.reason;
                        if (nested) {
                            return new ApiError(sanitizeSensitiveForLog(String(nested)), status, parsed);
                        }
                    }
                } catch (_) { /* keep raw string */ }
            }
            if (looksLikeCloudflareChallengeHtml(trimmed) || trimmed.indexOf('<html') >= 0 || trimmed.indexOf('<!DOCTYPE') >= 0) {
                return new ApiError(
                    'ネットワーク保護の確認に失敗しました。通信環境を変えるか、しばらくしてから再試行してください。',
                    status || 403,
                    { code: 'CF_CHALLENGE', edgeBlocked: true }
                );
            }
            return new ApiError(sanitizeSensitiveForLog(trimmed.slice(0, 240)), status, payload);
        }
        return new ApiError('HTTP ' + status, status, payload);
    }

    /**
     * fetch() 自体が reject したとき（DNS 断・オフライン・タイムアウト・CORS/エッジ遮断）を
     * 構造化 ApiError（status 0 + payload.code）に正規化する。
     * これで UI 側は生の "TypeError: Failed to fetch" ではなく code で分岐できる。
     *
     * 注意: レート制限などエッジ(Cloudflare)で 429 が返ると CORS ヘッダが付かず、
     * ブラウザからは通常のネットワークエラー(TypeError)と区別できない。
     * オンライン時の fetch 失敗は「エッジ遮断（＝アクセス集中/連打）」の可能性が高いため
     * code=EDGE_BLOCKED として扱い、オフライン時は code=OFFLINE に分ける。
     */
    function toNetworkApiError(err) {
        var name = err && err.name ? String(err.name) : '';
        if (name === 'AbortError' || name === 'TimeoutError') {
            return new ApiError('Request timed out', 0, { code: 'TIMEOUT' });
        }
        var online = typeof navigator === 'undefined' || navigator.onLine !== false;
        if (!online) {
            return new ApiError('Offline', 0, { code: 'OFFLINE' });
        }
        // クロスオリジン 502/503/WAF は CORS 無し TypeError になる。429 専用文言にすると原因が隠れる。
        return new ApiError(
            '通信に失敗しました。しばらく待ってからもう一度お試しください。',
            0,
            { code: 'NETWORK', retryable: true }
        );
    }

    function apiErrorCode(err) {
        if (!err) return '';
        if (err.payload && err.payload.code) return String(err.payload.code);
        if (err.code) return String(err.code);
        return '';
    }

    /** 429 / エッジ連打 / RATE_LIMITED — 自動再送してはいけない。 */
    function isRateLimitFailure(err) {
        if (!err) return false;
        if (Number(err.status) === 429) {
            return true;
        }
        var code = apiErrorCode(err);
        if (code === 'RATE_LIMITED' || code === 'EDGE_BLOCKED') {
            return true;
        }
        if (err.payload && err.payload.rateLimited === true) {
            return true;
        }
        var parts = [err.message];
        if (err.payload && typeof err.payload === 'object') {
            parts.push(err.payload.message, err.payload.error, err.payload.detail);
        }
        return /too many requests|rate.?limited|操作が早すぎ|リクエスト数の上限|リクエストが多すぎ|表示が早すぎ|送信が早すぎ/i
            .test(parts.filter(Boolean).join(' '));
    }

    /** HA 切替・トンネル一瞬切れ・Gateway タイムアウトなど、自動再送してよい失敗。 */
    function isTransientHttpFailure(err) {
        if (!err) return false;
        // レート制限を再送すると窓を食い潰して悪化する
        if (isRateLimitFailure(err)) {
            return false;
        }
        var status = err.status;
        if (status === 502 || status === 503 || status === 504 || status === 408) {
            return true;
        }
        var code = apiErrorCode(err);
        if (code === 'TIMEOUT' || code === 'NETWORK') {
            return true;
        }
        // Cloudflare の HTML 502/503 を CF_CHALLENGE に正規化している場合も再送する
        if (code === 'CF_CHALLENGE' && (status === 502 || status === 503 || status === 504 || status === 0)) {
            return true;
        }
        return false;
    }

    function headerLookup(headers, name) {
        if (!headers) return '';
        var lower = String(name).toLowerCase();
        for (var key in headers) {
            if (Object.prototype.hasOwnProperty.call(headers, key) && String(key).toLowerCase() === lower) {
                return headers[key];
            }
        }
        return '';
    }

    /**
     * retry: false | number | { retries, baseDelayMs, maxDelayMs }
     * 既定: GET/HEAD、または Idempotency-Key 付きリクエストは最大2回再送。
     */
    function resolveHttpRetryPolicy(opts, method, headers) {
        var empty = { retries: 0, baseDelayMs: 150, maxDelayMs: 1200 };
        if (!opts || opts.retry === false) {
            return empty;
        }
        if (typeof opts.retry === 'number') {
            return {
                retries: Math.max(0, opts.retry | 0),
                baseDelayMs: 150,
                maxDelayMs: 1200
            };
        }
        if (opts.retry && typeof opts.retry === 'object') {
            return {
                retries: Math.max(0, (opts.retry.retries != null ? opts.retry.retries : 2) | 0),
                baseDelayMs: opts.retry.baseDelayMs > 0 ? opts.retry.baseDelayMs : 150,
                maxDelayMs: opts.retry.maxDelayMs > 0 ? opts.retry.maxDelayMs : 1200
            };
        }
        var m = String(method || 'GET').toUpperCase();
        var hasIdem = !!headerLookup(headers, 'Idempotency-Key');
        if (m === 'GET' || m === 'HEAD' || hasIdem) {
            return { retries: 2, baseDelayMs: 150, maxDelayMs: 1200 };
        }
        return empty;
    }

    function sleepMs(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    var DEFAULT_TIME_ZONE = 'Asia/Tokyo';
    var SESSION_PIN_HEADER = 'X-Session-PIN';
    var CSRF_HEADER = 'X-XSRF-TOKEN';
    var CSRF_COOKIE_NAME = 'XSRF-TOKEN';

    function readCsrfTokenFromCookie() {
        if (typeof document === 'undefined' || !document.cookie) {
            return '';
        }
        var match = document.cookie.match(new RegExp('(?:^|;\\s*)' + CSRF_COOKIE_NAME + '=([^;]+)'));
        return match ? decodeURIComponent(match[1]) : '';
    }

    function isSameOriginApiBase(activeBase) {
        if (typeof window === 'undefined' || !window.location) {
            return false;
        }
        try {
            return new URL(String(activeBase)).origin === window.location.origin;
        } catch (_ignored) {
            return false;
        }
    }

    function isStateChangingMethod(method) {
        var normalized = String(method || 'GET').toUpperCase();
        return normalized !== 'GET'
            && normalized !== 'HEAD'
            && normalized !== 'OPTIONS'
            && normalized !== 'TRACE';
    }

    function withQuery(path, query) {
        var params = new URLSearchParams();
        Object.keys(query || {}).forEach(function (key) {
            var value = query[key];
            if (value !== undefined && value !== null && value !== '') {
                params.set(key, String(value));
            }
        });
        var qs = params.toString();
        return qs ? String(path || '') + '?' + qs : String(path || '');
    }

    /**
     * Firestore Timestamp / ISO / epoch を API 日時文字列（ISO-LDT）へ正規化。
     */
    function normalizeFirestoreDateTime(value) {
        if (value == null || value === '') {
            return null;
        }
        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : value.toISOString();
        }
        if (typeof value === 'object') {
            if (typeof value.toDate === 'function') {
                var fromTs = value.toDate();
                return fromTs && !Number.isNaN(fromTs.getTime()) ? fromTs.toISOString() : null;
            }
            if (value.seconds != null) {
                var ms = Number(value.seconds) * 1000 + Number(value.nanoseconds || 0) / 1e6;
                var epochDate = new Date(ms);
                return Number.isNaN(epochDate.getTime()) ? null : epochDate.toISOString();
            }
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            var numericDate = new Date(value);
            return Number.isNaN(numericDate.getTime()) ? null : numericDate.toISOString();
        }
        var text = String(value).trim();
        return text || null;
    }

    function apiLocalDateTimeOffsetSuffix(timeZone) {
        var tz = timeZone || DEFAULT_TIME_ZONE;
        if (tz === 'Asia/Tokyo') {
            return '+09:00';
        }
        return 'Z';
    }

    /**
     * サーバー {@code LocalDateTime}（オフセット無し ISO）を店舗タイムゾーンの瞬間として解釈する。
     * 無印 ISO に {@code Z} を付けると UTC 扱いになり、JST サーバーでは未来時刻→経過 0 になる。
     */
    function parseApiDateTime(value, options) {
        options = options || {};
        if (value == null || value === '') {
            return null;
        }
        var normalized = normalizeFirestoreDateTime(value);
        if (normalized && normalized !== value) {
            value = normalized;
        }
        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : value;
        }
        var raw = String(value).trim().replace(' ', 'T');
        if (!raw) {
            return null;
        }
        var hasOffset = /(?:Z|[+\-]\d{2}:\d{2})$/i.test(raw);
        var timeZone = options.timeZone || DEFAULT_TIME_ZONE;
        var d = new Date(hasOffset ? raw : raw + apiLocalDateTimeOffsetSuffix(timeZone));
        return Number.isNaN(d.getTime()) ? null : d;
    }

    function formatDateTime(value, options) {
        options = options || {};
        var timeZone = options.timeZone || DEFAULT_TIME_ZONE;
        var style = options.style || 'datetime';
        var fallback = options.fallback != null ? options.fallback : '-';
        var d = parseApiDateTime(value);
        if (!d) {
            if (typeof value === 'string' && value.trim() && style === 'time') {
                return value.trim();
            }
            return fallback;
        }
        if (style === 'time') {
            return d.toLocaleTimeString('ja-JP', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                timeZone: timeZone
            });
        }
        if (style === 'date') {
            return d.toLocaleDateString('ja-JP', {
                month: '2-digit',
                day: '2-digit',
                timeZone: timeZone
            });
        }
        return d.toLocaleString('ja-JP', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZone: timeZone
        });
    }

    function formatElapsed(value, options) {
        options = options || {};
        var fallback = options.fallback != null ? options.fallback : '-';
        var d = parseApiDateTime(value);
        if (!d) {
            return fallback;
        }
        var sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
        var h = Math.floor(sec / 3600);
        var m = Math.floor((sec % 3600) / 60);
        var s = sec % 60;
        if (h > 0) {
            return h + 'h ' + String(m).padStart(2, '0') + 'm';
        }
        return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }

    function normalizeRecommendMenusResponse(response) {
        if (!response || typeof response !== 'object') {
            return { maxMenus: 0, items: [] };
        }
        if (Array.isArray(response)) {
            return { maxMenus: response.length, items: response };
        }
        return {
            maxMenus: Number(response.maxMenus || 0),
            items: Array.isArray(response.items) ? response.items : []
        };
    }

    /** 注文明細1行（スタッフ UI / オフラインキャッシュ共通） */
    function normalizeOrderLineItem(raw) {
        if (!raw || typeof raw !== 'object') {
            return {
                menuName: '不明メニュー',
                quantity: 0,
                unitPrice: 0,
                subTotal: 0,
                toppings: []
            };
        }
        var quantity = Number(raw.quantity != null ? raw.quantity : 0);
        var unitPrice = Number(
            raw.unitPrice != null ? raw.unitPrice
                : (raw.priceAtOrder != null ? raw.priceAtOrder : 0)
        );
        var subTotal = Number(
            raw.subTotal != null ? raw.subTotal
                : (unitPrice * quantity)
        );
        var toppingsRaw = raw.toppings != null ? raw.toppings
            : (raw.selectedToppingSnapshots != null ? raw.selectedToppingSnapshots
                : (raw.toppingNames != null ? raw.toppingNames : null));
        var toppings = Array.isArray(toppingsRaw)
            ? toppingsRaw.map(function (top) {
                if (typeof top === 'string') {
                    var nameOnly = String(top).trim();
                    return nameOnly ? { name: nameOnly, price: 0 } : null;
                }
                return normalizeToppingLine(top);
            }).filter(Boolean)
            : [];
        var menuName = raw.menuName != null ? raw.menuName
            : (raw.menuNameSnapshot != null ? raw.menuNameSnapshot : '不明メニュー');
        // Guest/Firestore は integer menuId と menuPublicId を同居させうる。突き合わせは public UUID 優先。
        var menuPublicId = raw.menuPublicId != null && raw.menuPublicId !== ''
            ? String(raw.menuPublicId)
            : null;
        var menuId = menuPublicId != null
            ? menuPublicId
            : (raw.menuId != null && raw.menuId !== '' ? String(raw.menuId) : null);
        var servedQuantity = Number(raw.servedQuantity != null ? raw.servedQuantity : 0);
        var cancelledQuantity = Number(raw.cancelledQuantity != null ? raw.cancelledQuantity : 0);
        if (!Number.isFinite(cancelledQuantity) || cancelledQuantity < 0) {
            cancelledQuantity = 0;
        }
        var lineIndex = raw.lineIndex != null ? Number(raw.lineIndex) : null;
        var activeQuantity = Math.max(0, quantity - cancelledQuantity);
        var remainingQuantity = raw.remainingQuantity != null
            ? Number(raw.remainingQuantity)
            : Math.max(0, activeQuantity - servedQuantity);
        return {
            menuId: menuId,
            menuPublicId: menuPublicId,
            menuName: String(menuName),
            quantity: quantity,
            servedQuantity: servedQuantity,
            cancelledQuantity: cancelledQuantity,
            remainingQuantity: remainingQuantity,
            lineIndex: lineIndex,
            unitPrice: unitPrice,
            subTotal: subTotal,
            toppings: toppings,
            taxCategory: raw.taxCategory != null ? String(raw.taxCategory) : null,
            customTaxRatePercent: raw.customTaxRatePercent != null
                ? Number(raw.customTaxRatePercent)
                : null
        };
    }

    function normalizeToppingLine(raw) {
        if (!raw || typeof raw !== 'object') {
            return null;
        }
        return {
            name: raw.name != null ? String(raw.name) : '不明トッピング',
            price: Number(raw.price != null ? raw.price : 0)
        };
    }

    function normalizeOrderHistoryItem(raw) {
        if (!raw || typeof raw !== 'object') {
            return null;
        }
        var itemsRaw = raw.items;
        return {
            orderId: raw.orderId != null ? raw.orderId : raw.id,
            orderTime: raw.orderTime,
            status: raw.status,
            totalPrice: Number(raw.totalPrice != null ? raw.totalPrice : 0),
            items: Array.isArray(itemsRaw) ? itemsRaw.map(normalizeOrderLineItem) : [],
            warningFlag: !!raw.warningFlag,
            warningReason: raw.warningReason || null,
            cancelType: raw.cancelType || null,
            cancelReason: raw.cancelReason || null,
            cancelledAt: raw.cancelledAt || null,
            cancelledByPublicId: raw.cancelledByPublicId || null,
            cancelledByFullName: raw.cancelledByFullName || null,
            cancelledClientIp: raw.cancelledClientIp || null,
            guestAlias: raw.guestAlias || null,
            ordererNo: raw.ordererNo != null ? Number(raw.ordererNo) : null,
            servedAt: raw.servedAt || null,
            servedByPublicId: raw.servedByPublicId || null,
            servedByFullName: raw.servedByFullName || null,
            servedClientIp: raw.servedClientIp || null
        };
    }

    function normalizePendingOrder(raw) {
        if (!raw || typeof raw !== 'object') {
            return null;
        }
        var itemsRaw = raw.items;
        return {
            orderId: raw.orderId != null ? raw.orderId : raw.id,
            sessionId: raw.sessionId,
            tableNumber: raw.tableNumber,
            orderTime: raw.orderTime,
            status: raw.status != null ? raw.status : 'PREPARING',
            items: Array.isArray(itemsRaw) ? itemsRaw.map(normalizeOrderLineItem) : []
        };
    }

    function normalizePendingOrdersResponse(response) {
        if (!Array.isArray(response)) {
            return [];
        }
        return response.map(normalizePendingOrder).filter(Boolean);
    }

    var SHOP_REALTIME_TYPE = {
        REFRESH_ALL: 'REFRESH_ALL',
        ORDER_UPDATED: 'ORDER_UPDATED',
        SESSION_OPENED: 'SESSION_OPENED',
        SESSION_UPDATED: 'SESSION_UPDATED',
        SESSION_CLOSED: 'SESSION_CLOSED',
        STAFF_REQUEST: 'STAFF_REQUEST',
        ANALYTICS_UPDATED: 'ANALYTICS_UPDATED'
    };

    function parseShopRealtimeEvent(event, shopId) {
        var raw = event && event.data != null ? String(event.data) : '';
        if (!raw || !raw.trim()) {
            return { type: SHOP_REALTIME_TYPE.REFRESH_ALL, shopId: shopId, sessionId: null, orderId: null };
        }
        var trimmed = raw.trim();
        if (trimmed.toLowerCase() === 'refresh') {
            return { type: SHOP_REALTIME_TYPE.REFRESH_ALL, shopId: shopId, sessionId: null, orderId: null };
        }
        try {
            var parsed = JSON.parse(trimmed);
            if (parsed && parsed.type) {
                return {
                    type: parsed.type,
                    shopId: parsed.shopId != null ? parsed.shopId : shopId,
                    sessionId: parsed.sessionId || null,
                    orderId: parsed.orderId != null ? parsed.orderId : null
                };
            }
        } catch (_) { /* legacy payload */ }
        return { type: SHOP_REALTIME_TYPE.REFRESH_ALL, shopId: shopId, sessionId: null, orderId: null };
    }

    function buildPendingOrdersSignature(orders) {
        return (Array.isArray(orders) ? orders : [])
            .map(function (o) {
                // NOTE: SSE の ORDER_UPDATED で「合計金額/数量」だけが変わるケースがあるため、
                // orderId/status/time だけの署名だと silent load が再描画をスキップしやすい。
                // total・items・行ごとの残数を含め、提供済みラインの UI 更新漏れを避ける。
                var items = Array.isArray(o.items) ? o.items : [];
                var total = o.total != null ? o.total : (o.totalAmount != null ? o.totalAmount : 0);
                var lineSig = items.map(function (it) {
                    if (!it) {
                        return '';
                    }
                    return String(it.menuId || it.id || '')
                        + ':' + String(it.quantity != null ? it.quantity : '')
                        + ':' + String(it.remainingQuantity != null ? it.remainingQuantity : '')
                        + ':' + String(it.servedQuantity != null ? it.servedQuantity : '')
                        + ':' + String(it.cancelledQuantity != null ? it.cancelledQuantity : '');
                }).join(',');
                return String(o.orderId || '')
                    + ':' + String(o.status || 'PREPARING')
                    + ':' + String(o.orderTime || '')
                    + ':' + String(total || 0)
                    + ':' + String(items.length)
                    + ':' + lineSig;
            })
            .sort()
            .join('|');
    }

    function normalizeGuestCounts(raw, peoplesFallback) {
        var peoples = peoplesFallback != null ? Number(peoplesFallback) : 0;
        if (!Number.isFinite(peoples) || peoples < 0) {
            peoples = 0;
        }
        var source = raw && typeof raw === 'object' ? raw : null;
        var hasBreakdown = source && (
            source.male != null || source.female != null
            || source.unset != null || source.children != null
            || source.boys != null || source.girls != null
            || source.attrMale != null || source.attrFemale != null
            || source.attrOther != null || source.attrChildren != null
            || source.attrBoys != null || source.attrGirls != null
            || source.other != null || source.total != null
        );
        if (hasBreakdown) {
            var male = Math.max(0, Number(source.male != null ? source.male : source.attrMale) || 0);
            var female = Math.max(0, Number(source.female != null ? source.female : source.attrFemale) || 0);
            var unset = Math.max(0, Number(
                source.unset != null ? source.unset
                    : (source.attrOther != null ? source.attrOther : source.other)
            ) || 0);
            var boys = Math.max(0, Number(
                source.boys != null ? source.boys : source.attrBoys
            ) || 0);
            var girls = Math.max(0, Number(
                source.girls != null ? source.girls : source.attrGirls
            ) || 0);
            var children = Math.max(0, Number(
                source.children != null ? source.children : source.attrChildren
            ) || 0);
            // レガシー children のみ: 男児側へ寄せる
            if (boys <= 0 && girls <= 0 && children > 0) {
                boys = children;
            }
            children = boys + girls;
            var total = male + female + unset + boys + girls;
            if (total <= 0 && peoples > 0) {
                return {
                    male: 0, female: 0, unset: peoples, boys: 0, girls: 0, children: 0, total: peoples
                };
            }
            return {
                male: male, female: female, unset: unset,
                boys: boys, girls: girls, children: children, total: total
            };
        }
        return {
            male: 0, female: 0, unset: peoples, boys: 0, girls: 0, children: 0, total: peoples
        };
    }

    function isPartyFlagOn(value) {
        return value === true || value === 1 || value === 'true' || value === '1';
    }

    function readPartyFlag(source, key, altKey) {
        var row = source && typeof source === 'object' ? source : {};
        return isPartyFlagOn(row[key]) || isPartyFlagOn(row[altKey]);
    }

    function objectHasOwn(row, key) {
        return !!(row && typeof row === 'object' && Object.prototype.hasOwnProperty.call(row, key));
    }

    function hasPartyFlagFields(raw) {
        if (!raw || typeof raw !== 'object') {
            return false;
        }
        if (objectHasOwn(raw, 'partyFamily')
            || objectHasOwn(raw, 'partyCouple')
            || objectHasOwn(raw, 'partyCompanions')
            || objectHasOwn(raw, 'family')
            || objectHasOwn(raw, 'couple')
            || objectHasOwn(raw, 'companions')) {
            return true;
        }
        var nested = raw.partyFlags;
        if (!nested || typeof nested !== 'object') {
            return false;
        }
        return objectHasOwn(nested, 'family')
            || objectHasOwn(nested, 'couple')
            || objectHasOwn(nested, 'companions')
            || objectHasOwn(nested, 'partyFamily')
            || objectHasOwn(nested, 'partyCouple')
            || objectHasOwn(nested, 'partyCompanions');
    }

    function normalizePartyFlags(raw) {
        var source = raw && typeof raw === 'object' ? raw : {};
        var nested = source.partyFlags && typeof source.partyFlags === 'object'
            ? source.partyFlags
            : null;
        return {
            family: readPartyFlag(nested, 'family', 'partyFamily')
                || readPartyFlag(source, 'family', 'partyFamily'),
            couple: readPartyFlag(nested, 'couple', 'partyCouple')
                || readPartyFlag(source, 'couple', 'partyCouple'),
            companions: readPartyFlag(nested, 'companions', 'partyCompanions')
                || readPartyFlag(source, 'companions', 'partyCompanions')
        };
    }

    function normalizePartyFlagsOrNull(raw) {
        if (!hasPartyFlagFields(raw)) {
            return null;
        }
        return normalizePartyFlags(raw);
    }

    function partyFlagsSignature(raw) {
        var flags = normalizePartyFlags(raw);
        return [
            flags.family ? '1' : '0',
            flags.couple ? '1' : '0',
            flags.companions ? '1' : '0'
        ].join(':');
    }

    /**
     * Firestore 欠落（null）や REST の未確認 all-false で、直前の true を消さない。
     * 明示保存（confirmed）だけ all-false を通す。
     */
    function coalescePartyFlags(incoming, prev, options) {
        var opts = options || {};
        if (incoming == null) {
            return prev != null ? prev : null;
        }
        if (opts.confirmed === true) {
            return incoming;
        }
        var incomingNone = partyFlagsSignature(incoming) === '0:0:0';
        var prevAny = partyFlagsSignature(prev) !== '0:0:0';
        if (incomingNone && prevAny) {
            return prev;
        }
        return incoming;
    }

    function formatPartyFlagsLabel(raw) {
        var flags = normalizePartyFlags(raw);
        var parts = [];
        if (flags.family) {
            parts.push('家族');
        }
        if (flags.couple) {
            parts.push('カップル');
        }
        if (flags.companions) {
            parts.push('同伴');
        }
        return parts.join('・');
    }

    function normalizeActiveSessionListItem(item) {
        if (!item || typeof item !== 'object') {
            return null;
        }
        var sessionId = item.sessionId || item.id || '';
        if (!sessionId) {
            return null;
        }
        var peoples = item.peoples != null ? Number(item.peoples) : 0;
        var guestCounts = item.guestCounts
            ? normalizeGuestCounts(item.guestCounts, peoples)
            : normalizeGuestCounts({
                attrMale: item.attrMale,
                attrFemale: item.attrFemale,
                attrOther: item.attrOther,
                attrChildren: item.attrChildren,
                attrBoys: item.attrBoys,
                attrGirls: item.attrGirls
            }, peoples);
        return {
            sessionId: sessionId,
            shopId: item.shopId != null ? Number(item.shopId) : null,
            tableNumber: item.tableNumber != null ? Number(item.tableNumber) : 0,
            peoples: peoples,
            entryPin: item.entryPin || '',
            active: item.active !== false,
            startTime: normalizeFirestoreDateTime(item.startTime) || item.startTime || null,
            endTime: normalizeFirestoreDateTime(item.endTime) || item.endTime || null,
            totalAmount: item.totalAmount != null ? Number(item.totalAmount) : 0,
            orderCount: item.orderCount != null ? Number(item.orderCount) : 0,
            staffMemo: item.staffMemo != null ? item.staffMemo : null,
            joinToken: item.joinToken || null,
            guestCounts: guestCounts,
            partyFlags: normalizePartyFlags(item),
            staffRequestType: item.staffRequestType || null,
            staffRequestAt: item.staffRequestAt || null,
            detailsEnriched: true
        };
    }

    function normalizeActiveSessionListResponse(response) {
        var list = Array.isArray(response) ? response : [];
        return list.map(normalizeActiveSessionListItem).filter(Boolean);
    }

    function sessionListItemFromDetail(detail) {
        if (!detail || typeof detail !== 'object') {
            return null;
        }
        var tableNumber = detail.tableNumber != null ? Number(detail.tableNumber) : 0;
        var peoples = detail.peoples != null ? Number(detail.peoples) : 0;
        return {
            sessionId: detail.sessionId,
            tableNumber: Number.isFinite(tableNumber) && tableNumber > 0 ? tableNumber : 0,
            peoples: peoples,
            entryPin: detail.entryPin,
            joinToken: detail.joinToken,
            startTime: normalizeFirestoreDateTime(detail.startTime) || detail.startTime || null,
            totalAmount: detail.totalAmount || 0,
            active: detail.active !== false,
            guestCounts: normalizeGuestCounts(detail.guestCounts, peoples),
            partyFlags: normalizePartyFlags(detail),
            staffRequestType: detail.staffRequestType || null,
            staffRequestAt: detail.staffRequestAt || null,
            detailsEnriched: true
        };
    }

    function normalizeSessionDetailResponse(response) {
        if (!response || typeof response !== 'object') {
            return response;
        }
        var historyRaw = response.orderHistory;
        return Object.assign({}, response, {
            partyFlags: normalizePartyFlags(response),
            orderHistory: Array.isArray(historyRaw)
                ? historyRaw.map(normalizeOrderHistoryItem).filter(Boolean)
                : []
        });
    }

    function escapeHtml(value) {
        if (value == null) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /** ユーザー入力を DOM に安全に表示する（XSS 対策の第一選択） */
    function setTextContent(node, value) {
        if (!node) {
            return;
        }
        node.textContent = value == null ? '' : String(value);
    }

    function escapeHtmlDeep(value) {
        if (value == null) {
            return value;
        }
        if (Array.isArray(value)) {
            return value.map(escapeHtmlDeep);
        }
        if (typeof value === 'object') {
            var out = {};
            Object.keys(value).forEach(function (key) {
                out[key] = escapeHtmlDeep(value[key]);
            });
            return out;
        }
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return typeof value === 'string' ? escapeHtml(value) : value;
        }
        return value;
    }

    function isNodeQuarantineError(err) {
        if (!err) {
            return false;
        }
        var payload = err.payload;
        if (payload && typeof payload === 'object') {
            if (payload.code === 'CATALOG_STALE' || payload.code === 'PRICE_MISMATCH') {
                return false;
            }
            if (payload.code === 'GATE_NOT_CONFIGURED' || payload.code === 'MISCONFIGURED') {
                return false;
            }
            if (payload.code === 'NODE_QUARANTINED') {
                return true;
            }
        }
        if (err.status === 409) {
            return false;
        }
        if (err.status === 503) {
            return true;
        }
        return typeof err.message === 'string' && err.message.indexOf('NODE_QUARANTINED') >= 0;
    }

    function createHttpClient(options) {
        var rawBase = options && options.baseUrl ? options.baseUrl : '';
        if (global.MasterOrderApiRoutes && global.MasterOrderApiRoutes.assertNodeApiBaseUrl) {
            rawBase = global.MasterOrderApiRoutes.assertNodeApiBaseUrl(rawBase);
        }
        const baseUrl = coerceApiBaseToHttpsWhenSecurePage(rawBase);
        var fallbackRaw = (options && Array.isArray(options.fallbackBaseUrls))
            ? options.fallbackBaseUrls
            : [];
        var failoverOnQuarantine = !!(options && options.failoverOnQuarantine);
        const bases = [baseUrl].concat(
            fallbackRaw
                .filter(function (u) { return u != null && String(u).trim() !== ''; })
                .map(function (u) { return coerceApiBaseToHttpsWhenSecurePage(String(u)); })
        );
        const getAccessToken = options && options.getAccessToken ? options.getAccessToken : null;
        const onUnauthorized = options && options.onUnauthorized ? options.onUnauthorized : null;

        function resolveRequestSignal(opts) {
            if (opts && opts.signal) {
                return opts.signal;
            }
            var timeoutMs = opts && opts.timeoutMs > 0
                ? opts.timeoutMs
                : (options && options.requestTimeoutMs > 0 ? options.requestTimeoutMs : 20000);
            if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
                return AbortSignal.timeout(timeoutMs);
            }
            return undefined;
        }

        async function requestOnBaseOnce(activeBase, path, requestOptions) {
            const opts = requestOptions || {};
            const headers = Object.assign({}, opts.headers || {});
            const token = getAccessToken ? await Promise.resolve(getAccessToken()) : null;

            if (token) {
                headers.Authorization = 'Bearer ' + token;
            }
            var method = String(opts.method || 'GET').toUpperCase();
            if (!token && isStateChangingMethod(method)) {
                var csrfToken = readCsrfTokenFromCookie();
                if (csrfToken && !headers[CSRF_HEADER] && !headers['x-xsrf-token']) {
                    headers[CSRF_HEADER] = csrfToken;
                }
            }
            const hasBody = opts.body !== undefined && opts.body !== null;
            if (!headers['Content-Type'] && !headers['content-type'] && !(opts.body instanceof FormData)) {
                if (hasBody) {
                    headers['Content-Type'] = 'application/json';
                }
            }

            var fetchOpts = Object.assign({}, opts, { headers: headers });
            delete fetchOpts.timeoutMs;
            delete fetchOpts.retry;
            // 再送ごとに新しいタイムアウト（使い回しの AbortSignal.timeout を避ける）
            if (!opts.signal) {
                delete fetchOpts.signal;
                var timeoutSignal = resolveRequestSignal(opts);
                if (timeoutSignal) {
                    fetchOpts.signal = timeoutSignal;
                }
            }
            if (isSameOriginApiBase(activeBase) && fetchOpts.credentials == null) {
                fetchOpts.credentials = 'include';
            }

            let response;
            try {
                response = await fetch(joinUrl(activeBase, path), fetchOpts);
            } catch (netErr) {
                if (netErr instanceof ApiError) {
                    throw netErr;
                }
                throw toNetworkApiError(netErr);
            }
            const contentType = response.headers.get('content-type') || '';
            const text = await response.text();
            // Same-origin Pages proxy が Functions 未配備だと 200 HTML を返す。
            // JSON として黙って空メニューにしないよう、HTML 応答は常にエラーにする。
            if (looksLikeCloudflareChallengeHtml(text)
                || ((contentType.indexOf('text/html') >= 0) && text.indexOf('<html') >= 0)) {
                throw new ApiError(
                    response.ok
                        ? 'カタログAPIの応答が不正です。しばらくしてから再試行してください。'
                        : 'ネットワーク保護の確認に失敗しました。通信環境を変えるか、しばらくしてから再試行してください。',
                    response.ok ? 502 : (response.status || 403),
                    {
                        code: response.ok ? 'UNEXPECTED_HTML' : 'CF_CHALLENGE',
                        edgeBlocked: !response.ok
                    }
                );
            }
            const etag = response.headers.get('ETag') || response.headers.get('etag') || null;
            const pricingCacheRevision = response.headers.get('X-MO-Pricing-Cache-Revision')
                || response.headers.get('x-mo-pricing-cache-revision')
                || null;
            const overlayToken = response.headers.get('X-Mo-Overlay-Token')
                || response.headers.get('x-mo-overlay-token')
                || null;
            if (response.status === 304 && opts.acceptNotModified) {
                return opts.includeResponseMeta
                    ? {
                        body: null,
                        etag: etag,
                        status: 304,
                        notModified: true,
                        pricingCacheRevision: pricingCacheRevision,
                        overlayToken: overlayToken
                    }
                    : { __notModified: true, etag: etag };
            }
            const payload = parseBody(contentType, text);

            if (!response.ok) {
                if (response.status === 401 && onUnauthorized) {
                    onUnauthorized();
                }
                throw toApiError(response.status, payload);
            }
            if (opts.includeResponseMeta) {
                return {
                    body: payload,
                    etag: etag,
                    status: response.status,
                    notModified: false,
                    pricingCacheRevision: pricingCacheRevision,
                    overlayToken: overlayToken
                };
            }
            return payload;
        }

        async function requestOnBase(activeBase, path, requestOptions) {
            const opts = requestOptions || {};
            const headers = Object.assign({}, opts.headers || {});
            var method = String(opts.method || 'GET').toUpperCase();
            var policy = resolveHttpRetryPolicy(opts, method, headers);
            var attempt = 0;
            var lastErr = null;
            while (attempt <= policy.retries) {
                try {
                    return await requestOnBaseOnce(activeBase, path, opts);
                } catch (e) {
                    lastErr = e;
                    if (opts.signal && opts.signal.aborted) {
                        throw e;
                    }
                    if (attempt >= policy.retries || !isTransientHttpFailure(e)) {
                        throw e;
                    }
                    var delay = Math.min(
                        policy.maxDelayMs,
                        policy.baseDelayMs * Math.pow(2, attempt)
                    );
                    delay += Math.floor(Math.random() * 80);
                    await sleepMs(delay);
                    attempt += 1;
                }
            }
            throw lastErr || new ApiError('Request failed', 503, { code: 'RETRY_EXHAUSTED' });
        }

        async function request(path, requestOptions) {
            var lastErr = null;
            for (var i = 0; i < bases.length; i++) {
                try {
                    return await requestOnBase(bases[i], path, requestOptions);
                } catch (e) {
                    if (isNodeQuarantineError(e) && failoverOnQuarantine && i < bases.length - 1) {
                        lastErr = e;
                        continue;
                    }
                    throw e;
                }
            }
            throw lastErr || new ApiError('All API nodes unavailable', 503, { code: 'NODE_QUARANTINED' });
        }

        return {
            request: request,
            get: function (path, options) {
                return request(path, Object.assign({}, options, { method: 'GET' }));
            },
            post: function (path, body, options) {
                return request(path, Object.assign({}, options, {
                    method: 'POST',
                    body: body === undefined ? undefined : JSON.stringify(body)
                }));
            },
            patch: function (path, body, options) {
                return request(path, Object.assign({}, options, {
                    method: 'PATCH',
                    body: body === undefined ? undefined : JSON.stringify(body)
                }));
            },
            delete: function (path, options) {
                return request(path, Object.assign({}, options, { method: 'DELETE' }));
            }
        };
    }

    var DEFAULT_PROFILE_NAME_PLACEHOLDER = '—';

    function buildProfileFullName(familyName, givenName, fallback) {
        var family = familyName ? String(familyName).trim() : '';
        var given = givenName ? String(givenName).trim() : '';
        if (family && given) {
            return family + given;
        }
        if (family) {
            return family;
        }
        if (given) {
            return given;
        }
        return fallback || DEFAULT_PROFILE_NAME_PLACEHOLDER;
    }

    function resolveDisplayFamilyName(profile, placeholder) {
        var value = profile && profile.familyName ? String(profile.familyName).trim() : '';
        return value || placeholder || DEFAULT_PROFILE_NAME_PLACEHOLDER;
    }

    function normalizeUserProfile(raw) {
        if (!raw || typeof raw !== 'object') {
            return null;
        }
        var termsAcceptedAt = raw.termsAcceptedAt || null;
        var termsAccepted = raw.termsAccepted === true
            || (termsAcceptedAt != null && String(termsAcceptedAt).trim() !== '');
        return {
            familyName: raw.familyName || null,
            givenName: raw.givenName || null,
            fullName: raw.fullName || buildProfileFullName(raw.familyName, raw.givenName, ''),
            email: raw.email || null,
            publicId: raw.publicId || null,
            firebaseUid: raw.firebaseUid || raw.userId || null,
            termsAccepted: termsAccepted,
            termsAcceptedAt: termsAcceptedAt
        };
    }

    /**
     * アカウント状態 API（SecurityLock / LOCK / BAN）。
     * @param {ReturnType<typeof createHttpClient>} http
     * @param {{ myAccountStatus?: function, passwordResetCompleted?: function }} pathBuilders
     */
    function createAccountStateApi(http, pathBuilders) {
        var paths = pathBuilders || {};

        function getMyAccountStatus() {
            return http.get(paths.myAccountStatus ? paths.myAccountStatus() : '/auth/me/account-status');
        }

        /** Firebase パスワードリセット後の再ログイン直後に呼ぶ（SecurityLock のみ解除）。 */
        function reportPasswordResetCompleted() {
            return http.request(paths.passwordResetCompleted ? paths.passwordResetCompleted() : '/auth/password-reset-completed', {
                method: 'POST',
                body: '{}'
            });
        }

        return {
            getMyAccountStatus: getMyAccountStatus,
            reportPasswordResetCompleted: reportPasswordResetCompleted
        };
    }

    /**
     * ユーザープロフィール API（Staff / Order 共通 — Firebase 認証付き HTTP が前提）。
     * @param {ReturnType<typeof createHttpClient>} http
     * @param {{ myProfile: function, updateMyProfile: function, setMyPublicId: function }} pathBuilders
     */
    function createProfileApi(http, pathBuilders) {
        var paths = pathBuilders || {};

        function getMyProfile() {
            return http.get(paths.myProfile()).then(normalizeUserProfile);
        }

        function updateMyProfile(payload) {
            var body = payload || {};
            return http.request(paths.updateMyProfile(), {
                method: 'PATCH',
                body: JSON.stringify({
                    familyName: body.familyName != null ? body.familyName : null,
                    givenName: body.givenName != null ? body.givenName : null,
                    acceptTerms: body.acceptTerms === true ? true : undefined
                })
            }).then(normalizeUserProfile);
        }

        function setMyPublicId(publicId) {
            return http.request(paths.setMyPublicId(), {
                method: 'PATCH',
                body: JSON.stringify({ publicId: String(publicId || '').trim() })
            }).then(normalizeUserProfile);
        }

        /**
         * 名前 + 初回のみ @public_id をまとめて保存。
         * @param {{ familyName?: string, givenName?: string, publicId?: string, allowPublicId?: boolean, acceptTerms?: boolean }} edit
         */
        function saveProfile(edit) {
            var input = edit || {};
            var familyName = input.familyName != null ? String(input.familyName).trim() : '';
            var givenName = input.givenName != null ? String(input.givenName).trim() : '';
            if (!familyName && !givenName) {
                return Promise.reject(new Error('familyName or givenName required'));
            }
            return updateMyProfile({
                familyName: familyName || null,
                givenName: givenName || null,
                acceptTerms: input.acceptTerms === true
            }).then(function (profile) {
                var wantsPublicId = input.allowPublicId !== false
                    && input.publicId != null
                    && String(input.publicId).trim();
                if (!wantsPublicId || (profile && profile.publicId)) {
                    return profile;
                }
                return setMyPublicId(input.publicId);
            });
        }

        return {
            getMyProfile: getMyProfile,
            updateMyProfile: updateMyProfile,
            setMyPublicId: setMyPublicId,
            saveProfile: saveProfile
        };
    }

    function createSseClient(options) {
        const opts = options || {};
        const reconnectDelayMs = opts.reconnectDelayMs > 0 ? opts.reconnectDelayMs : 5000;
        const maxReconnectDelayMs = opts.maxReconnectDelayMs > 0 ? opts.maxReconnectDelayMs : 120000;
        const minReconnectGapMs = opts.minReconnectGapMs > 0 ? opts.minReconnectGapMs : 15000;
        const staleTimeoutMs = opts.staleTimeoutMs > 0 ? opts.staleTimeoutMs : 90000;
        const staleCheckIntervalMs = opts.staleCheckIntervalMs > 0 ? opts.staleCheckIntervalMs : 30000;
        const heartbeatEventName = opts.heartbeatEventName || 'heartbeat';
        let source = null;
        let timer = null;
        let staleCheckTimer = null;
        let activeParams = null;
        let reconnectAttempts = 0;
        let lastActivityAt = 0;
        let lastNamedEventAt = 0;

        function markActivity() {
            lastActivityAt = Date.now();
            reconnectAttempts = 0;
        }

        function markNamedEvent() {
            lastNamedEventAt = Date.now();
            markActivity();
        }

        function clearTimers() {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            if (staleCheckTimer) {
                clearInterval(staleCheckTimer);
                staleCheckTimer = null;
            }
        }

        function closeSourceOnly() {
            if (source) {
                source.close();
                source = null;
            }
        }

        function close() {
            clearTimers();
            closeSourceOnly();
            activeParams = null;
            reconnectAttempts = 0;
            lastActivityAt = 0;
            lastNamedEventAt = 0;
        }

        function scheduleReconnect() {
            if (!activeParams) {
                return;
            }
            clearTimers();
            const sinceActivity = lastActivityAt > 0 ? (Date.now() - lastActivityAt) : 0;
            const backoff = Math.min(
                reconnectDelayMs * Math.pow(2, Math.min(reconnectAttempts, 5)),
                maxReconnectDelayMs
            );
            const delay = Math.max(minReconnectGapMs, backoff, sinceActivity < minReconnectGapMs ? minReconnectGapMs : 0);
            reconnectAttempts += 1;
            timer = setTimeout(function () {
                timer = null;
                connectAsync(activeParams).catch(function () {
                    scheduleReconnect();
                });
            }, delay);
        }

        function forceReconnect() {
            if (!activeParams) {
                return Promise.resolve();
            }
            closeSourceOnly();
            return connectAsync(activeParams).catch(function () {
                scheduleReconnect();
            });
        }

        function startStaleWatch() {
            if (staleCheckTimer) {
                clearInterval(staleCheckTimer);
            }
            staleCheckTimer = setInterval(function () {
                if (!source || source.readyState !== EventSource.OPEN || !lastActivityAt) {
                    return;
                }
                if (Date.now() - lastActivityAt > staleTimeoutMs) {
                    forceReconnect();
                }
            }, staleCheckIntervalMs);
        }

        function buildEventSourceUrl(params, sseTicket) {
            const rawUrl = coerceApiBaseToHttpsWhenSecurePage(params.url);
            const url = new URL(rawUrl, window.location.origin);
            if (params.query) {
                Object.keys(params.query).forEach(function (key) {
                    const value = params.query[key];
                    if (value !== undefined && value !== null && value !== '') {
                        url.searchParams.set(key, String(value));
                    }
                });
            }
            if (sseTicket) {
                url.searchParams.set('sseTicket', sseTicket);
            }
            return url.toString();
        }

        function buildConnectionHandle() {
            return {
                close: close,
                getReadyState: function () {
                    return source ? source.readyState : EventSource.CLOSED;
                },
                getLastActivityAt: function () {
                    return lastActivityAt;
                },
                getLastNamedEventAt: function () {
                    return lastNamedEventAt;
                },
                forceReconnect: forceReconnect
            };
        }

        function wireEventSourceHandlers(params) {
            source.addEventListener(heartbeatEventName, function () {
                markActivity();
            });
            if (params.eventName && params.onMessage) {
                source.addEventListener(params.eventName, function (event) {
                    markNamedEvent();
                    params.onMessage(event);
                });
            }
            source.onopen = function (event) {
                markActivity();
                startStaleWatch();
                if (params.onOpen) {
                    params.onOpen(event);
                }
            };
            source.onerror = function (event) {
                if (params.onError) {
                    params.onError(event);
                }
                closeSourceOnly();
                scheduleReconnect();
            };
        }

        /**
         * 同期で SSE を開く場合は既に発行済みの sseTicket のみ可。
         * チケット発行が必要なときは connectAsync を使ってください。
         */
        function connect(params) {
            close();
            if (!params || !params.sseTicket) {
                throw new Error('MasterOrderCoreSdk: connect() requires params.sseTicket; use connectAsync({ fetchTicket }) to issue a ticket without putting ID tokens in the URL.');
            }
            activeParams = params;
            source = new EventSource(buildEventSourceUrl(params, params.sseTicket));
            wireEventSourceHandlers(params);
            return buildConnectionHandle();
        }

        async function connectAsync(params) {
            clearTimers();
            closeSourceOnly();
            activeParams = params;
            var sseTicket = params.sseTicket;
            if (params.fetchTicket) {
                sseTicket = await params.fetchTicket();
            }
            if (!sseTicket) {
                throw new Error('MasterOrderCoreSdk: connectAsync requires sseTicket or fetchTicket');
            }
            source = new EventSource(buildEventSourceUrl(params, sseTicket));
            wireEventSourceHandlers(params);
            return buildConnectionHandle();
        }

        return {
            connect: connect,
            connectAsync: connectAsync,
            close: close,
            forceReconnect: forceReconnect,
            getLastActivityAt: function () {
                return lastActivityAt;
            },
            getLastNamedEventAt: function () {
                return lastNamedEventAt;
            }
        };
    }

    global.MasterOrderCoreSdk = {
        VERSION: SDK_VERSION,
        getApiRoutes: function () {
            return global.MasterOrderApiRoutes || null;
        },
        inferPublicApiBaseFromHostname: inferPublicApiBaseFromHostname,
        inferPublicApiBaseFromLocation: inferPublicApiBaseFromLocation,
        inferPublicOrderBaseFromHostname: inferPublicOrderBaseFromHostname,
        inferPublicOrderBaseFromLocation: inferPublicOrderBaseFromLocation,
        ApiError: ApiError,
        DEFAULT_TIME_ZONE: DEFAULT_TIME_ZONE,
        SESSION_PIN_HEADER: SESSION_PIN_HEADER,
        createHttpClient: createHttpClient,
        isTransientHttpFailure: isTransientHttpFailure,
        isRateLimitFailure: isRateLimitFailure,
        createAccountStateApi: createAccountStateApi,
        createProfileApi: createProfileApi,
        createSseClient: createSseClient,
        buildProfileFullName: buildProfileFullName,
        resolveDisplayFamilyName: resolveDisplayFamilyName,
        normalizeUserProfile: normalizeUserProfile,
        DEFAULT_PROFILE_NAME_PLACEHOLDER: DEFAULT_PROFILE_NAME_PLACEHOLDER,
        withQuery: withQuery,
        normalizeFirestoreDateTime: normalizeFirestoreDateTime,
        parseApiDateTime: parseApiDateTime,
        apiLocalDateTimeOffsetSuffix: apiLocalDateTimeOffsetSuffix,
        formatDateTime: formatDateTime,
        formatElapsed: formatElapsed,
        normalizeRecommendMenusResponse: normalizeRecommendMenusResponse,
        normalizeOrderLineItem: normalizeOrderLineItem,
        normalizeToppingLine: normalizeToppingLine,
        normalizeOrderHistoryItem: normalizeOrderHistoryItem,
        normalizePendingOrder: normalizePendingOrder,
        normalizePendingOrdersResponse: normalizePendingOrdersResponse,
        normalizeSessionDetailResponse: normalizeSessionDetailResponse,
        SHOP_REALTIME_TYPE: SHOP_REALTIME_TYPE,
        parseShopRealtimeEvent: parseShopRealtimeEvent,
        buildPendingOrdersSignature: buildPendingOrdersSignature,
        normalizeGuestCounts: normalizeGuestCounts,
        normalizePartyFlags: normalizePartyFlags,
        normalizePartyFlagsOrNull: normalizePartyFlagsOrNull,
        hasPartyFlagFields: hasPartyFlagFields,
        coalescePartyFlags: coalescePartyFlags,
        formatPartyFlagsLabel: formatPartyFlagsLabel,
        partyFlagsSignature: partyFlagsSignature,
        normalizeActiveSessionListItem: normalizeActiveSessionListItem,
        normalizeActiveSessionListResponse: normalizeActiveSessionListResponse,
        sessionListItemFromDetail: sessionListItemFromDetail,
        escapeHtml: escapeHtml,
        escapeHtmlDeep: escapeHtmlDeep,
        sanitizeSensitiveForLog: sanitizeSensitiveForLog,
        setTextContent: setTextContent
    };
})(typeof window !== 'undefined' ? window : globalThis);
