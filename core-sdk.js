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

    var SDK_VERSION = '1.1.0';

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

    function toApiError(status, payload) {
        if (payload && typeof payload === 'object') {
            const msg = payload.detail || payload.errorMessage || payload.error || payload.message || payload.reason || ('HTTP ' + status);
            return new ApiError(msg, status, payload);
        }
        if (typeof payload === 'string' && payload.trim()) {
            return new ApiError(payload, status, payload);
        }
        return new ApiError('HTTP ' + status, status, payload);
    }

    var DEFAULT_TIME_ZONE = 'Asia/Tokyo';
    var SESSION_PIN_HEADER = 'X-Session-PIN';

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
        var toppingsRaw = raw.toppings != null ? raw.toppings : raw.selectedToppingSnapshots;
        var toppings = Array.isArray(toppingsRaw)
            ? toppingsRaw.map(normalizeToppingLine).filter(Boolean)
            : [];
        var menuName = raw.menuName != null ? raw.menuName
            : (raw.menuNameSnapshot != null ? raw.menuNameSnapshot : '不明メニュー');
        var menuId = raw.menuId != null ? raw.menuId : raw.menuPublicId;
        var servedQuantity = Number(raw.servedQuantity != null ? raw.servedQuantity : 0);
        var lineIndex = raw.lineIndex != null ? Number(raw.lineIndex) : null;
        var remainingQuantity = raw.remainingQuantity != null
            ? Number(raw.remainingQuantity)
            : Math.max(0, quantity - servedQuantity);
        return {
            menuId: menuId != null ? String(menuId) : null,
            menuName: String(menuName),
            quantity: quantity,
            servedQuantity: servedQuantity,
            remainingQuantity: remainingQuantity,
            lineIndex: lineIndex,
            unitPrice: unitPrice,
            subTotal: subTotal,
            toppings: toppings
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
            items: Array.isArray(itemsRaw) ? itemsRaw.map(normalizeOrderLineItem) : []
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
        SESSION_CLOSED: 'SESSION_CLOSED'
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
                // total と items count を含め、UI 更新漏れを避ける。
                var items = Array.isArray(o.items) ? o.items : [];
                var total = o.total != null ? o.total : (o.totalAmount != null ? o.totalAmount : 0);
                return String(o.orderId || '')
                    + ':' + String(o.status || 'PREPARING')
                    + ':' + String(o.orderTime || '')
                    + ':' + String(total || 0)
                    + ':' + String(items.length);
            })
            .sort()
            .join('|');
    }

    function normalizeActiveSessionListItem(item) {
        if (!item || typeof item !== 'object') {
            return null;
        }
        var sessionId = item.sessionId || item.id || '';
        if (!sessionId) {
            return null;
        }
        return {
            sessionId: sessionId,
            shopId: item.shopId != null ? Number(item.shopId) : null,
            tableNumber: item.tableNumber != null ? Number(item.tableNumber) : 0,
            peoples: item.peoples != null ? Number(item.peoples) : 0,
            entryPin: item.entryPin || '',
            active: item.active !== false,
            startTime: normalizeFirestoreDateTime(item.startTime) || item.startTime || null,
            endTime: normalizeFirestoreDateTime(item.endTime) || item.endTime || null,
            totalAmount: item.totalAmount != null ? Number(item.totalAmount) : 0,
            orderCount: item.orderCount != null ? Number(item.orderCount) : 0,
            staffMemo: item.staffMemo != null ? item.staffMemo : null,
            joinToken: item.joinToken || null,
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
        return {
            sessionId: detail.sessionId,
            tableNumber: detail.tableNumber,
            peoples: detail.peoples,
            entryPin: detail.entryPin,
            joinToken: detail.joinToken,
            startTime: normalizeFirestoreDateTime(detail.startTime) || detail.startTime || null,
            totalAmount: detail.totalAmount || 0,
            active: detail.active !== false,
            detailsEnriched: true
        };
    }

    function normalizeSessionDetailResponse(response) {
        if (!response || typeof response !== 'object') {
            return response;
        }
        var historyRaw = response.orderHistory;
        return Object.assign({}, response, {
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

    function createHttpClient(options) {
        var rawBase = options && options.baseUrl ? options.baseUrl : '';
        if (global.MasterOrderApiRoutes && global.MasterOrderApiRoutes.assertNodeApiBaseUrl) {
            rawBase = global.MasterOrderApiRoutes.assertNodeApiBaseUrl(rawBase);
        }
        const baseUrl = coerceApiBaseToHttpsWhenSecurePage(rawBase);
        const getAccessToken = options && options.getAccessToken ? options.getAccessToken : null;
        const onUnauthorized = options && options.onUnauthorized ? options.onUnauthorized : null;

        async function request(path, requestOptions) {
            const opts = requestOptions || {};
            const headers = Object.assign({}, opts.headers || {});
            const token = getAccessToken ? await Promise.resolve(getAccessToken()) : null;

            if (token) {
                headers.Authorization = 'Bearer ' + token;
            }
            const hasBody = opts.body !== undefined && opts.body !== null;
            if (!headers['Content-Type'] && !headers['content-type'] && !(opts.body instanceof FormData)) {
                if (hasBody) {
                    headers['Content-Type'] = 'application/json';
                }
            }

            const response = await fetch(joinUrl(baseUrl, path), Object.assign({}, opts, { headers: headers }));
            const contentType = response.headers.get('content-type') || '';
            const text = await response.text();
            const payload = parseBody(contentType, text);

            if (!response.ok) {
                if (response.status === 401 && onUnauthorized) {
                    onUnauthorized();
                }
                throw toApiError(response.status, payload);
            }
            return payload;
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
        return {
            familyName: raw.familyName || null,
            givenName: raw.givenName || null,
            fullName: raw.fullName || buildProfileFullName(raw.familyName, raw.givenName, ''),
            email: raw.email || null,
            publicId: raw.publicId || null,
            firebaseUid: raw.firebaseUid || raw.userId || null
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
            return http.request(paths.updateMyProfile(), {
                method: 'PATCH',
                body: JSON.stringify(payload || {})
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
         * @param {{ familyName?: string, givenName?: string, publicId?: string, allowPublicId?: boolean }} edit
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
                givenName: givenName || null
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
        normalizeActiveSessionListItem: normalizeActiveSessionListItem,
        normalizeActiveSessionListResponse: normalizeActiveSessionListResponse,
        sessionListItemFromDetail: sessionListItemFromDetail,
        escapeHtml: escapeHtml,
        escapeHtmlDeep: escapeHtmlDeep,
        setTextContent: setTextContent
    };
})(typeof window !== 'undefined' ? window : globalThis);
