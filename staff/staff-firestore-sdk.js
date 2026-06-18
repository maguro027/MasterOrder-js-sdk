/**
 * MasterOrder Staff Firestore SDK — アクティブセッションのクライアント直読（Phase 2）。
 *
 * 依存: firebase-app-compat.js, firebase-auth-compat.js, firebase-firestore-compat.js
 * グローバル: MasterOrderStaffFirestoreSdk
 *
 * Security Rules + Custom Claims（access / shops / a）がデプロイ済みであること。
 * 書き込みは Server API のみ — 本 SDK は read リスナーのみ提供する。
 */
(function (global) {
    'use strict';

    var SDK_VERSION = '1.3.0';
    var core = global.MasterOrderCoreSdk;
    var db = null;
    var listenersByKey = {};
    var lastSnapshotSigByKey = {};

    function requireFirebase() {
        if (!global.firebase || !global.firebase.firestore) {
            throw new Error('firebase-firestore-compat.js is required before staff-firestore-sdk.js');
        }
    }

    function normalizeSessionStartTime(value) {
        if (core && typeof core.normalizeFirestoreDateTime === 'function') {
            return core.normalizeFirestoreDateTime(value) || null;
        }
        return value || null;
    }

    function mapSessionDocument(doc) {
        if (!doc || !doc.exists) {
            return null;
        }
        var data = doc.data() || {};
        var active = data.isActive;
        if (active === false) {
            return null;
        }
        return {
            sessionId: doc.id || data.id || '',
            shopId: data.shopId != null ? Number(data.shopId) : null,
            tableNumber: data.tableNumber != null ? Number(data.tableNumber) : 0,
            peoples: data.peoples != null ? Number(data.peoples) : 0,
            entryPin: data.entryPin || '',
            active: active !== false,
            startTime: normalizeSessionStartTime(data.startTime),
            endTime: normalizeSessionStartTime(data.endTime),
            totalAmount: data.totalAmount != null ? Number(data.totalAmount) : 0,
            orderCount: data.orderCount != null ? Number(data.orderCount) : 0,
            staffMemo: data.staffMemo || null,
            joinToken: null,
            detailsEnriched: false
        };
    }

    function sortSessions(list) {
        return list.slice().sort(function (a, b) {
            var ta = a.startTime || '';
            var tb = b.startTime || '';
            if (ta === tb) {
                return String(a.sessionId || '').localeCompare(String(b.sessionId || ''));
            }
            return tb.localeCompare(ta);
        });
    }

    function sessionsSignature(sessions) {
        var list = Array.isArray(sessions) ? sessions : [];
        return list.map(function (s) {
            return [
                s.sessionId,
                s.tableNumber,
                s.peoples,
                s.active,
                s.startTime || '',
                s.totalAmount != null ? s.totalAmount : '',
                s.orderCount != null ? s.orderCount : '',
                s.staffMemo || '',
                s.entryPin || ''
            ].join(':');
        }).sort().join('|');
    }

    function init(firebaseApp) {
        requireFirebase();
        if (!firebaseApp) {
            throw new Error('MasterOrderStaffFirestoreSdk.init requires a Firebase app instance');
        }
        db = global.firebase.firestore(firebaseApp);
    }

    function stopListener(key) {
        var existing = listenersByKey[key];
        if (existing) {
            existing();
            delete listenersByKey[key];
        }
        delete lastSnapshotSigByKey[key];
    }

    function stopAll() {
        Object.keys(listenersByKey).forEach(stopListener);
        lastSnapshotSigByKey = {};
    }

    /**
     * {@code shops/{shopId}/active_sessions} の isActive==true を購読。
     * @param {number|string} shopId
     * @param {{ onSessions?: function(Array), onError?: function(Error) }} handlers
     * @returns {function(): void} unsubscribe
     */
    function listenActiveSessions(shopId, handlers) {
        requireFirebase();
        if (!db) {
            throw new Error('MasterOrderStaffFirestoreSdk.init() must be called first');
        }
        var h = handlers || {};
        var key = 'sessions:' + String(shopId);
        stopListener(key);

        var query = db.collection('shops')
            .doc(String(shopId))
            .collection('active_sessions')
            .where('isActive', '==', true);
        var unsubscribe = query.onSnapshot(
            function (snapshot) {
                var sessions = [];
                snapshot.forEach(function (doc) {
                    var mapped = mapSessionDocument(doc);
                    if (mapped) {
                        sessions.push(mapped);
                    }
                });
                var sorted = sortSessions(sessions);
                var sig = sessionsSignature(sorted);
                if (lastSnapshotSigByKey[key] === sig) {
                    return;
                }
                lastSnapshotSigByKey[key] = sig;
                if (typeof h.onSessions === 'function') {
                    h.onSessions(sorted);
                }
            },
            function (err) {
                if (typeof h.onError === 'function') {
                    h.onError(err);
                }
            }
        );
        listenersByKey[key] = unsubscribe;
        return function () {
            stopListener(key);
        };
    }

    /**
     * KITEI_QR: KV 由来の卓メタ（パスフレーズ）と Firestore セッションをマージ。
     * @param {Array} tableSeats includeSessionStatus=false の REST 応答
     * @param {Array} sessions Firestore リスナー由来
     */
    function vacantSeatFields() {
        return {
            status: 'VACANT',
            currentSessionId: null,
            activePeoples: null,
            entryPin: null,
            joinToken: null,
            startTime: null,
            staffMemo: null,
            totalAmount: 0,
            orderCount: 0
        };
    }

    /**
     * Firestore active_sessions を正とし、卓メタに利用状態を上書きする。
     * 終了済みセッションのフィールドは必ず除去する。
     */
    function mergeTableSeatsWithSessions(tableSeats, sessions) {
        var seats = Array.isArray(tableSeats) ? tableSeats : [];
        var list = Array.isArray(sessions) ? sessions : [];
        var activeByTable = {};
        list.forEach(function (session) {
            if (!session || !session.sessionId || session.active === false) {
                return;
            }
            var tableNo = Number(session.tableNumber || 0);
            if (tableNo > 0 && !activeByTable[tableNo]) {
                activeByTable[tableNo] = session;
            }
        });
        return seats.map(function (seat) {
            var tableNo = Number(seat.tableNo || 0);
            var active = activeByTable[tableNo];
            if (!active) {
                return Object.assign({}, seat, vacantSeatFields());
            }
            return Object.assign({}, seat, vacantSeatFields(), {
                status: 'USING',
                currentSessionId: active.sessionId,
                activePeoples: active.peoples,
                entryPin: active.entryPin || null,
                joinToken: active.joinToken || null,
                startTime: active.startTime || null,
                staffMemo: active.staffMemo || null,
                totalAmount: active.totalAmount != null ? active.totalAmount : 0,
                orderCount: active.orderCount != null ? active.orderCount : 0,
                liveDetailsState: active.detailsEnriched === true ? 'ready' : 'loading'
            });
        });
    }

    function invalidateActiveSessionListenerSignature(shopId) {
        var key = 'sessions:' + String(shopId);
        delete lastSnapshotSigByKey[key];
    }

    /**
     * Firestore 直読モード用のアクティブセッションキャッシュ。
     * @param {{ getShopId?: function(): *, onSnapshotSaved?: function(*, Array) }} options
     */
    function createActiveSessionCache(options) {
        var opts = options || {};
        var getShopId = opts.getShopId;
        var onSnapshotSaved = opts.onSnapshotSaved;
        var state = {
            sessions: [],
            signature: null
        };

        function notifySnapshotSaved(sessions) {
            if (typeof onSnapshotSaved !== 'function') {
                return;
            }
            var shopId = typeof getShopId === 'function' ? getShopId() : null;
            if (shopId) {
                onSnapshotSaved(shopId, sessions);
            }
        }

        function getSessions() {
            return state.sessions.slice();
        }

        function getSignature() {
            return state.signature;
        }

        function hasSnapshot() {
            return state.signature !== null;
        }

        function reset() {
            state.sessions = [];
            state.signature = null;
        }

        function invalidateSignature() {
            state.signature = null;
        }

        function setSessions(sessions, setOpts) {
            var so = setOpts || {};
            state.sessions = Array.isArray(sessions) ? sessions.slice() : [];
            if (so.updateSignature === true) {
                state.signature = sessionsSignature(state.sessions);
            } else if (so.invalidateSignature === true) {
                invalidateSignature();
            }
        }

        /**
         * リスナー由来スナップショットを適用。変更なしなら false。
         * 初回（空配列含む）は必ず true。
         */
        function applySessions(sessions) {
            var nextSig = sessionsSignature(sessions);
            if (state.signature !== null && nextSig === state.signature) {
                return false;
            }
            state.signature = nextSig;
            state.sessions = Array.isArray(sessions) ? sessions.slice() : [];
            notifySnapshotSaved(state.sessions);
            return true;
        }

        function normalizeApiSessionRow(item) {
            if (core && typeof core.normalizeActiveSessionListItem === 'function') {
                return core.normalizeActiveSessionListItem(item);
            }
            if (!item || !item.sessionId) {
                return null;
            }
            return Object.assign({}, item, { detailsEnriched: true });
        }

        /** REST active-sessions（includeTotals）でカード表示フィールドをキャッシュへ反映（合計・開始時刻など） */
        function enrichSessionsFromApiList(items) {
            var rows = Array.isArray(items) ? items : [];
            if (!rows.length) {
                return [];
            }
            var list = state.sessions.slice();
            var touched = [];
            var changed = false;
            rows.forEach(function (raw) {
                var item = normalizeApiSessionRow(raw);
                if (!item || !item.sessionId) {
                    return;
                }
                var idx = list.findIndex(function (row) {
                    return row && row.sessionId === item.sessionId;
                });
                var prev = idx >= 0 ? list[idx] : {};
                var next = Object.assign({}, prev, item, {
                    detailsEnriched: true,
                    startTime: item.startTime || prev.startTime || null,
                    totalAmount: item.totalAmount != null ? Number(item.totalAmount) : Number(prev.totalAmount || 0),
                    orderCount: item.orderCount != null
                        ? Number(item.orderCount)
                        : Number(prev.orderCount != null ? prev.orderCount : 0)
                });
                if (idx >= 0) {
                    list[idx] = next;
                } else {
                    list.push(next);
                }
                touched.push(next);
                changed = true;
            });
            if (changed) {
                state.sessions = list;
                invalidateSignature();
            }
            return touched;
        }

        function patchTotalsFromList(items) {
            return enrichSessionsFromApiList(items);
        }

        function patchFromSessionDetail(detail, fallbackShopId) {
            if (!core || typeof core.sessionListItemFromDetail !== 'function') {
                return null;
            }
            var item = core.sessionListItemFromDetail(detail);
            if (!item || !item.sessionId) {
                return null;
            }
            var list = state.sessions.slice();
            var index = list.findIndex(function (row) {
                return row && row.sessionId === item.sessionId;
            });
            var prev = index >= 0 ? list[index] : {};
            var next = Object.assign({}, prev, {
                sessionId: item.sessionId,
                shopId: item.shopId != null ? item.shopId : fallbackShopId,
                tableNumber: item.tableNumber,
                peoples: item.peoples,
                active: item.active !== false,
                startTime: item.startTime || null,
                totalAmount: item.totalAmount != null ? item.totalAmount : 0,
                orderCount: detail && detail.orderHistory
                    ? detail.orderHistory.length
                    : (prev.orderCount != null ? prev.orderCount : 0),
                staffMemo: detail && detail.staffMemo != null
                    ? detail.staffMemo
                    : (prev.staffMemo || null),
                entryPin: item.entryPin || '',
                detailsEnriched: true
            });
            if (index >= 0) {
                list[index] = next;
            } else {
                list.push(next);
            }
            state.sessions = list;
            invalidateSignature();
            return next;
        }

        function refreshSessionFromApi(staffSdk, sessionId, fallbackShopId) {
            if (!staffSdk || !sessionId) {
                return Promise.resolve(null);
            }
            return staffSdk.getSessionDetail(sessionId, { includeOrders: false })
                .then(function (detail) {
                    return patchFromSessionDetail(detail, fallbackShopId);
                });
        }

        return {
            getSessions: getSessions,
            getSignature: getSignature,
            hasSnapshot: hasSnapshot,
            reset: reset,
            invalidateSignature: invalidateSignature,
            setSessions: setSessions,
            applySessions: applySessions,
            patchTotalsFromList: patchTotalsFromList,
            enrichSessionsFromApiList: enrichSessionsFromApiList,
            patchFromSessionDetail: patchFromSessionDetail,
            refreshSessionFromApi: refreshSessionFromApi
        };
    }

    global.MasterOrderStaffFirestoreSdk = {
        version: SDK_VERSION,
        init: init,
        listenActiveSessions: listenActiveSessions,
        mergeTableSeatsWithSessions: mergeTableSeatsWithSessions,
        vacantSeatFields: vacantSeatFields,
        invalidateActiveSessionListenerSignature: invalidateActiveSessionListenerSignature,
        createActiveSessionCache: createActiveSessionCache,
        stopAll: stopAll,
        mapSessionDocument: mapSessionDocument,
        sessionsSignature: sessionsSignature
    };
})(typeof window !== 'undefined' ? window : globalThis);

