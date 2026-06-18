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

    var PENDING_ORDERS_SORT_WAIT_DESC = 'wait-desc';
    var PENDING_ORDERS_SORT_WAIT_ASC = 'wait-asc';

    var FIRESTORE_BACKOFF_MS = 120000;

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

    function formatStaffApiError(err, fallback, backoff) {
        var rateLimitCheck = backoff && typeof backoff.isRateLimitError === 'function'
            ? backoff.isRateLimitError
            : createFirestoreBackoff().isRateLimitError;
        if (rateLimitCheck(err)) {
            return FIRESTORE_RATE_LIMIT_MESSAGE;
        }
        var msg = err && (err.message || err.detail) ? String(err.message || err.detail) : '';
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
                : Math.max(0, Number(item.quantity || 0) - Number(item.servedQuantity || 0));
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
                    String(seat.entryPin || ''),
                    String(seat.joinToken || '')
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
        createFirestoreBackoff: createFirestoreBackoff,
        formatStaffApiError: formatStaffApiError,
        promiseWithTimeout: promiseWithTimeout,
        createSessionLoadStatusController: createSessionLoadStatusController,
        sortPendingOrders: sortPendingOrders,
        getOrderWaitMs: getOrderWaitMs,
        formatElapsed: formatElapsed,
        formatOrderTime: formatOrderTime,
        yen: yen,
        mergeMenusWithInventory: mergeMenusWithInventory,
        isMenuSoldOut: isMenuSoldOut,
        groupPendingOrdersByTable: groupPendingOrdersByTable,
        tableSeatsCombinedRenderKey: tableSeatsCombinedRenderKey
    };
})(typeof window !== 'undefined' ? window : globalThis);
