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

    var SDK_VERSION = '1.0.2';

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
            return 'Firestore 直読が無効です（client-config を確認してください）。';
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
        var ready = false;
        var claimsRetryShopId = null;
        var listenerShopId = null;
        var listenerStarting = false;
        var renderDebounceTimer = null;
        var snapshotWaitTimer = null;
        var listenerStartPromise = null;
        var lastTableSeatsRenderKey = '';

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

        function handleFirestoreSessionsSnapshot(sessions, activeShopId, kiteiQrMode) {
            clearSnapshotWaitTimer();
            ready = true;
            callOpt(opts.setTableSeatSyncHint, false);
            applySessionCache(sessions, activeShopId);
            if (kiteiQrMode) {
                notifyTableSeatsReconciled(sessions);
                callOpt(opts.renderViewsNow);
                var bootstrap = typeof opts.bootstrapSessionTotals === 'function'
                    ? Promise.resolve(opts.bootstrapSessionTotals())
                    : Promise.resolve();
                bootstrap.finally(function () {
                    callOpt(opts.setTableSeatSyncHint, false);
                    callOpt(opts.renderViewsNow);
                    callOpt(opts.finishRender);
                    callOpt(opts.resetSessionLoadStatus);
                });
                return;
            }
            renderViewsDebounced();
            callOpt(opts.resetSessionLoadStatus);
        }

        function formatClaimsError(syncResult) {
            var shopId = getShopId();
            if (typeof opts.formatClaimsError === 'function') {
                return opts.formatClaimsError(syncResult, shopId);
            }
            return defaultFormatClaimsError(syncResult, shopId);
        }

        function renderViewsDebounced() {
            if (!isDirectReadActive() || !getShopId()) {
                return;
            }
            if (renderDebounceTimer) {
                clearTimeout(renderDebounceTimer);
            }
            var delayMs = resolvedSessionMode() === 'KITEI_QR' ? 400 : 350;
            renderDebounceTimer = setTimeout(function () {
                renderDebounceTimer = null;
                callOpt(opts.renderViewsNow);
            }, delayMs);
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

        function stopListener(stopOpts) {
            var so = stopOpts || {};
            var keepTableCache = so.keepTableCache === true;
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
            listenerShopId = null;
            listenerStarting = false;
            listenerStartPromise = null;
            lastTableSeatsRenderKey = '';
            clearSnapshotWaitTimer();
            if (renderDebounceTimer) {
                clearTimeout(renderDebounceTimer);
                renderDebounceTimer = null;
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
                    if (global.console && typeof global.console.warn === 'function') {
                        global.console.warn('[StaffFirestore] snapshot timeout deferred — tables fetch in flight');
                    }
                    scheduleSnapshotFallback(activeShopId, kiteiQrMode);
                    return;
                }
                if (global.console && typeof global.console.warn === 'function') {
                    global.console.warn('[StaffFirestore] snapshot timeout — falling back to REST');
                }
                callOpt(opts.setSessionLoadStatus, 'Firestore 応答タイムアウト — REST に切替', '待機 ' + (timeoutMs / 1000) + ' 秒');
                callOpt(opts.setTableSeatSyncHint, false);
                loadActiveSessionsViaRest({ silent: true, reason: 'firestore_timeout' });
            }, timeoutMs);
        }

        function refreshTableSeatsMetadata() {
            var shopId = getShopId();
            if (!shopId) {
                return Promise.resolve();
            }
            var timeoutMs = callOpt(opts.getTablesApiTimeoutMs);
            if (!timeoutMs || timeoutMs <= 0) {
                timeoutMs = 15000;
            }
            var apiBase = callOpt(opts.getApiBase) || '';
            var path = '/shops/' + encodeURIComponent(shopId) + '/tables?includeSessionStatus=false';
            callOpt(opts.setSessionLoadStatus,
                'テーブル一覧を API から取得中',
                apiBase + path + ' — 最大 ' + (timeoutMs / 1000) + ' 秒');
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
                var message = typeof opts.formatStaffApiError === 'function'
                    ? opts.formatStaffApiError(e, 'セッション一覧の取得に失敗しました')
                    : ((e && e.message) ? String(e.message) : 'セッション一覧の取得に失敗しました');
                if (sessionListEl && typeof opts.renderEmpty === 'function') {
                    opts.renderEmpty(sessionListEl, message, true);
                }
            });
        }

        function attachListener(activeShopId) {
            if (!isDirectReadActive() || !firestoreSdk || !activeShopId) {
                return;
            }
            if (unsubscribe) {
                unsubscribe();
                unsubscribe = null;
            }
            callOpt(opts.setSessionLoadStatus, 'Firestore リスナーを再接続中', 'Claims 再同期後');
            unsubscribe = firestoreSdk.listenActiveSessions(activeShopId, {
                onSessions: function (sessions) {
                    callOpt(opts.setSessionLoadStatus,
                        'Firestore スナップショット受信（再接続）',
                        (sessions ? sessions.length : 0) + ' 件');
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

                    var afterMetadata = function () {
                        callOpt(opts.setSessionLoadStatus, 'Firebase Custom Claims を同期中', 'Server API → ID トークン反映');
                        var syncFn = typeof opts.syncClaims === 'function'
                            ? opts.syncClaims
                            : function () { return Promise.resolve({ ok: false, reason: 'disabled' }); };
                        return syncFn({ shopId: activeShopId }).then(function (syncResult) {
                            if (!syncResult || !syncResult.ok) {
                                var sessionListEl = callOpt(opts.getSessionListEl);
                                if (kiteiQrMode && sessionListEl && sessionListEl.querySelector('.table-seats-wrap')) {
                                    callOpt(opts.setTableSeatSyncHint, true, formatClaimsError(syncResult));
                                    loadActiveSessionsViaRest({ silent: true, reason: 'firestore_error' });
                                    return;
                                }
                                if (sessionListEl && typeof opts.renderEmpty === 'function') {
                                    opts.renderEmpty(sessionListEl, formatClaimsError(syncResult), true);
                                }
                                return;
                            }
                            var refreshShops = typeof opts.refreshMyShops === 'function'
                                ? opts.refreshMyShops()
                                : Promise.resolve();
                            return refreshShops.then(function () {
                                callOpt(opts.applySessionTabLayout);
                                kiteiQrMode = effectiveSessionListMode() === 'KITEI_QR';
                                callOpt(opts.applySessionTabLayout);

                                var attachFirestoreListener = function () {
                                    scheduleSnapshotFallback(activeShopId, kiteiQrMode);
                                    unsubscribe = firestoreSdk.listenActiveSessions(activeShopId, {
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
                                    callOpt(opts.updateSessionLoadDetail, 'listenActiveSessions 登録完了');
                                };

                                callOpt(opts.setSessionLoadStatus, 'Firestore リスナーを接続中', kiteiQrMode
                                    ? '卓メタ + active_sessions'
                                    : 'active_sessions（都度発行）');
                                attachFirestoreListener();

                                if (kiteiQrMode) {
                                    callOpt(opts.setSessionLoadStatus,
                                        'テーブルカードを描画中',
                                        tableSeatsCache.length + ' 卓');
                                    callOpt(opts.renderKiteiQr, [], { syncPending: !ready });
                                } else if (sessionsList().length) {
                                    callOpt(opts.renderViewsNow);
                                } else {
                                    var listEl = callOpt(opts.getSessionListEl);
                                    if (listEl && typeof opts.renderEmpty === 'function') {
                                        opts.renderEmpty(listEl, 'アクティブなセッションはありません');
                                    }
                                    callOpt(opts.finishRender);
                                }
                            });
                        });
                    };

                    if (kiteiQrMode) {
                        if (sessionCache && typeof sessionCache.reset === 'function') {
                            sessionCache.reset();
                        }
                        if (firestoreSdk && typeof firestoreSdk.invalidateActiveSessionListenerSignature === 'function') {
                            firestoreSdk.invalidateActiveSessionListenerSignature(activeShopId);
                        }
                        return refreshTableSeatsMetadata().then(function () {
                            if (tableSeatsCache.length) {
                                callOpt(opts.renderKiteiQr, [], { syncPending: !ready });
                            }
                            return afterMetadata();
                        }).catch(function (e) {
                            callOpt(opts.markFirestoreBackoff, e);
                            var listEl = callOpt(opts.getSessionListEl);
                            var message = typeof opts.formatStaffApiError === 'function'
                                ? opts.formatStaffApiError(e, 'テーブル一覧の取得に失敗しました')
                                : 'テーブル一覧の取得に失敗しました';
                            if (listEl && typeof opts.renderEmpty === 'function') {
                                opts.renderEmpty(listEl, message, true);
                            }
                            callOpt(opts.finishRender);
                        });
                    }
                    callOpt(opts.setSessionLoadStatus, 'Firestore リスナーを初期化', 'shopId=' + activeShopId);
                    return afterMetadata();
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
