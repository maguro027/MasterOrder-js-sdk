/**
 * MasterOrder Staff App Wiring — index.html から注入する依存を SDK サービスへ束ねる。
 *
 * 依存: staff-ui / staff-claims / staff-session-mode / staff-qr / staff-firestore-runtime
 * dashboard は遅延チャンク（staff-sdk.lazy-charts.js）— 初回は未ロード可
 * グローバル: MasterOrderStaffAppWiring
 */
(function (global) {
    'use strict';

    var SDK_VERSION = '1.1.0';

    /**
     * @param {{
     *   getShopId: function(): *,
     *   getShopSlug?: function(): string,
     *   getCurrentShop: function(): object|null,
     *   getOrderPublicBase: function(): string,
     *   getApiBase: function(): string,
     *   getAuthUser: function(): object|null,
     *   clientSdk: object,
     *   sessionCache: object,
     *   firestoreDirectReadEnabled: boolean,
     *   getSessionListEl: function(): Element,
     *   getStatusRail?: function(): Element|null,
     *   getTableSeatsCache: function(): Array,
     *   setTableSeatsCache: function(Array): void,
     *   isTablesFetchInFlight: function(): boolean,
     *   getTablesApiTimeoutMs: function(): number,
     *   hooks: object
     * }} config
     */
    function createStaffAppServices(config) {
        var cfg = config || {};
        var hooks = cfg.hooks || {};
        var ui = global.MasterOrderStaffUiSdk;
        var claimsMod = global.MasterOrderStaffClaimsSdk;
        var modeMod = global.MasterOrderStaffSessionModeSdk;
        var qrMod = global.MasterOrderStaffQrSdk;
        var runtimeMod = global.MasterOrderStaffFirestoreRuntimeSdk;

        if (!ui || !claimsMod || !modeMod || !qrMod || !runtimeMod) {
            throw new Error('Staff app wiring requires staff-ui, staff-claims, staff-session-mode, staff-qr, staff-firestore-runtime SDKs');
        }

        var firestoreBackoff = ui.createFirestoreBackoff();
        var httpRateLimitBackoff = typeof ui.createHttpRateLimitBackoff === 'function'
            ? ui.createHttpRateLimitBackoff()
            : null;

        var sessionLoadCtl = ui.createSessionLoadStatusController({
            getSessionList: cfg.getSessionListEl,
            getStatusRail: cfg.getStatusRail,
            onTableSeatSyncHint: hooks.onTableSeatSyncHint
        });

        var sessionMode = modeMod.createSessionModeContext({
            getCurrentShop: cfg.getCurrentShop,
            firestoreDirectReadEnabled: cfg.firestoreDirectReadEnabled,
            getTableSeatsCacheLength: function () {
                var cache = cfg.getTableSeatsCache ? cfg.getTableSeatsCache() : [];
                return Array.isArray(cache) ? cache.length : 0;
            }
        });

        var claims = claimsMod.createStaffClaimsSync({
            clientSdk: cfg.clientSdk,
            getAuthUser: cfg.getAuthUser,
            getApiBase: cfg.getApiBase,
            getShopId: cfg.getShopId,
            getShopPublicId: cfg.getShopPublicId,
            firestoreDirectReadEnabled: cfg.firestoreDirectReadEnabled,
            claimsSyncTimeoutMs: cfg.claimsSyncTimeoutMs || 15000,
            promiseWithTimeout: ui.promiseWithTimeout
        });

        var qr = qrMod.createStaffQrService({
            getShopId: cfg.getShopId,
            getShopSlug: cfg.getShopSlug,
            getOrderPublicBase: cfg.getOrderPublicBase,
            isSessionsTabActive: hooks.isSessionsTabActive || function () { return false; }
        });

        var firestoreRuntime = runtimeMod.createFirestoreSessionsRuntime({
            getShopId: cfg.getShopId,
            getShopPublicId: cfg.getShopPublicId,
            sessionCache: cfg.sessionCache,
            staffSdk: cfg.clientSdk,
            isDirectReadEnabled: function () {
                return cfg.firestoreDirectReadEnabled && sessionMode.resolvedSessionMode() === 'KITEI_QR';
            },
            isDirectReadActive: sessionMode.staffFirestoreSessionsDirectReadActive,
            resolvedSessionMode: sessionMode.resolvedSessionMode,
            effectiveSessionListMode: sessionMode.effectiveSessionListMode,
            usesTableSeatGrid: sessionMode.usesTableSeatGrid,
            isTablesFetchInFlight: cfg.isTablesFetchInFlight,
            getTablesApiTimeoutMs: cfg.getTablesApiTimeoutMs,
            getApiBase: cfg.getApiBase,
            syncClaims: function (opts) { return claims.syncClaims(opts); },
            postClaimsSync: function () { return claims.postClaimsSync(); },
            refreshAuthToken: hooks.refreshAuthToken,
            formatClaimsError: function (syncResult, shopId) {
                return claims.formatClaimsError(syncResult, shopId);
            },
            markFirestoreBackoff: firestoreBackoff.mark,
            formatStaffApiError: function (err, fb) {
                if (httpRateLimitBackoff) {
                    httpRateLimitBackoff.mark(err);
                }
                return ui.formatStaffApiError(err, fb, firestoreBackoff);
            },
            staffUserVisibleLoadError: function (err, fb) {
                if (httpRateLimitBackoff) {
                    httpRateLimitBackoff.mark(err);
                }
                return ui.staffUserVisibleLoadError(err, fb, firestoreBackoff);
            },
            setSessionLoadStatus: sessionLoadCtl.setStatus,
            updateSessionLoadDetail: sessionLoadCtl.updateDetail,
            resetSessionLoadStatus: sessionLoadCtl.reset,
            setTableSeatSyncHint: hooks.setTableSeatSyncHint,
            finishRender: hooks.finishRender,
            getSessionListEl: cfg.getSessionListEl,
            renderEmpty: hooks.renderEmpty,
            renderKiteiQr: hooks.renderKiteiQr,
            renderViewsNow: hooks.renderViewsNow,
            applySessionTabLayout: hooks.applySessionTabLayout,
            refreshMyShops: hooks.refreshMyShops,
            fetchTableSeatsMetadata: hooks.fetchTableSeatsMetadata,
            setTableSeatsCache: cfg.setTableSeatsCache,
            applySessionCache: hooks.applySessionCache,
            sessionsList: hooks.sessionsList,
            onRestRenderSessions: hooks.onRestRenderSessions,
            onRestUpdateModeGuard: hooks.onRestUpdateModeGuard,
            onRestOfflineBanner: hooks.onRestOfflineBanner,
            onRestSaveOfflineSnapshot: hooks.onRestSaveOfflineSnapshot,
            attachListenerAfterClaims: hooks.attachListenerAfterClaims,
            bootstrapSessionTotals: hooks.bootstrapSessionTotals,
            onReconcileTableSeats: hooks.onReconcileTableSeats,
            onSessionsChangedForOrders: hooks.onSessionsChangedForOrders,
            onOrderSignalBump: hooks.onOrderSignalBump,
            onOrderSignalHealth: hooks.onOrderSignalHealth,
            onOrderSignalError: hooks.onOrderSignalError
        });

        var dashboardInstance = null;

        function getDashboard() {
            var dashMod = global.MasterOrderStaffDashboardSdk;
            if (!dashMod || typeof dashMod.createStaffDashboardCharts !== 'function') {
                throw new Error('Staff dashboard SDK is not loaded yet (call MasterOrderStaffLazyLoader.ensureCharts first)');
            }
            if (!dashboardInstance) {
                dashboardInstance = dashMod.createStaffDashboardCharts({
                    getChartJsReady: function () { return global.__chartJsReady; }
                });
            }
            return dashboardInstance;
        }

        function getTableSeatsFromRuntime() {
            return firestoreRuntime.getTableSeatsCache();
        }

        function syncTableSeatsCacheToRuntime(list) {
            firestoreRuntime.setTableSeatsCache(Array.isArray(list) ? list : []);
            if (typeof cfg.setTableSeatsCache === 'function') {
                cfg.setTableSeatsCache(Array.isArray(list) ? list : []);
            }
        }

        return {
            firestoreBackoff: firestoreBackoff,
            sessionLoad: sessionLoadCtl,
            sessionMode: sessionMode,
            claims: claims,
            qr: qr,
            firestoreRuntime: firestoreRuntime,
            get dashboard() {
                return getDashboard();
            },
            ensureDashboard: function () {
                var loader = global.MasterOrderStaffLazyLoader;
                var ready = Promise.resolve();
                if (loader && typeof loader.ensureCharts === 'function') {
                    ready = loader.ensureCharts();
                }
                return ready.then(function () {
                    return getDashboard();
                });
            },
            ui: ui,
            getTableSeatsFromRuntime: getTableSeatsFromRuntime,
            syncTableSeatsCacheToRuntime: syncTableSeatsCacheToRuntime,
            formatStaffApiError: function (err, fallback) {
                if (httpRateLimitBackoff) {
                    httpRateLimitBackoff.mark(err);
                }
                return ui.formatStaffApiError(err, fallback, firestoreBackoff);
            },
            staffUserVisibleLoadError: function (err, fallback) {
                if (httpRateLimitBackoff) {
                    httpRateLimitBackoff.mark(err);
                }
                return ui.staffUserVisibleLoadError(err, fallback, firestoreBackoff);
            },
            isFirestoreBackoffActive: function () {
                return firestoreBackoff.isActive();
            },
            isHttpRateLimitBackoffActive: function () {
                return !!(httpRateLimitBackoff && httpRateLimitBackoff.isActive());
            },
            markFirestoreBackoff: function (err) {
                firestoreBackoff.mark(err);
            },
            promiseWithTimeout: ui.promiseWithTimeout,
            sortPendingOrders: ui.sortPendingOrders,
            formatElapsed: ui.formatElapsed,
            formatOrderTime: ui.formatOrderTime,
            yen: ui.yen,
            tableSeatsCombinedRenderKey: ui.tableSeatsCombinedRenderKey
        };
    }

    global.MasterOrderStaffAppWiring = {
        VERSION: SDK_VERSION,
        createStaffAppServices: createStaffAppServices
    };
})(typeof window !== 'undefined' ? window : globalThis);
