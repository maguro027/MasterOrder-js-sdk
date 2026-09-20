/**
 * MasterOrder Staff UI SDK — 表示フォーマット・セッション読込 UI・注文ソート等。
 *
 * 依存: なし（MasterOrderCoreSdk / MasterOrderStaffKiteiSdk は任意）
 * グローバル: MasterOrderStaffUiSdk
 */
(function (global) {
    'use strict';

    var SDK_VERSION = '1.0.0';

    var FIRESTORE_RATE_LIMIT_MESSAGE =
        'Firestore レート制限中です。しばらく待ってから再試行してください。';

    var HTTP_RATE_LIMIT_MESSAGE =
        '操作が早すぎます。しばらく待ってからもう一度お試しください。';

    var PENDING_ORDERS_SORT_WAIT_DESC = 'wait-desc';
    var PENDING_ORDERS_SORT_WAIT_ASC = 'wait-asc';

    var FIRESTORE_BACKOFF_MS = 120000;
    var HTTP_RATE_LIMIT_BACKOFF_MS = 15000;

    function createFirestoreBackoff() {
        var firestoreBackoffUntil = 0;

        function isRateLimitError(err) {
            var msg = err && err.message ? String(err.message) : '';
            var detail = err && err.payload && err.payload.detail ? String(err.payload.detail) : '';
            var title = err && err.payload && err.payload.title ? String(err.payload.title) : '';
            var combined = [msg, detail, title].join(' ');
            return /Firestore.*レート制限|レート制限中|読み取り上限|Firestore rate limited|quota exceeded/i.test(combined);
        }

        function mark(err) {
            if (isRateLimitError(err)) {
                firestoreBackoffUntil = Date.now() + FIRESTORE_BACKOFF_MS;
            }
        }

        function isActive() {
            return Date.now() < firestoreBackoffUntil;
        }

        return {
            isRateLimitError: isRateLimitError,
            mark: mark,
            isActive: isActive
        };
    }

    function createHttpRateLimitBackoff() {
        var until = 0;
        function mark(err) {
            if (isHttpRateLimited(err)) {
                until = Date.now() + HTTP_RATE_LIMIT_BACKOFF_MS;
            }
        }
        function isActive() {
            return Date.now() < until;
        }
        return { mark: mark, isActive: isActive };
    }

    function isHttpRateLimited(err) {
        if (!err) {
            return false;
        }
        if (Number(err.status) === 429) {
            return true;
        }
        var core = global.MasterOrderCoreSdk;
        if (core && typeof core.isRateLimitFailure === 'function') {
            return core.isRateLimitFailure(err);
        }
        var code = err.payload && err.payload.code ? String(err.payload.code) : '';
        if (code === 'RATE_LIMITED' || code === 'EDGE_BLOCKED') {
            return true;
        }
        var parts = [err.message];
        if (err.payload && typeof err.payload === 'object') {
            parts.push(err.payload.message, err.payload.error, err.payload.detail);
        }
        return /too many requests|rate.?limited|操作が早すぎ|リクエスト数の上限|リクエストが多すぎ/i
            .test(parts.filter(Boolean).join(' '));
    }

    function extractProblemDetailMessage(raw) {
        if (raw == null) {
            return '';
        }
        var text = String(raw).trim();
        if (!text) {
            return '';
        }
        if (text.charAt(0) === '{' && (text.indexOf('"detail"') >= 0 || text.indexOf('"message"') >= 0)) {
            try {
                var parsed = JSON.parse(text);
                if (parsed && typeof parsed === 'object') {
                    if (parsed.message != null && String(parsed.message).trim()) {
                        return String(parsed.message).trim();
                    }
                    if (parsed.detail != null && String(parsed.detail).trim()) {
                        return String(parsed.detail).trim();
                    }
                    if (parsed.title != null && String(parsed.title).trim()) {
                        return String(parsed.title).trim();
                    }
                }
            } catch (_parseErr) {
                // keep original text
            }
        }
        return text;
    }

    var UNKNOWN_PROBLEM_MESSAGE = '未知の問題が発生しました';

    function logStaffError(context, err) {
        if (typeof console !== 'undefined' && typeof console.debug === 'function') {
            console.debug('[staff]', context || 'error', err);
        }
    }

    function staffUserVisibleLoadError(err, fallback, backoff) {
        logStaffError('load', err);
        var rateLimitCheck = backoff && typeof backoff.isRateLimitError === 'function'
            ? backoff.isRateLimitError
            : createFirestoreBackoff().isRateLimitError;
        if (rateLimitCheck(err) || isHttpRateLimited(err)) {
            return formatStaffApiError(err, fallback || UNKNOWN_PROBLEM_MESSAGE, backoff);
        }
        return fallback || UNKNOWN_PROBLEM_MESSAGE;
    }

    function formatStaffApiError(err, fallback, backoff) {
        var rateLimitCheck = backoff && typeof backoff.isRateLimitError === 'function'
            ? backoff.isRateLimitError
            : createFirestoreBackoff().isRateLimitError;
        if (rateLimitCheck(err)) {
            return FIRESTORE_RATE_LIMIT_MESSAGE;
        }
        if (isHttpRateLimited(err)) {
            var serverMsg = '';
            if (err && err.payload && err.payload.message) {
                serverMsg = String(err.payload.message).trim();
            }
            if (!serverMsg && err && err.message) {
                serverMsg = extractProblemDetailMessage(err.message);
            }
            if (serverMsg && /早すぎ|多すぎ|上限|rate|too many/i.test(serverMsg)) {
                return serverMsg;
            }
            return HTTP_RATE_LIMIT_MESSAGE;
        }
        if (err && err.detail != null && String(err.detail).trim()) {
            return String(err.detail).trim();
        }
        var msg = err && err.message ? extractProblemDetailMessage(err.message) : '';
        return msg || fallback || '不明なエラー';
    }

    function promiseWithTimeout(promise, timeoutMs, label) {
        var ms = timeoutMs > 0 ? timeoutMs : 15000;
        return new Promise(function (resolve, reject) {
            var timer = global.setTimeout(function () {
                reject(new Error((label || 'API') + ' がタイムアウトしました（' + Math.round(ms / 1000) + '秒）'));
            }, ms);
            Promise.resolve(promise).then(
                function (value) {
                    global.clearTimeout(timer);
                    resolve(value);
                },
                function (err) {
                    global.clearTimeout(timer);
                    reject(err);
                }
            );
        });
    }

    function formatDateTimeFallback(value) {
        if (!value) {
            return '-';
        }
        var d = new Date(value);
        if (Number.isNaN(d.getTime())) {
            return '-';
        }
        return d.toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }

    function formatElapsed(value) {
        var core = global.MasterOrderCoreSdk;
        if (core && typeof core.formatElapsed === 'function') {
            return core.formatElapsed(value);
        }
        if (!value) {
            return '-';
        }
        var raw = String(value).trim().replace(' ', 'T');
        var hasOffset = /(?:Z|[+\-]\d{2}:\d{2})$/i.test(raw);
        var base = new Date(hasOffset ? raw : raw + 'Z');
        if (Number.isNaN(base.getTime())) {
            return '-';
        }
        var sec = Math.max(0, Math.floor((Date.now() - base.getTime()) / 1000));
        var h = Math.floor(sec / 3600);
        var m = Math.floor((sec % 3600) / 60);
        var s = sec % 60;
        if (h > 0) {
            return h + 'h ' + String(m).padStart(2, '0') + 'm';
        }
        return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }

    function formatOrderTime(value) {
        var core = global.MasterOrderCoreSdk;
        if (core && typeof core.formatDateTime === 'function') {
            return core.formatDateTime(value, { style: 'time' });
        }
        return formatDateTimeFallback(value);
    }

    function yen(value) {
        return '\u00A5' + Number(value || 0).toLocaleString();
    }

    function yenTaxIncluded(value) {
        return yen(value);
    }

    /**
     * 管理メニュー一覧に GET /inventory/shops/{shopId} の在庫を合成する。
     * @param {Array} menus
     * @param {Array} inventoryRows InventoryView[]（menuId = public UUID）
     */
    function mergeMenusWithInventory(menus, inventoryRows) {
        var list = Array.isArray(menus) ? menus : [];
        var rows = Array.isArray(inventoryRows) ? inventoryRows : [];
        if (!rows.length) {
            return list.slice();
        }
        var byMenuId = {};
        for (var i = 0; i < rows.length; i += 1) {
            var row = rows[i];
            if (!row) {
                continue;
            }
            var key = String(row.menuId || row.id || '');
            if (key) {
                byMenuId[key] = row;
            }
        }
        return list.map(function (menu) {
            if (!menu) {
                return menu;
            }
            var inv = byMenuId[String(menu.id || menu.menuId || '')];
            if (!inv) {
                return menu;
            }
            var merged = Object.assign({}, menu);
            if (inv.stockQuantity != null) {
                merged.stockQuantity = inv.stockQuantity;
            }
            if (inv.initialQuantity != null) {
                merged.initialQuantity = inv.initialQuantity;
            }
            if (typeof inv.soldOut === 'boolean') {
                merged.soldOut = inv.soldOut;
            }
            if (inv.stockStatusLabel) {
                merged.stockStatusLabel = inv.stockStatusLabel;
            }
            return merged;
        });
    }

    /** 管理画面向け: API の soldOut / stockStatusLabel / stockQuantity を優先 */
    function isMenuSoldOut(menu) {
        if (!menu) {
            return true;
        }
        if (menu.soldOut === false) {
            return false;
        }
        if (menu.soldOut === true) {
            return true;
        }
        if (menu.stockStatusLabel === '在庫あり') {
            return false;
        }
        if (menu.stockStatusLabel === '在庫切れ') {
            return true;
        }
        var stock = Number(menu.stockQuantity);
        if (Number.isFinite(stock)) {
            return stock <= 0;
        }
        return false;
    }

    function getOrderWaitMs(order) {
        var orderTime = order && order.orderTime;
        if (!orderTime) {
            return 0;
        }
        var raw = String(orderTime).trim().replace(' ', 'T');
        var hasOffset = /(?:Z|[+\-]\d{2}:\d{2})$/i.test(raw);
        var base = new Date(hasOffset ? raw : raw + 'Z');
        if (Number.isNaN(base.getTime())) {
            return 0;
        }
        return Math.max(0, Date.now() - base.getTime());
    }

    function sortPendingOrders(orders, mode) {
        var list = Array.isArray(orders) ? orders.slice() : [];
        var ascending = mode === PENDING_ORDERS_SORT_WAIT_ASC;
        list.sort(function (a, b) {
            var diff = getOrderWaitMs(a) - getOrderWaitMs(b);
            if (diff !== 0) {
                return ascending ? diff : -diff;
            }
            return (a.orderId || 0) - (b.orderId || 0);
        });
        return list;
    }

    function pendingTableGroupKey(order) {
        if (!order) {
            return 'unknown';
        }
        if (order.sessionId) {
            return 'session:' + String(order.sessionId);
        }
        if (order.tableNumber != null) {
            return 'table:' + String(order.tableNumber);
        }
        return 'order:' + String(order.orderId || '');
    }

    function flattenPendingServeLines(order) {
        if (!order) {
            return [];
        }
        var items = Array.isArray(order.items) ? order.items : [];
        var lines = [];
        items.forEach(function (item, idx) {
            if (!item) {
                return;
            }
            var lineIndex = item.lineIndex != null ? Number(item.lineIndex) : idx;
            var remaining = item.remainingQuantity != null
                ? Number(item.remainingQuantity)
                : Math.max(0, Number(item.quantity || 0)
                    - Number(item.servedQuantity || 0)
                    - Number(item.cancelledQuantity || 0));
            if (!Number.isFinite(remaining) || remaining <= 0) {
                return;
            }
            lines.push({
                orderId: order.orderId,
                sessionId: order.sessionId,
                tableNumber: order.tableNumber,
                orderTime: order.orderTime,
                lineIndex: lineIndex,
                menuName: item.menuName || '不明',
                quantity: Number(item.quantity || 0),
                servedQuantity: Number(item.servedQuantity || 0),
                cancelledQuantity: Number(item.cancelledQuantity || 0),
                remainingQuantity: remaining,
                unitPrice: Number(item.unitPrice || 0),
                toppings: Array.isArray(item.toppings) ? item.toppings : []
            });
        });
        return lines;
    }

    function groupPendingOrdersByTable(orders, mode) {
        var sorted = sortPendingOrders(orders, mode);
        var groups = new Map();
        sorted.forEach(function (order) {
            var key = pendingTableGroupKey(order);
            if (!groups.has(key)) {
                groups.set(key, {
                    key: key,
                    sessionId: order.sessionId || null,
                    tableNumber: order.tableNumber,
                    orders: [],
                    lines: []
                });
            }
            var group = groups.get(key);
            group.orders.push(order);
            group.lines = group.lines.concat(flattenPendingServeLines(order));
        });

        var list = Array.from(groups.values()).filter(function (group) {
            return group.lines.length > 0;
        });

        var ascending = mode === PENDING_ORDERS_SORT_WAIT_ASC;
        list.sort(function (a, b) {
            var aWait = a.lines.reduce(function (max, line) {
                return Math.max(max, getOrderWaitMs({ orderTime: line.orderTime }));
            }, 0);
            var bWait = b.lines.reduce(function (max, line) {
                return Math.max(max, getOrderWaitMs({ orderTime: line.orderTime }));
            }, 0);
            if (aWait !== bWait) {
                return ascending ? aWait - bWait : bWait - aWait;
            }
            var aTable = Number(a.tableNumber || 0);
            var bTable = Number(b.tableNumber || 0);
            return aTable - bTable;
        });

        list.forEach(function (group) {
            group.lines.sort(function (a, b) {
                var diff = getOrderWaitMs({ orderTime: a.orderTime }) - getOrderWaitMs({ orderTime: b.orderTime });
                if (diff !== 0) {
                    return ascending ? diff : -diff;
                }
                return (a.orderId || 0) - (b.orderId || 0) || a.lineIndex - b.lineIndex;
            });
            group.oldestOrderTime = group.lines.reduce(function (oldest, line) {
                if (!oldest) {
                    return line.orderTime;
                }
                if (!line.orderTime) {
                    return oldest;
                }
                return getOrderWaitMs({ orderTime: line.orderTime }) > getOrderWaitMs({ orderTime: oldest })
                    ? line.orderTime
                    : oldest;
            }, null);
            group.pendingCount = group.lines.reduce(function (sum, line) {
                return sum + (line.remainingQuantity || 0);
            }, 0);
        });

        return list;
    }

    function tableSeatsCombinedRenderKey(tables) {
        var kitei = global.MasterOrderStaffKiteiSdk;
        var seatStateKey = kitei && typeof kitei.tableSeatStateKey === 'function'
            ? kitei.tableSeatStateKey
            : function (seat) {
                return [
                    String(seat.tableNo || ''),
                    String(seat.status || '').toUpperCase(),
                    String(seat.currentSessionId || ''),
                    String(seat.activePeoples != null ? seat.activePeoples : ''),
                    String(seat.entryPin ? '1' : '0'),
                    String(seat.joinToken ? '1' : '0')
                ].join('|');
            };
        return tables.slice()
            .sort(function (a, b) {
                return Number(a.tableNo || 0) - Number(b.tableNo || 0);
            })
            .map(seatStateKey)
            .join(';');
    }

    /**
     * @param {{ getSessionList?: function(): Element|null, getElements?: { sessionList?: function(): Element|null }, getStatusRail?: function(): Element|null, onTableSeatSyncHint?: function(boolean) }} options
     */
    function createSessionLoadStatusController(options) {
        options = options || {};
        var getSessionList = options.getSessionList
            || (options.getElements && options.getElements.sessionList)
            || (options.getElements && options.getElements.sessionLoadPanel);
        var getStatusRail = typeof options.getStatusRail === 'function' ? options.getStatusRail : null;
        var onTableSeatSyncHint = typeof options.onTableSeatSyncHint === 'function'
            ? options.onTableSeatSyncHint
            : null;

        var sessionLoadHistory = [];
        var sessionLoadCurrentStep = '';
        var sessionLoadCurrentDetail = '';
        var sessionLoadStepStartedAt = 0;

        function elapsedSec() {
            if (!sessionLoadStepStartedAt) {
                return 0;
            }
            return Math.max(0, Math.floor((Date.now() - sessionLoadStepStartedAt) / 1000));
        }

        function reset() {
            sessionLoadHistory = [];
            sessionLoadCurrentStep = '';
            sessionLoadCurrentDetail = '';
            sessionLoadStepStartedAt = 0;
            renderLiveBar(false);
            if (onTableSeatSyncHint) {
                onTableSeatSyncHint(false);
            }
        }

        function resolveSessionList() {
            return typeof getSessionList === 'function' ? getSessionList() : null;
        }

        function renderLiveBar(forceSyncing) {
            if (!getStatusRail) {
                return false;
            }
            var bar = getStatusRail();
            if (!bar) {
                return false;
            }
            var syncing = forceSyncing === true
                || !!(sessionLoadCurrentStep || sessionLoadCurrentDetail);
            bar.classList.toggle('is-syncing', syncing);
            bar.hidden = false;
            bar.removeAttribute('hidden');
            return true;
        }

        function setStatus(step, detail) {
            if (sessionLoadCurrentStep) {
                var prev = sessionLoadCurrentDetail
                    ? sessionLoadCurrentStep + ' \u2014 ' + sessionLoadCurrentDetail
                    : sessionLoadCurrentStep;
                sessionLoadHistory.push('\u2713 ' + prev);
            }
            sessionLoadCurrentStep = step || '';
            sessionLoadCurrentDetail = detail || '';
            sessionLoadStepStartedAt = Date.now();

            if (renderLiveBar(true)) {
                return;
            }

            var sessionList = resolveSessionList();
            if (sessionList && sessionList.querySelector('.table-seats-wrap')) {
                if (onTableSeatSyncHint) {
                    onTableSeatSyncHint(true);
                }
            }
        }

        function updateDetail(detail) {
            sessionLoadCurrentDetail = detail || '';
            if (renderLiveBar(true)) {
                return;
            }
            var sessionList = resolveSessionList();
            if (!sessionList) {
                return;
            }
            if (sessionList.querySelector('.table-seats-wrap')) {
                if (onTableSeatSyncHint) {
                    onTableSeatSyncHint(true);
                }
            }
        }

        function render() {
            renderLiveBar(true);
        }

        return {
            setStatus: setStatus,
            updateDetail: updateDetail,
            reset: reset,
            render: render,
            elapsedSec: elapsedSec
        };
    }

    global.MasterOrderStaffUiSdk = {
        VERSION: SDK_VERSION,
        FIRESTORE_RATE_LIMIT_MESSAGE: FIRESTORE_RATE_LIMIT_MESSAGE,
        PENDING_ORDERS_SORT_WAIT_DESC: PENDING_ORDERS_SORT_WAIT_DESC,
        PENDING_ORDERS_SORT_WAIT_ASC: PENDING_ORDERS_SORT_WAIT_ASC,
        HTTP_RATE_LIMIT_MESSAGE: HTTP_RATE_LIMIT_MESSAGE,
        createFirestoreBackoff: createFirestoreBackoff,
        createHttpRateLimitBackoff: createHttpRateLimitBackoff,
        formatStaffApiError: formatStaffApiError,
        staffUserVisibleLoadError: staffUserVisibleLoadError,
        UNKNOWN_PROBLEM_MESSAGE: UNKNOWN_PROBLEM_MESSAGE,
        isHttpRateLimited: isHttpRateLimited,
        promiseWithTimeout: promiseWithTimeout,
        createSessionLoadStatusController: createSessionLoadStatusController,
        sortPendingOrders: sortPendingOrders,
        getOrderWaitMs: getOrderWaitMs,
        formatElapsed: formatElapsed,
        formatOrderTime: formatOrderTime,
        yen: yen,
        yenTaxIncluded: yenTaxIncluded,
        mergeMenusWithInventory: mergeMenusWithInventory,
        isMenuSoldOut: isMenuSoldOut,
        groupPendingOrdersByTable: groupPendingOrdersByTable,
        tableSeatsCombinedRenderKey: tableSeatsCombinedRenderKey
    };
})(typeof window !== 'undefined' ? window : globalThis);
