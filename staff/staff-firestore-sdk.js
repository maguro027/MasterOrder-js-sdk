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

    var SDK_VERSION = '1.3.4';
    var core = global.MasterOrderCoreSdk;
    var db = null;
    var listenersByKey = {};
    var lastSnapshotSigByKey = {};

    function partyFlagsSignatureLocal(flags) {
        if (core && typeof core.partyFlagsSignature === 'function') {
            return core.partyFlagsSignature(flags);
        }
        var pf = flags || {};
        return [
            pf.family ? '1' : '0',
            pf.couple ? '1' : '0',
            pf.companions ? '1' : '0'
        ].join(':');
    }

    function coalescePartyFlags(incoming, prev, confirmed) {
        if (core && typeof core.coalescePartyFlags === 'function') {
            return core.coalescePartyFlags(incoming, prev, { confirmed: confirmed === true });
        }
        if (incoming == null) {
            return prev != null ? prev : null;
        }
        if (confirmed === true) {
            return incoming;
        }
        if (partyFlagsSignatureLocal(incoming) === '0:0:0'
            && partyFlagsSignatureLocal(prev) !== '0:0:0') {
            return prev;
        }
        return incoming;
    }

    function mapSessionPartyFlags(data) {
        if (core && typeof core.normalizePartyFlagsOrNull === 'function') {
            return core.normalizePartyFlagsOrNull(data);
        }
        if (!data || (data.partyFamily == null && data.partyCouple == null && data.partyCompanions == null
            && !(data.partyFlags && typeof data.partyFlags === 'object'))) {
            return null;
        }
        return core && typeof core.normalizePartyFlags === 'function'
            ? core.normalizePartyFlags(data)
            : {
                family: data.partyFamily === true,
                couple: data.partyCouple === true,
                companions: data.partyCompanions === true
            };
    }

    function requireFirebase() {
        if (!global.firebase || !global.firebase.firestore) {
            throw new Error('firebase-firestore-compat.js is required before staff-firestore-sdk.js');
        }
    }

    function ensureFirestoreCompatLoaded() {
        if (global.firebase && typeof global.firebase.firestore === 'function') {
            return Promise.resolve();
        }
        var loader = global.MasterOrderStaffLazyLoader;
        if (loader && typeof loader.ensureFirestoreCompat === 'function') {
            return loader.ensureFirestoreCompat();
        }
        // LazyLoader 未初期化時も gstatic から直接読む（APK / 部分バンドル対策）
        return new Promise(function (resolve, reject) {
            if (typeof document === 'undefined') {
                reject(new Error('firebase-firestore-compat.js is required before staff-firestore-sdk.js'));
                return;
            }
            var src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js';
            var existing = document.querySelector('script[src="' + src + '"]');
            function done() {
                if (global.firebase && typeof global.firebase.firestore === 'function') {
                    resolve();
                    return;
                }
                reject(new Error('firebase-firestore-compat.js failed to register'));
            }
            if (existing) {
                if (global.firebase && typeof global.firebase.firestore === 'function') {
                    resolve();
                    return;
                }
                existing.addEventListener('load', done);
                existing.addEventListener('error', function () {
                    reject(new Error('Failed to load firebase-firestore-compat.js'));
                });
                return;
            }
            var script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.setAttribute('data-cfasync', 'false');
            script.onload = done;
            script.onerror = function () {
                reject(new Error('Failed to load firebase-firestore-compat.js'));
            };
            document.head.appendChild(script);
        });
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
        var peoples = data.peoples != null ? Number(data.peoples) : 0;
        var guestCounts = core && typeof core.normalizeGuestCounts === 'function'
            ? core.normalizeGuestCounts({
                attrMale: data.attrMale,
                attrFemale: data.attrFemale,
                attrOther: data.attrOther,
                attrChildren: data.attrChildren,
                attrBoys: data.attrBoys,
                attrGirls: data.attrGirls
            }, peoples)
            : {
                male: Number(data.attrMale) || 0,
                female: Number(data.attrFemale) || 0,
                unset: data.attrOther != null ? Number(data.attrOther) || 0 : peoples,
                boys: Number(data.attrBoys) || 0,
                girls: Number(data.attrGirls) || 0,
                children: (Number(data.attrBoys) || 0) + (Number(data.attrGirls) || 0)
                    || Number(data.attrChildren) || 0,
                total: peoples
            };
        return {
            sessionId: doc.id || data.id || '',
            shopId: data.shopId != null ? Number(data.shopId) : null,
            tableNumber: data.tableNumber != null ? Number(data.tableNumber) : 0,
            peoples: peoples,
            peoplesConfirmed: data.peoplesConfirmed !== false,
            entryPin: data.entryPin || '',
            active: active !== false,
            startTime: normalizeSessionStartTime(data.startTime),
            endTime: normalizeSessionStartTime(data.endTime),
            // 欠落を 0 に落とさない（未同期を ready/¥0 と誤認しない）
            totalAmount: data.totalAmount != null ? Number(data.totalAmount) : null,
            orderCount: data.orderCount != null ? Number(data.orderCount) : null,
            staffMemo: data.staffMemo || null,
            staffRequestType: data.staffRequestType || null,
            staffRequestAt: data.staffRequestAt || null,
            guestCounts: guestCounts,
            partyFlags: mapSessionPartyFlags(data),
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
            var gc = s.guestCounts || {};
            var pf = s.partyFlags || {};
            return [
                s.sessionId,
                s.tableNumber,
                s.peoples,
                s.active,
                s.startTime || '',
                s.totalAmount != null ? s.totalAmount : '',
                s.orderCount != null ? s.orderCount : '',
                s.staffMemo || '',
                s.staffRequestType || '',
                s.staffRequestAt || '',
                s.entryPin || '',
                gc.male || 0,
                gc.female || 0,
                gc.unset || 0,
                gc.boys || 0,
                gc.girls || 0,
                gc.children || 0,
                pf.family ? '1' : '0',
                pf.couple ? '1' : '0',
                pf.companions ? '1' : '0'
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

    /**
     * Firestore compat を遅延ロードしてから init する。
     * @returns {Promise<void>}
     */
    function initAsync(firebaseApp) {
        return ensureFirestoreCompatLoaded().then(function () {
            init(firebaseApp);
        });
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
     * {@code shops/{shopPublicId}/active_sessions} の isActive==true を購読。
     * @param {string} shopPublicId Firestore パス用 UUID（内部 shops.id ではない）
     * @param {{ onSessions?: function(Array), onError?: function(Error) }} handlers
     * @returns {function(): void} unsubscribe
     */
    function listenActiveSessions(shopPublicId, handlers) {
        requireFirebase();
        if (!db) {
            throw new Error('MasterOrderStaffFirestoreSdk.init() must be called first');
        }
        var docId = String(shopPublicId || '').trim();
        if (!docId) {
            throw new Error('shopPublicId is required for listenActiveSessions');
        }
        var h = handlers || {};
        var key = 'sessions:' + docId;
        stopListener(key);

        var query = db.collection('shops')
            .doc(docId)
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
     * {@code shops/{shopPublicId}/signals/order} を 1 doc 購読（厨房ベル）。
     * 初回スナップショットは無視し、以降の bump のみ onBump。
     * @param {string} shopPublicId
     * @param {{ onBump?: function(Object), onError?: function(Error) }} handlers
     * @returns {function(): void} unsubscribe
     */
    function listenOrderSignal(shopPublicId, handlers) {
        requireFirebase();
        if (!db) {
            throw new Error('MasterOrderStaffFirestoreSdk.init() must be called first');
        }
        var docId = String(shopPublicId || '').trim();
        if (!docId) {
            throw new Error('shopPublicId is required for listenOrderSignal');
        }
        var h = handlers || {};
        var key = 'orderSignal:' + docId;
        stopListener(key);

        var skipInitial = true;
        var ref = db.collection('shops').doc(docId).collection('signals').doc('order');
        var unsubscribe = ref.onSnapshot(
            function (snap) {
                if (skipInitial) {
                    skipInitial = false;
                    return;
                }
                if (typeof h.onBump !== 'function') {
                    return;
                }
                var data = snap && typeof snap.data === 'function' ? (snap.data() || {}) : {};
                h.onBump({
                    exists: !!(snap && snap.exists),
                    eventType: data.eventType || data.type || null,
                    targetSessionId: data.targetSessionId || null,
                    targetOrderId: data.targetOrderId != null ? data.targetOrderId : null,
                    shopPublicId: docId
                });
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
            peoplesConfirmed: true,
            entryPin: null,
            joinToken: null,
            startTime: null,
            staffMemo: null,
            staffRequestType: null,
            staffRequestAt: null,
            totalAmount: null,
            orderCount: null,
            guestCounts: null,
            partyFlags: null,
            detailsEnriched: false,
            stickyReady: false,
            liveDetailsState: null
        };
    }

    /**
     * Firestore active_sessions を正とし、卓メタに利用状態を上書きする。
     * 終了済みセッションのフィールドは必ず除去する。
     * @param {Array} tableSeats
     * @param {Array} sessions
     * @param {Array} [previousDisplay] 直前の表示用マージ結果。卓番号マッピング一時欠落時の Active 維持に使う
     */
    function mergeTableSeatsWithSessions(tableSeats, sessions, previousDisplay) {
        var seats = Array.isArray(tableSeats) ? tableSeats : [];
        var list = Array.isArray(sessions) ? sessions : [];
        var prevList = Array.isArray(previousDisplay) ? previousDisplay : [];
        var activeByTable = {};
        var sessionIds = {};
        list.forEach(function (session) {
            if (!session || !session.sessionId || session.active === false) {
                return;
            }
            sessionIds[String(session.sessionId)] = true;
            var tableNo = Number(session.tableNumber || 0);
            if (tableNo > 0 && !activeByTable[tableNo]) {
                activeByTable[tableNo] = session;
            }
        });
        var prevByTable = {};
        prevList.forEach(function (row) {
            var tn = Number(row && row.tableNo || 0);
            if (tn > 0) {
                prevByTable[tn] = row;
            }
        });
        return seats.map(function (seat) {
            var tableNo = Number(seat.tableNo || 0);
            var active = activeByTable[tableNo];
            if (!active) {
                var prev = prevByTable[tableNo];
                // セッション自体は残っているが tableNumber が一瞬欠落/0 になったときの誤 VACANT を防ぐ
                if (prev && String(prev.status || '').toUpperCase() === 'USING' && prev.currentSessionId
                    && sessionIds[String(prev.currentSessionId)]
                    && prev._forceVacant !== true) {
                    return Object.assign({}, seat, {
                        status: 'USING',
                        currentSessionId: prev.currentSessionId,
                        activePeoples: prev.activePeoples,
                        peoplesConfirmed: prev.peoplesConfirmed !== false,
                        guestCounts: prev.guestCounts || null,
                        partyFlags: prev.partyFlags || null,
                        entryPin: prev.entryPin || null,
                        joinToken: prev.joinToken || null,
                        startTime: prev.startTime || null,
                        staffMemo: prev.staffMemo || null,
                        // 対応完了済みの呼び出しを previousDisplay から復元しない
                        // （active 側に依頼が無い＝クリア済み or 未同期。未同期は次 snap で復帰）
                        staffRequestType: null,
                        staffRequestAt: null,
                        totalAmount: prev.totalAmount,
                        orderCount: prev.orderCount,
                        liveDetailsState: prev.liveDetailsState || resolveLiveDetailsState({
                            detailsEnriched: true,
                            totalAmount: prev.totalAmount,
                            orderCount: prev.orderCount
                        })
                    });
                }
                return Object.assign({}, seat, vacantSeatFields());
            }
            var prevActive = prevByTable[tableNo];
            var sameSession = prevActive
                && String(prevActive.currentSessionId || '') === String(active.sessionId || '');
            var nextTotal = active.totalAmount != null ? Number(active.totalAmount) : null;
            var prevTotal = sameSession && prevActive.totalAmount != null
                ? Number(prevActive.totalAmount)
                : null;
            var nextCount = active.orderCount != null ? Number(active.orderCount) : null;
            var prevCount = sameSession && prevActive.orderCount != null
                ? Number(prevActive.orderCount)
                : null;
            // 未同期の欠落/「注文ありなのに ¥0」だけ保護。キャンセル等の正当な減額は通す。
            var mergedTotal = nextTotal;
            if (prevTotal != null && prevTotal > 0
                && (nextTotal == null
                    || (nextTotal === 0 && nextCount != null && nextCount > 0))) {
                mergedTotal = prevTotal;
            }
            var mergedCount = nextCount != null ? nextCount : prevCount;
            var mergedActive = Object.assign({}, active, {
                totalAmount: mergedTotal,
                orderCount: mergedCount,
                detailsEnriched: active.detailsEnriched === true
                    || (sameSession && prevActive.detailsEnriched === true)
                    || (sameSession && prevActive.liveDetailsState === 'ready'),
                stickyReady: active.stickyReady === true
                    || (sameSession && prevActive.stickyReady === true)
                    || (prevTotal != null && prevTotal > 0)
            });
            return Object.assign({}, seat, vacantSeatFields(), {
                status: 'USING',
                currentSessionId: active.sessionId,
                activePeoples: active.peoples,
                peoplesConfirmed: active.peoplesConfirmed !== false,
                guestCounts: active.guestCounts || (sameSession ? prevActive.guestCounts : null) || null,
                partyFlags: coalescePartyFlags(
                    active.partyFlags,
                    sameSession && prevActive ? prevActive.partyFlags : null
                ),
                entryPin: active.entryPin
                    || (sameSession && prevActive && prevActive.entryPin)
                    || null,
                joinToken: active.joinToken
                    || (sameSession && prevActive && prevActive.joinToken)
                    || null,
                startTime: active.startTime || (sameSession ? prevActive.startTime : null) || null,
                staffMemo: active.staffMemo != null
                    ? active.staffMemo
                    : (sameSession ? prevActive.staffMemo : null),
                // null は対応完了。prev へフォールバックすると ack 後に再表示・再通知する
                staffRequestType: active.staffRequestType || null,
                staffRequestAt: active.staffRequestAt || null,
                totalAmount: mergedTotal,
                orderCount: mergedCount,
                detailsEnriched: mergedActive.detailsEnriched === true,
                stickyReady: mergedActive.stickyReady === true,
                // startTime/peoples/totalAmount>=0 だけでは ready にしない（¥0 誤表示の再発防止）
                liveDetailsState: resolveLiveDetailsState(mergedActive)
            });
        });
    }

    /**
     * Firestore 直読の合計が未同期（注文ありなのに 0）の間は loading を維持する。
     * REST enrich 済み、または合計>0、または注文0件が明示された席のみ ready。
     */
    function resolveLiveDetailsState(active) {
        if (!active) {
            return 'loading';
        }
        var total = active.totalAmount != null ? Number(active.totalAmount) : NaN;
        var orders = active.orderCount != null ? Number(active.orderCount) : NaN;
        if (Number.isFinite(total) && total > 0) {
            return 'ready';
        }
        // 正の合計を一度でも見ている場合は ¥0 未同期を ready 扱いにしない
        if (active.stickyReady === true && !(active.orderCount != null && orders === 0)) {
            return 'loading';
        }
        if (active.detailsEnriched === true) {
            // enrich 済みでも total=0 かつ orderCount 不明は loading（誤 ¥0 防止）
            if (active.orderCount != null && orders === 0) {
                return 'ready';
            }
            if (Number.isFinite(total) && total === 0 && active.orderCount != null && orders === 0) {
                return 'ready';
            }
            if (!Number.isFinite(total) || total === 0) {
                return 'loading';
            }
            return 'ready';
        }
        // 明示的に orderCount===0 のときだけ ¥0 を確定表示（フィールド欠落は loading）
        if (active.orderCount != null && orders === 0) {
            return 'ready';
        }
        return 'loading';
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
            var incoming = Array.isArray(sessions) ? sessions.slice() : [];
            if (so.mergeProtect === true && state.sessions.length) {
                var prevById = {};
                state.sessions.forEach(function (row) {
                    if (row && row.sessionId) {
                        prevById[row.sessionId] = row;
                    }
                });
                incoming = incoming.map(function (session) {
                    if (!session || !session.sessionId) {
                        return session;
                    }
                    var prev = prevById[session.sessionId];
                    if (!prev) {
                        return session;
                    }
                    var next = Object.assign({}, session);
                    var nextTable = next.tableNumber != null ? Number(next.tableNumber) : 0;
                    var prevTable = prev.tableNumber != null ? Number(prev.tableNumber) : 0;
                    if (!(nextTable > 0) && prevTable > 0) {
                        next.tableNumber = prevTable;
                    }
                    if (prev.detailsEnriched === true) {
                        next.detailsEnriched = true;
                    }
                    var prevTotal = prev.totalAmount != null ? Number(prev.totalAmount) : null;
                    var nextTotal = next.totalAmount != null ? Number(next.totalAmount) : null;
                    var prevCount = prev.orderCount != null ? Number(prev.orderCount) : null;
                    var nextCount = next.orderCount != null ? Number(next.orderCount) : null;
                    if (prevTotal != null && prevTotal > 0
                        && (nextTotal == null
                            || (nextTotal === 0 && nextCount != null && nextCount > 0))) {
                        next.totalAmount = prevTotal;
                    }
                    if (nextCount == null && prevCount != null) {
                        next.orderCount = prevCount;
                    }
                    if (!next.entryPin && prev.entryPin) {
                        next.entryPin = prev.entryPin;
                    }
                    if (!next.joinToken && prev.joinToken) {
                        next.joinToken = prev.joinToken;
                    }
                    return next;
                });
            }
            state.sessions = incoming;
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
            var incoming = Array.isArray(sessions) ? sessions.slice() : [];
            var prevById = {};
            state.sessions.forEach(function (row) {
                if (row && row.sessionId) {
                    prevById[row.sessionId] = row;
                }
            });
            incoming = incoming.map(function (session) {
                if (!session || !session.sessionId) {
                    return session;
                }
                var prev = prevById[session.sessionId];
                if (!prev) {
                    return session;
                }
                var nextFlags = coalescePartyFlags(session.partyFlags, prev.partyFlags);
                if (nextFlags !== session.partyFlags) {
                    session = Object.assign({}, session, { partyFlags: nextFlags });
                }
                var nextTable = session.tableNumber != null ? Number(session.tableNumber) : 0;
                var prevTable = prev.tableNumber != null ? Number(prev.tableNumber) : 0;
                // update パッチで tableNumber が一瞬欠けると他卓が VACANT に見えるため維持する
                if (!(nextTable > 0) && prevTable > 0) {
                    session = Object.assign({}, session, { tableNumber: prevTable });
                }
                var nextTotal = session.totalAmount != null ? Number(session.totalAmount) : null;
                var prevTotal = prev.totalAmount != null ? Number(prev.totalAmount) : null;
                var nextCount = session.orderCount != null ? Number(session.orderCount) : null;
                var prevCount = prev.orderCount != null ? Number(prev.orderCount) : null;
                var prevReady = prev.detailsEnriched === true
                    || (prevTotal != null && prevTotal > 0)
                    || (prev.orderCount != null && prevCount === 0);
                // 初回注文で orderCount だけ先に増え total がまだ 0 のとき、ready→loading に落とさない
                var demoteRisk = prevReady
                    && (nextTotal == null || nextTotal === 0)
                    && nextCount != null && nextCount > 0;
                // 欠落・一時的 ¥0（注文あり）のみ保護。キャンセル等の減額・件数減は通す。
                var protectTotals = demoteRisk
                    || (nextTotal == null && prevTotal != null && prevTotal > 0);
                // 作成直後の REST PIN を Firestore 空 entryPin で消さない
                var keepPin = !session.entryPin && prev.entryPin;
                var keepJoin = !session.joinToken && prev.joinToken;
                if (!protectTotals && !keepPin && !keepJoin) {
                    return session;
                }
                return Object.assign({}, session, {
                    totalAmount: (function () {
                        if (demoteRisk && (nextTotal == null || nextTotal === 0)) {
                            return prevTotal != null ? prevTotal : 0;
                        }
                        if (nextTotal == null && prevTotal != null) {
                            return prevTotal;
                        }
                        return nextTotal != null ? nextTotal : (prevTotal != null ? prevTotal : 0);
                    }()),
                    orderCount: nextCount != null ? nextCount : (prevCount != null ? prevCount : 0),
                    detailsEnriched: protectTotals ? prev.detailsEnriched === true : !!prev.detailsEnriched,
                    stickyReady: protectTotals
                        ? (demoteRisk || prev.stickyReady === true)
                        : !!prev.stickyReady,
                    entryPin: session.entryPin || prev.entryPin || '',
                    joinToken: session.joinToken || prev.joinToken || null
                });
            });
            var nextSig = sessionsSignature(incoming);
            if (state.signature !== null && nextSig === state.signature) {
                return false;
            }
            state.signature = nextSig;
            state.sessions = incoming;
            notifySnapshotSaved(state.sessions);
            return true;
        }

        function guestCountsSignature(counts) {
            var gc = counts || {};
            return [gc.male || 0, gc.female || 0, gc.unset || 0, gc.boys || 0, gc.girls || 0,
                gc.children || 0, gc.total || 0].join(':');
        }

        function partyFlagsSignature(flags) {
            if (core && typeof core.partyFlagsSignature === 'function') {
                return core.partyFlagsSignature(flags);
            }
            var pf = flags || {};
            return [
                pf.family ? '1' : '0',
                pf.couple ? '1' : '0',
                pf.companions ? '1' : '0'
            ].join(':');
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
                var hasStaffRequestType = raw && Object.prototype.hasOwnProperty.call(raw, 'staffRequestType');
                var hasStaffRequestAt = raw && Object.prototype.hasOwnProperty.call(raw, 'staffRequestAt');
                var hasTotalAmount = raw && Object.prototype.hasOwnProperty.call(raw, 'totalAmount');
                var hasOrderCount = raw && Object.prototype.hasOwnProperty.call(raw, 'orderCount');
                var item = normalizeApiSessionRow(raw);
                if (!item || !item.sessionId) {
                    return;
                }
                var idx = list.findIndex(function (row) {
                    return row && row.sessionId === item.sessionId;
                });
                var prev = idx >= 0 ? list[idx] : {};
                var prevTable = prev.tableNumber != null ? Number(prev.tableNumber) : 0;
                var itemTable = item.tableNumber != null ? Number(item.tableNumber) : 0;
                var itemTotal = hasTotalAmount && item.totalAmount != null ? Number(item.totalAmount) : null;
                var prevTotal = prev.totalAmount != null ? Number(prev.totalAmount) : null;
                var itemCount = hasOrderCount && item.orderCount != null ? Number(item.orderCount) : null;
                var prevCount = prev.orderCount != null ? Number(prev.orderCount) : null;
                var mergedTotal = itemTotal;
                if (mergedTotal == null) {
                    mergedTotal = prevTotal != null ? prevTotal : 0;
                } else if (prevTotal != null && prevTotal > 0
                    && mergedTotal === 0
                    && !(itemCount === 0)) {
                    // REST が一瞬 ¥0 を返しても直前の正の合計を維持
                    mergedTotal = prevTotal;
                }
                var mergedCount = itemCount;
                if (mergedCount == null) {
                    mergedCount = prevCount != null ? prevCount : 0;
                }
                var flagsConfirmed = raw && raw.partyFlagsConfirmed === true;
                var mergedFlags = coalescePartyFlags(item.partyFlags, prev.partyFlags, flagsConfirmed);
                var next = Object.assign({}, prev, item, {
                    detailsEnriched: true,
                    stickyReady: (prevTotal != null && prevTotal > 0)
                        || (mergedTotal != null && mergedTotal > 0)
                        || prev.stickyReady === true,
                    tableNumber: itemTable > 0 ? itemTable : (prevTable > 0 ? prevTable : 0),
                    startTime: item.startTime || prev.startTime || null,
                    totalAmount: mergedTotal,
                    orderCount: mergedCount,
                    partyFlags: mergedFlags,
                    // 部分 patch（人数更新など）で省略された staffRequest を null 上書きしない
                    staffRequestType: hasStaffRequestType
                        ? (item.staffRequestType || null)
                        : (prev.staffRequestType || null),
                    staffRequestAt: hasStaffRequestAt
                        ? (item.staffRequestAt || null)
                        : (prev.staffRequestAt || null)
                });
                var rowChanged = idx < 0
                    || Number(prev.totalAmount) !== Number(next.totalAmount)
                    || Number(prev.orderCount) !== Number(next.orderCount)
                    || String(prev.startTime || '') !== String(next.startTime || '')
                    || Number(prev.tableNumber || 0) !== Number(next.tableNumber || 0)
                    || Number(prev.peoples || 0) !== Number(next.peoples || 0)
                    || String(prev.staffMemo || '') !== String(next.staffMemo || '')
                    || String(prev.staffRequestType || '') !== String(next.staffRequestType || '')
                    || String(prev.staffRequestAt || '') !== String(next.staffRequestAt || '')
                    || guestCountsSignature(prev.guestCounts) !== guestCountsSignature(next.guestCounts)
                    || partyFlagsSignature(prev.partyFlags) !== partyFlagsSignature(next.partyFlags)
                    || prev.detailsEnriched !== true;
                if (idx >= 0) {
                    list[idx] = next;
                } else {
                    list.push(next);
                }
                if (rowChanged) {
                    touched.push(next);
                    changed = true;
                }
            });
            if (changed) {
                state.sessions = list;
                // invalidate せず再計算 → 直後の同一 Firestore snap を短絡できる
                state.signature = sessionsSignature(state.sessions);
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
            var prevTable = prev.tableNumber != null ? Number(prev.tableNumber) : 0;
            var itemTable = item.tableNumber != null ? Number(item.tableNumber) : 0;
            var next = Object.assign({}, prev, {
                sessionId: item.sessionId,
                shopId: item.shopId != null ? item.shopId : fallbackShopId,
                tableNumber: itemTable > 0 ? itemTable : (prevTable > 0 ? prevTable : 0),
                peoples: item.peoples != null ? item.peoples : prev.peoples,
                active: item.active !== false,
                startTime: item.startTime || prev.startTime || null,
                totalAmount: item.totalAmount != null
                    ? Number(item.totalAmount)
                    : Number(prev.totalAmount != null ? prev.totalAmount : 0),
                orderCount: detail && Array.isArray(detail.orderHistory)
                    ? detail.orderHistory.filter(function (order) {
                        return order && order.status !== 'CANCELLED';
                    }).length
                    : (prev.orderCount != null ? prev.orderCount : 0),
                staffMemo: detail && detail.staffMemo != null
                    ? detail.staffMemo
                    : (prev.staffMemo || null),
                // detail/item の null はクリア済み。prev 維持だと対応完了が戻る
                staffRequestType: item.staffRequestType || null,
                staffRequestAt: item.staffRequestAt || null,
                entryPin: item.entryPin || prev.entryPin || '',
                guestCounts: item.guestCounts || prev.guestCounts || null,
                partyFlags: coalescePartyFlags(item.partyFlags, prev.partyFlags),
                detailsEnriched: true
            });
            if (index >= 0) {
                list[index] = next;
            } else {
                list.push(next);
            }
            state.sessions = list;
            state.signature = sessionsSignature(state.sessions);
            return next;
        }

        function refreshSessionFromApi(staffSdk, sessionId, fallbackShopId) {
            if (!staffSdk || !sessionId) {
                return Promise.resolve(null);
            }
            return staffSdk.getSessionDetail(sessionId, {
                includeOrders: false,
                shopId: fallbackShopId
            })
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
        initAsync: initAsync,
        listenActiveSessions: listenActiveSessions,
        listenOrderSignal: listenOrderSignal,
        mergeTableSeatsWithSessions: mergeTableSeatsWithSessions,
        vacantSeatFields: vacantSeatFields,
        invalidateActiveSessionListenerSignature: invalidateActiveSessionListenerSignature,
        createActiveSessionCache: createActiveSessionCache,
        stopAll: stopAll,
        mapSessionDocument: mapSessionDocument,
        sessionsSignature: sessionsSignature,
        ensureFirestoreCompatLoaded: ensureFirestoreCompatLoaded
    };
})(typeof window !== 'undefined' ? window : globalThis);

