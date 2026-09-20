/**
 * MasterOrder Staff Firestore Runtime SDK — セッション Firestore リスナー生命周期。
 *
 * 依存: staff-firestore-sdk.js（MasterOrderStaffFirestoreSdk）
 * グローバル: MasterOrderStaffFirestoreRuntimeSdk
 *
 * DOM 描画は index.html 側のコールバックに委譲する。
 */
(function (global) {
    'use strict';

    var SDK_VERSION = '1.0.5';

    function noop() {}

    function callOpt(fn) {
        if (typeof fn !== 'function') {
            return undefined;
        }
        var args = Array.prototype.slice.call(arguments, 1);
        return fn.apply(null, args);
    }

    function defaultFormatClaimsError(syncResult, shopId) {
        var origin = (global.location && global.location.origin) ? global.location.origin : '';
        if (origin.indexOf('staff.mcservers-wp.com') >= 0 && origin.indexOf('masterorder-staff') < 0) {
            return '旧 URL (staff.mcservers-wp.com) では API / Firestore 権限が同期できません。'
                + ' https://masterorder-staff.mcservers-wp.com/ を開いてください。';
        }
        if (syncResult && syncResult.reason === 'api_error') {
            return 'Firebase 権限の同期 API に失敗しました。再ログインするか、ネットワークを確認してください。';
        }
        if (syncResult && syncResult.reason === 'disabled') {
            return 'Firestore 直読が無効です。管理者に連絡してください。';
        }
        if (syncResult && syncResult.reason === 'not_staff') {
            return 'この Google アカウントには店舗スタッフ権限がありません。管理者にメンバー招待を依頼してください。';
        }
        if (syncResult && syncResult.reason === 'server_denied') {
            var deniedIds = syncResult.body && Array.isArray(syncResult.body.shopIds)
                ? syncResult.body.shopIds.join(', ')
                : '(なし)';
            return '選択中の店舗 (ID ' + shopId + ') は Custom Claims 対象外です（許可 shopIds: ' + deniedIds + '）。'
                + ' 店舗を切り替えるか、管理者に権限付与を依頼してください。';
        }
        if (syncResult && syncResult.body) {
            var pendingIds = Array.isArray(syncResult.body.shopIds)
                ? syncResult.body.shopIds.join(', ')
                : '(なし)';
            return 'Firebase 権限 (Custom Claims) の ID トークン反映待ちです（server shopIds: ' + pendingIds + '）。'
                + ' 10 秒待ってから再読み込みするか、ログアウト→再ログインしてください。';
        }
        return 'Firebase 権限 (Custom Claims) が未同期です。一度ログアウトして再ログインしてください。';
    }

    /**
     * Firestore セッションリスナー runtime（KITEI_QR 固定QR 直読）。
     * @param {{
     *   getShopId: function(): *,
     *   getShopPublicId?: function(): string|null,
     *   sessionCache: object,
     *   firestoreSdk?: object,
     *   staffSdk?: object,
     *   isDirectReadEnabled?: boolean|function(): boolean,
     *   isDirectReadActive?: function(): boolean,
     *   resolvedSessionMode?: function(): string,
     *   effectiveSessionListMode?: function(): string,
     *   usesTableSeatGrid?: function(): boolean,
     *   isTablesFetchInFlight?: function(): boolean,
     *   getTablesApiTimeoutMs?: function(): number,
     *   getApiBase?: function(): string,
     *   syncClaims?: function(object): Promise,
     *   postClaimsSync?: function(): Promise,
     *   refreshAuthToken?: function(): Promise,
     *   formatClaimsError?: function(object, *): string,
     *   markFirestoreBackoff?: function(*),
     *   formatStaffApiError?: function(*, string): string,
     *   staffUserVisibleLoadError?: function(*, string): string,
     *   setSessionLoadStatus?: function(string, string),
     *   updateSessionLoadDetail?: function(string),
     *   resetSessionLoadStatus?: function(),
     *   setTableSeatSyncHint?: function(boolean, string),
     *   finishRender?: function(),
     *   getSessionListEl?: function(): Element,
     *   renderEmpty?: function(Element, string, boolean),
     *   renderKiteiQr?: function(Array, object): boolean,
     *   renderViewsNow?: function(),
     *   applySessionTabLayout?: function(),
     *   refreshMyShops?: function(): Promise,
     *   fetchTableSeatsMetadata?: function(object): Promise,
     *   setTableSeatsCache?: function(Array): void,
     *   applySessionCache?: function(Array, *): boolean,
     *   sessionsList?: function(): Array,
     *   onRestRenderSessions?: function(Array),
     *   onRestUpdateModeGuard?: function(number),
     *   onRestOfflineBanner?: function(boolean, string),
     *   onRestSaveOfflineSnapshot?: function(*, Array): Promise
     *   onReconcileTableSeats?: function(Array): void
     *   onSessionsChangedForOrders?: function(Array, { firstSnapshot: boolean, applied: boolean }): void
     * }} options
     */
    function createFirestoreSessionsRuntime(options) {
        var opts = options || {};
        var getShopId = opts.getShopId || function () { return null; };
        var sessionCache = opts.sessionCache;
        var firestoreSdk = opts.firestoreSdk || global.MasterOrderStaffFirestoreSdk;
        var staffSdk = opts.staffSdk;

        var tableSeatsCache = [];
        var unsubscribe = null;
        var orderSignalUnsub = null;
        var orderSignalHealthy = false;
        var orderSignalDebounceTimer = null;
        var ready = false;
        /** Firestore 直読失敗後に REST 一覧へ退避中。この間は SSE でセッション全同期する。 */
        var restFallbackActive = false;
        var claimsRetryShopId = null;
        var listenerShopId = null;
        var listenerStarting = false;
        var renderDebounceTimer = null;
        var ordersDebounceTimer = null;
        var snapshotWaitTimer = null;
        var listenerStartPromise = null;
        var lastTableSeatsRenderKey = '';

        var ORDERS_NOTIFY_DEBOUNCE_MS = 400;
        var ORDER_SIGNAL_DEBOUNCE_MS = 300;

        function setRestFallbackActive(active) {
            restFallbackActive = !!active;
        }

        /** Firestore path key: shops/{publicId}/... — never internal int id. */
        function resolveFirestoreShopDocId(activeShopId) {
            if (typeof opts.getShopPublicId === 'function') {
                var fromOpt = opts.getShopPublicId();
                if (fromOpt != null && String(fromOpt).trim()) {
                    return String(fromOpt).trim().toLowerCase();
                }
            }
            var raw = activeShopId != null ? String(activeShopId).trim() : '';
            if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
                return raw.toLowerCase();
            }
            return null;
        }

        function assignTableSeatsCache(list) {
            tableSeatsCache = Array.isArray(list) ? list.slice() : [];
            if (typeof opts.setTableSeatsCache === 'function') {
                opts.setTableSeatsCache(tableSeatsCache);
            }
        }

        function isDirectReadEnabled() {
            if (typeof opts.isDirectReadEnabled === 'function') {
                return !!opts.isDirectReadEnabled();
            }
            return opts.isDirectReadEnabled === true;
        }

        function isDirectReadActive() {
            if (typeof opts.isDirectReadActive === 'function') {
                return !!opts.isDirectReadActive();
            }
            return isDirectReadEnabled()
                && callOpt(opts.resolvedSessionMode) === 'KITEI_QR';
        }

        function resolvedSessionMode() {
            var mode = callOpt(opts.resolvedSessionMode);
            return mode === 'KITEI_QR' ? 'KITEI_QR' : 'TSUDO_HAKKO';
        }

        function effectiveSessionListMode() {
            var mode = callOpt(opts.effectiveSessionListMode);
            return mode === 'KITEI_QR' ? 'KITEI_QR' : 'TSUDO_HAKKO';
        }

        function usesTableSeatGrid() {
            return !!callOpt(opts.usesTableSeatGrid);
        }

        function sessionsList() {
            if (typeof opts.sessionsList === 'function') {
                return opts.sessionsList();
            }
            if (sessionCache && typeof sessionCache.getSessions === 'function') {
                return sessionCache.getSessions();
            }
            return [];
        }

        function applySessionCache(sessions, activeShopId) {
            if (typeof opts.applySessionCache === 'function') {
                return !!opts.applySessionCache(sessions, activeShopId);
            }
            if (!sessionCache || typeof sessionCache.applySessions !== 'function') {
                return false;
            }
            return sessionCache.applySessions(sessions);
        }

        function notifyTableSeatsReconciled(sessions) {
            lastTableSeatsRenderKey = '';
            callOpt(opts.onReconcileTableSeats, sessions);
        }

        function notifyOrdersFromSessions(sessions, meta) {
            if (typeof opts.onSessionsChangedForOrders !== 'function') {
                return;
            }
            if (ordersDebounceTimer) {
                clearTimeout(ordersDebounceTimer);
                ordersDebounceTimer = null;
            }
            var payload = {
                firstSnapshot: !!(meta && meta.firstSnapshot),
                applied: !!(meta && meta.applied)
            };
            var delayMs = payload.firstSnapshot ? 0 : ORDERS_NOTIFY_DEBOUNCE_MS;
            var run = function () {
                ordersDebounceTimer = null;
                callOpt(opts.onSessionsChangedForOrders, sessions, payload);
            };
            if (delayMs <= 0) {
                run();
                return;
            }
            ordersDebounceTimer = setTimeout(run, delayMs);
        }

        function handleFirestoreSessionsSnapshot(sessions, activeShopId, kiteiQrMode) {
            clearSnapshotWaitTimer();
            var firstSnapshot = !ready;
            ready = true;
            if (restFallbackActive) {
                setRestFallbackActive(false);
                callOpt(opts.onRestOfflineBanner, false, '');
            }
            callOpt(opts.setTableSeatSyncHint, false);
            var applied = applySessionCache(sessions, activeShopId);
            var bootstrap = typeof opts.bootstrapSessionTotals === 'function'
                ? Promise.resolve(opts.bootstrapSessionTotals())
                : Promise.resolve();
            // キッチン pending: 初回席スナップショットのみ。totals/接続更新のたびに
            // Gate 全件 pending スキャンを起こさない（SSE order + 定期 poll が本線）。
            if (firstSnapshot) {
                notifyOrdersFromSessions(sessions, { firstSnapshot: true, applied: applied });
            }
            if (kiteiQrMode) {
                // apply + reconcile + renderViewsNow + bootstrap render の四重描画をやめる
                if (applied || firstSnapshot) {
                    callOpt(opts.renderViewsNow);
                }
                bootstrap.finally(function () {
                    callOpt(opts.setTableSeatSyncHint, false);
                    // enrich の onSessionsChanged が必要席を描画済み。全席再描画はしない。
                    callOpt(opts.finishRender);
                    callOpt(opts.resetSessionLoadStatus);
                });
                return;
            }
            if (firstSnapshot) {
                callOpt(opts.renderViewsNow);
            }
            bootstrap.finally(function () {
                if (firstSnapshot || applied) {
                    renderViewsDebounced(firstSnapshot);
                }
                callOpt(opts.resetSessionLoadStatus);
            });
        }

        function formatClaimsError(syncResult) {
            var shopId = getShopId();
            if (typeof opts.formatClaimsError === 'function') {
                return opts.formatClaimsError(syncResult, shopId);
            }
            return defaultFormatClaimsError(syncResult, shopId);
        }

        function renderViewsDebounced(immediate) {
            if (!isDirectReadActive() || !getShopId()) {
                return;
            }
            if (renderDebounceTimer) {
                clearTimeout(renderDebounceTimer);
                renderDebounceTimer = null;
            }
            if (immediate === true) {
                callOpt(opts.renderViewsNow);
                return;
            }
            var delayMs = resolvedSessionMode() === 'KITEI_QR' ? 120 : 80;
            renderDebounceTimer = setTimeout(function () {
                renderDebounceTimer = null;
                callOpt(opts.renderViewsNow);
            }, delayMs);
        }

        function showSessionsLoading(message) {
            var listEl = callOpt(opts.getSessionListEl);
            if (listEl && typeof opts.renderEmpty === 'function') {
                opts.renderEmpty(listEl, message || 'セッションを読み込み中...', false, true);
            }
            callOpt(opts.setSessionLoadStatus, message || 'セッションを読み込み中...', 'Firestore 同期待ち');
        }

        function clearSnapshotWaitTimer() {
            if (snapshotWaitTimer) {
                clearTimeout(snapshotWaitTimer);
                snapshotWaitTimer = null;
            }
        }

        function isListenerActiveForShop(activeShopId) {
            return !!unsubscribe && listenerShopId === activeShopId;
        }

        function isOrderSignalHealthy() {
            return orderSignalHealthy && !!orderSignalUnsub && listenerShopId != null;
        }

        function stopOrderSignal() {
            if (orderSignalUnsub) {
                try {
                    orderSignalUnsub();
                } catch (e) { /* ignore */ }
                orderSignalUnsub = null;
            }
            orderSignalHealthy = false;
            if (orderSignalDebounceTimer) {
                clearTimeout(orderSignalDebounceTimer);
                orderSignalDebounceTimer = null;
            }
            callOpt(opts.onOrderSignalHealth, false);
        }

        function notifyOrderSignalBump(payload) {
            if (orderSignalDebounceTimer) {
                clearTimeout(orderSignalDebounceTimer);
                orderSignalDebounceTimer = null;
            }
            orderSignalDebounceTimer = setTimeout(function () {
                orderSignalDebounceTimer = null;
                callOpt(opts.onOrderSignalBump, payload || {});
            }, ORDER_SIGNAL_DEBOUNCE_MS);
        }

        /**
         * 厨房ベル: signals/order 1 doc。初回は SDK 側で skip。店舗切替で必ず止める。
         */
        function attachOrderSignal(firestoreShopDocId, activeShopId) {
            stopOrderSignal();
            if (!firestoreSdk || typeof firestoreSdk.listenOrderSignal !== 'function') {
                callOpt(opts.onOrderSignalHealth, false);
                return;
            }
            if (!firestoreShopDocId || !activeShopId) {
                return;
            }
            orderSignalUnsub = firestoreSdk.listenOrderSignal(firestoreShopDocId, {
                onBump: function (payload) {
                    if (listenerShopId !== activeShopId) {
                        return;
                    }
                    notifyOrderSignalBump(payload);
                },
                onError: function (err) {
                    orderSignalHealthy = false;
                    callOpt(opts.onOrderSignalHealth, false);
                    callOpt(opts.onOrderSignalError, err);
                }
            });
            orderSignalHealthy = true;
            callOpt(opts.onOrderSignalHealth, true);
        }

        function stopListener(stopOpts) {
            var so = stopOpts || {};
            var keepTableCache = so.keepTableCache === true;
            stopOrderSignal();
            if (unsubscribe) {
                unsubscribe();
                unsubscribe = null;
            }
            if (firestoreSdk && typeof firestoreSdk.stopAll === 'function') {
                firestoreSdk.stopAll();
            }
            if (sessionCache && typeof sessionCache.reset === 'function') {
                sessionCache.reset();
            }
            if (!keepTableCache) {
                assignTableSeatsCache([]);
            }
            ready = false;
            setRestFallbackActive(false);
            listenerShopId = null;
            listenerStarting = false;
            listenerStartPromise = null;
            lastTableSeatsRenderKey = '';
            clearSnapshotWaitTimer();
            if (renderDebounceTimer) {
                clearTimeout(renderDebounceTimer);
                renderDebounceTimer = null;
            }
            if (ordersDebounceTimer) {
                clearTimeout(ordersDebounceTimer);
                ordersDebounceTimer = null;
            }
        }

        function scheduleSnapshotFallback(activeShopId, kiteiQrMode) {
            clearSnapshotWaitTimer();
            var timeoutMs = kiteiQrMode === true ? 4000 : 8000;
            snapshotWaitTimer = setTimeout(function () {
                snapshotWaitTimer = null;
                if (!isDirectReadEnabled() || activeShopId !== getShopId()) {
                    return;
                }
                if (sessionCache && typeof sessionCache.hasSnapshot === 'function' && sessionCache.hasSnapshot()) {
                    return;
                }
                if (callOpt(opts.isTablesFetchInFlight)) {
                    scheduleSnapshotFallback(activeShopId, kiteiQrMode);
                    return;
                }
                callOpt(opts.setSessionLoadStatus, 'Firestore 応答タイムアウト — REST に切替', '待機 ' + (timeoutMs / 1000) + ' 秒');
                callOpt(opts.setTableSeatSyncHint, false);
                loadActiveSessionsViaRest({ silent: true, reason: 'firestore_timeout' });
            }, timeoutMs);
        }

        function refreshTableSeatsMetadata(refreshOpts) {
            var ro = refreshOpts || {};
            var shopId = getShopId();
            if (!shopId) {
                return Promise.resolve();
            }
            var timeoutMs = callOpt(opts.getTablesApiTimeoutMs);
            if (!timeoutMs || timeoutMs <= 0) {
                timeoutMs = 15000;
            }
            if (ro.silent !== true) {
                var apiBase = callOpt(opts.getApiBase) || '';
                var path = '/shops/' + encodeURIComponent(shopId) + '/tables?includeSessionStatus=false';
                callOpt(opts.setSessionLoadStatus,
                    'テーブル一覧を API から取得中',
                    apiBase + path + ' — 最大 ' + (timeoutMs / 1000) + ' 秒');
            }
            if (typeof opts.fetchTableSeatsMetadata === 'function') {
                return opts.fetchTableSeatsMetadata({ includeSessionStatus: false })
                    .then(function (list) {
                        assignTableSeatsCache(list);
                    });
            }
            return Promise.resolve();
        }

        function loadActiveSessionsViaRest(restOpts) {
            var ro = restOpts || {};
            var shopId = getShopId();
            if (!shopId) {
                return Promise.resolve();
            }
            clearSnapshotWaitTimer();
            var reasonLabel = ro.reason === 'firestore_timeout'
                ? 'Firestore タイムアウト後'
                : (ro.reason === 'firestore_error' ? 'Firestore エラー後' : 'REST 直接');
            if (ro.reason === 'firestore_timeout' || ro.reason === 'firestore_error') {
                setRestFallbackActive(true);
            }
            callOpt(opts.setSessionLoadStatus,
                'REST API でセッション一覧を取得中',
                reasonLabel + ' — GET /active-sessions');

            if (!staffSdk || typeof staffSdk.getActiveSessions !== 'function') {
                return Promise.resolve();
            }

            return staffSdk.getActiveSessions(shopId, {
                includeTotals: usesTableSeatGrid() || ro.includeTotals === true
            }).then(function (sessions) {
                var list = Array.isArray(sessions) ? sessions : [];
                if (sessionCache && typeof sessionCache.setSessions === 'function') {
                    sessionCache.setSessions(list, { updateSignature: true });
                }
                ready = true;
                callOpt(opts.setSessionLoadStatus, '取得したセッションを画面に反映中', list.length + ' 件');
                if (usesTableSeatGrid()) {
                    var fetchMeta = typeof opts.fetchTableSeatsMetadata === 'function'
                        ? opts.fetchTableSeatsMetadata({ includeSessionStatus: true })
                        : Promise.resolve(tableSeatsCache);
                    return fetchMeta.then(function (metaList) {
                        if (Array.isArray(metaList)) {
                            assignTableSeatsCache(metaList);
                        }
                        callOpt(opts.renderViewsNow);
                    }).catch(function (tableErr) {
                        if (!tableSeatsCache.length) {
                            throw tableErr;
                        }
                        callOpt(opts.renderViewsNow);
                    }).then(function () {
                        if (usesTableSeatGrid() && typeof opts.bootstrapSessionTotals === 'function') {
                            return opts.bootstrapSessionTotals();
                        }
                    }).then(function () {
                        callOpt(opts.resetSessionLoadStatus);
                        if (typeof opts.onRestSaveOfflineSnapshot === 'function') {
                            return opts.onRestSaveOfflineSnapshot(shopId, list).then(function () {
                                callOpt(opts.onRestOfflineBanner,
                                    ro.reason === 'firestore_timeout' || ro.reason === 'firestore_error',
                                    ro.reason === 'firestore_timeout'
                                        ? '⚠️ Firestore 接続が遅いため REST でセッション一覧を表示しています。'
                                        : '⚠️ Firestore 読取不可のため REST でセッション一覧を表示しています。');
                            });
                        }
                        callOpt(opts.onRestOfflineBanner,
                            ro.reason === 'firestore_timeout' || ro.reason === 'firestore_error',
                            ro.reason === 'firestore_timeout'
                                ? '⚠️ Firestore 接続が遅いため REST でセッション一覧を表示しています。'
                                : '⚠️ Firestore 読取不可のため REST でセッション一覧を表示しています。');
                    });
                }
                callOpt(opts.onRestRenderSessions, list);
                callOpt(opts.onRestUpdateModeGuard, list.length);
                callOpt(opts.resetSessionLoadStatus);
                if (typeof opts.onRestSaveOfflineSnapshot === 'function') {
                    return opts.onRestSaveOfflineSnapshot(shopId, list).then(function () {
                        callOpt(opts.onRestOfflineBanner,
                            ro.reason === 'firestore_timeout' || ro.reason === 'firestore_error',
                            ro.reason === 'firestore_timeout'
                                ? '⚠️ Firestore 接続が遅いため REST でセッション一覧を表示しています。'
                                : '⚠️ Firestore 読取不可のため REST でセッション一覧を表示しています。');
                    });
                }
                callOpt(opts.onRestOfflineBanner,
                    ro.reason === 'firestore_timeout' || ro.reason === 'firestore_error',
                    ro.reason === 'firestore_timeout'
                        ? '⚠️ Firestore 接続が遅いため REST でセッション一覧を表示しています。'
                        : '⚠️ Firestore 読取不可のため REST でセッション一覧を表示しています。');
            }).catch(function (e) {
                callOpt(opts.markFirestoreBackoff, e);
                var sessionListEl = callOpt(opts.getSessionListEl);
                var message = typeof opts.staffUserVisibleLoadError === 'function'
                    ? opts.staffUserVisibleLoadError(e, '未知の問題が発生しました')
                    : (typeof opts.formatStaffApiError === 'function'
                        ? opts.formatStaffApiError(e, 'セッション一覧の取得に失敗しました')
                        : '未知の問題が発生しました');
                if (sessionListEl && typeof opts.renderEmpty === 'function') {
                    opts.renderEmpty(sessionListEl, message, true);
                }
            });
        }

        function attachListener(activeShopId, attachOpts) {
            var ao = attachOpts || {};
            if (!isDirectReadActive() || !firestoreSdk || !activeShopId) {
                return;
            }
            var firestoreShopDocId = resolveFirestoreShopDocId(activeShopId);
            if (!firestoreShopDocId) {
                callOpt(opts.setSessionLoadStatus,
                    '店舗 publicId 未取得 — REST に切替',
                    'my-shop 応答に publicId がありません');
                loadActiveSessionsViaRest({ silent: true, reason: 'firestore_error' });
                return;
            }
            if (unsubscribe) {
                unsubscribe();
                unsubscribe = null;
            }
            if (ao.silent !== true) {
                callOpt(opts.setSessionLoadStatus, 'Firestore リスナーを再接続中', 'Claims 再同期後');
            }
            unsubscribe = firestoreSdk.listenActiveSessions(firestoreShopDocId, {
                onSessions: function (sessions) {
                    if (ao.silent !== true) {
                        callOpt(opts.setSessionLoadStatus,
                            'Firestore スナップショット受信（再接続）',
                            (sessions ? sessions.length : 0) + ' 件');
                    }
                    handleFirestoreSessionsSnapshot(
                        sessions,
                        activeShopId,
                        resolvedSessionMode() === 'KITEI_QR');
                },
                onError: function (err) {
                    callOpt(opts.markFirestoreBackoff, err);
                    callOpt(opts.setTableSeatSyncHint, false);
                    var errMsg = (err && err.message) ? err.message : String(err);
                    callOpt(opts.setSessionLoadStatus, 'Firestore 再接続エラー — REST に切替', errMsg);
                    if (ready && sessionsList().length) {
                        renderViewsDebounced();
                        return;
                    }
                    clearSnapshotWaitTimer();
                    loadActiveSessionsViaRest({ silent: true, reason: 'firestore_error' });
                }
            });
            attachOrderSignal(firestoreShopDocId, activeShopId);
            scheduleSnapshotFallback(activeShopId, resolvedSessionMode() === 'KITEI_QR');
        }

        function startListener(activeShopId) {
            if (!isDirectReadActive() || !firestoreSdk || !activeShopId) {
                if (isListenerActiveForShop(activeShopId)) {
                    stopListener();
                }
                return Promise.resolve();
            }
            if (listenerStartPromise && listenerShopId === activeShopId) {
                callOpt(opts.updateSessionLoadDetail, '既存の Firestore 接続処理を待機中');
                return listenerStartPromise;
            }
            if (isListenerActiveForShop(activeShopId)) {
                callOpt(opts.updateSessionLoadDetail, 'Firestore リスナー接続済み — 再初期化をスキップ');
                return Promise.resolve();
            }

            listenerStarting = true;
            listenerShopId = activeShopId;
            listenerStartPromise = new Promise(function (resolve) {
                var kiteiQrMode = resolvedSessionMode() === 'KITEI_QR';
                var run = function () {
                    if (listenerShopId !== null && listenerShopId !== activeShopId) {
                        stopListener();
                    }
                    listenerShopId = activeShopId;
                    claimsRetryShopId = null;
                    kiteiQrMode = resolvedSessionMode() === 'KITEI_QR';

                    var attachFirestoreListener = function () {
                        kiteiQrMode = effectiveSessionListMode() === 'KITEI_QR';
                        var firestoreShopDocId = resolveFirestoreShopDocId(activeShopId);
                        if (!firestoreShopDocId) {
                            callOpt(opts.setSessionLoadStatus,
                                '店舗 publicId 未取得 — REST に切替',
                                'my-shop 応答に publicId がありません');
                            loadActiveSessionsViaRest({ silent: true, reason: 'firestore_error' });
                            return;
                        }
                        scheduleSnapshotFallback(activeShopId, kiteiQrMode);
                        unsubscribe = firestoreSdk.listenActiveSessions(firestoreShopDocId, {
                            onSessions: function (sessions) {
                                callOpt(opts.setTableSeatSyncHint, false);
                                handleFirestoreSessionsSnapshot(
                                    sessions,
                                    activeShopId,
                                    effectiveSessionListMode() === 'KITEI_QR');
                            },
                            onError: function (err) {
                                callOpt(opts.markFirestoreBackoff, err);
                                var msg = (err && err.message) ? err.message : String(err || 'Firestore error');
                                var permissionDenied = /permission|insufficient/i.test(msg);
                                if (permissionDenied && claimsRetryShopId !== activeShopId) {
                                    claimsRetryShopId = activeShopId;
                                    callOpt(opts.setSessionLoadStatus, 'Firestore 権限エラー — Claims を再同期', msg);
                                    var retryChain = Promise.resolve();
                                    if (typeof opts.refreshAuthToken === 'function') {
                                        retryChain = opts.refreshAuthToken();
                                    }
                                    retryChain.then(function () {
                                        if (typeof opts.postClaimsSync === 'function') {
                                            return opts.postClaimsSync();
                                        }
                                    }).then(function () {
                                        attachListener(activeShopId);
                                    }).catch(function () {
                                        clearSnapshotWaitTimer();
                                        loadActiveSessionsViaRest({ silent: true, reason: 'firestore_error' });
                                    });
                                    return;
                                }
                                if (ready && sessionsList().length) {
                                    renderViewsDebounced();
                                    return;
                                }
                                clearSnapshotWaitTimer();
                                callOpt(opts.setTableSeatSyncHint, false);
                                callOpt(opts.setSessionLoadStatus, 'Firestore エラー — REST に切替', msg);
                                loadActiveSessionsViaRest({ silent: true, reason: 'firestore_error' });
                            }
                        });
                        attachOrderSignal(firestoreShopDocId, activeShopId);
                        callOpt(opts.updateSessionLoadDetail, 'listenActiveSessions 登録完了 path=' + firestoreShopDocId);
                    };

                    var afterClaimsOk = function () {
                        var hasPublicId = !!resolveFirestoreShopDocId(activeShopId);
                        var refreshShops = (!hasPublicId && typeof opts.refreshMyShops === 'function')
                            ? opts.refreshMyShops()
                            : Promise.resolve();
                        return refreshShops.then(function () {
                            callOpt(opts.applySessionTabLayout);
                            kiteiQrMode = effectiveSessionListMode() === 'KITEI_QR';
                            callOpt(opts.applySessionTabLayout);
                            callOpt(opts.setSessionLoadStatus, 'Firestore リスナーを接続中', kiteiQrMode
                                ? '卓メタ + active_sessions'
                                : 'active_sessions（都度発行）');
                            attachFirestoreListener();
                            // 初回スナップショット前は空席／「セッションなし」を出さず読み込み中を維持
                            if (!ready) {
                                showSessionsLoading('セッションを読み込み中...');
                            }
                        });
                    };

                    var runClaimsThenAttach = function () {
                        callOpt(opts.setSessionLoadStatus, 'Firebase Custom Claims を同期中', 'Server API → ID トークン反映');
                        var syncFn = typeof opts.syncClaims === 'function'
                            ? opts.syncClaims
                            : function () { return Promise.resolve({ ok: false, reason: 'disabled' }); };
                        return syncFn({ shopId: activeShopId }).then(function (syncResult) {
                            if (!syncResult || !syncResult.ok) {
                                var sessionListEl = callOpt(opts.getSessionListEl);
                                if (kiteiQrMode) {
                                    callOpt(opts.setTableSeatSyncHint, true, formatClaimsError(syncResult));
                                    loadActiveSessionsViaRest({ silent: true, reason: 'firestore_error' });
                                    return;
                                }
                                if (sessionListEl && typeof opts.renderEmpty === 'function') {
                                    opts.renderEmpty(sessionListEl, formatClaimsError(syncResult), true);
                                }
                                return;
                            }
                            return afterClaimsOk();
                        });
                    };

                    showSessionsLoading('セッションを読み込み中...');

                    if (kiteiQrMode) {
                        if (sessionCache && typeof sessionCache.reset === 'function') {
                            sessionCache.reset();
                        }
                        if (firestoreSdk && typeof firestoreSdk.invalidateActiveSessionListenerSignature === 'function') {
                            firestoreSdk.invalidateActiveSessionListenerSignature(activeShopId);
                        }
                        var metaError = null;
                        // 卓メタ取得と Claims 同期を並列化（直列 2RTT を短縮）
                        return Promise.all([
                            refreshTableSeatsMetadata().catch(function (e) {
                                metaError = e;
                                callOpt(opts.markFirestoreBackoff, e);
                            }),
                            runClaimsThenAttach()
                        ]).then(function () {
                            if (metaError && !ready && !tableSeatsCache.length) {
                                var listEl = callOpt(opts.getSessionListEl);
                                var message = typeof opts.staffUserVisibleLoadError === 'function'
                                    ? opts.staffUserVisibleLoadError(metaError, '未知の問題が発生しました')
                                    : (typeof opts.formatStaffApiError === 'function'
                                        ? opts.formatStaffApiError(metaError, 'テーブル一覧の取得に失敗しました')
                                        : '未知の問題が発生しました');
                                if (listEl && typeof opts.renderEmpty === 'function') {
                                    opts.renderEmpty(listEl, message, true);
                                }
                                callOpt(opts.finishRender);
                            }
                        });
                    }
                    callOpt(opts.setSessionLoadStatus, 'Firestore リスナーを初期化', 'shopId=' + activeShopId);
                    return runClaimsThenAttach();
                };

                run().then(function () {
                    listenerStarting = false;
                    listenerStartPromise = null;
                    resolve();
                }).catch(function () {
                    listenerStarting = false;
                    listenerStartPromise = null;
                    resolve();
                });
            });
            return listenerStartPromise;
        }

        return {
            startListener: startListener,
            stopListener: stopListener,
            attachListener: attachListener,
            scheduleSnapshotFallback: scheduleSnapshotFallback,
            clearSnapshotWaitTimer: clearSnapshotWaitTimer,
            isListenerActiveForShop: isListenerActiveForShop,
            getTableSeatsCache: function () {
                return tableSeatsCache.slice();
            },
            setTableSeatsCache: function (list) {
                assignTableSeatsCache(list);
            },
            getLastTableSeatsRenderKey: function () {
                return lastTableSeatsRenderKey;
            },
            setLastTableSeatsRenderKey: function (key) {
                lastTableSeatsRenderKey = key != null ? String(key) : '';
            },
            isReady: function () {
                return ready;
            },
            setReady: function (value) {
                ready = !!value;
            },
            isRestFallbackActive: function () {
                return restFallbackActive;
            },
            isOrderSignalHealthy: isOrderSignalHealthy,
            renderViewsDebounced: renderViewsDebounced,
            sessionsList: sessionsList,
            loadActiveSessionsViaRest: loadActiveSessionsViaRest,
            getListenerShopId: function () {
                return listenerShopId;
            }
        };
    }

    global.MasterOrderStaffFirestoreRuntimeSdk = {
        version: SDK_VERSION,
        createFirestoreSessionsRuntime: createFirestoreSessionsRuntime,
        defaultFormatClaimsError: defaultFormatClaimsError
    };
})(typeof window !== 'undefined' ? window : globalThis);
