/**
 * MasterOrder Staff Session List SDK — セッション一覧の読み込み戦略を一元化。
 *
 * 卓カードは「卓メタ（REST）」だけでは totalAmount / startTime を持たない。
 * Firestore 直読・REST いずれも merge + API 合計補完後に描画する。
 *
 * 依存: staff-firestore-sdk.js, staff-session-mode-sdk.js（任意）
 * グローバル: MasterOrderStaffSessionListSdk
 */
(function (global) {
    'use strict';

    var SDK_VERSION = '1.2.0';

    function asArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function mergeTableSeatsForDisplay(tableSeats, sessions) {
        var firestoreSdk = global.MasterOrderStaffFirestoreSdk;
        if (!firestoreSdk || typeof firestoreSdk.mergeTableSeatsWithSessions !== 'function') {
            return asArray(tableSeats);
        }
        return firestoreSdk.mergeTableSeatsWithSessions(
            asArray(tableSeats),
            asArray(sessions)
        );
    }

    /**
     * loadSessions / 更新ボタン向けの戦略判定。
     * @param {{ isFirestoreDirectReadActive: function(): boolean, usesTableSeatGrid: function(): boolean }} ctx
     * @param {{ includeTotals?: boolean, userRefresh?: boolean }} options
     */
    function planSessionListLoad(ctx, options) {
        var opts = options || {};
        var useFirestore = !!(ctx && typeof ctx.isFirestoreDirectReadActive === 'function'
            && ctx.isFirestoreDirectReadActive());
        var useGrid = !!(ctx && typeof ctx.usesTableSeatGrid === 'function' && ctx.usesTableSeatGrid());
        var includeTotals = opts.includeTotals === true || opts.userRefresh === true;

        if (useFirestore && !includeTotals) {
            return { action: 'FIRESTORE_LISTEN' };
        }
        if (useFirestore && useGrid && includeTotals) {
            return { action: 'FIRESTORE_REFRESH_MERGED' };
        }
        if (useGrid) {
            return { action: 'REST_TABLE_GRID_MERGED', includeTotals: includeTotals };
        }
        return { action: 'REST_SESSION_LIST', includeTotals: includeTotals };
    }

    /**
     * 固定QR + Firestore 直読の「更新」: 卓メタだけ差し替え、表示はキャッシュ merge + 合計 API 補完。
     * @param {{
     *   refreshTableMetadata?: function(object): Promise<Array>,
     *   refreshSessionTotals?: function(): Promise<Array>,
     *   renderMergedViews?: function(): void,
     *   setTableSeatsCache?: function(Array): void
     * }} hooks
     */
    function refreshFirestoreMergedGrid(hooks, options) {
        var h = hooks || {};
        var opts = options || {};
        var chain = Promise.resolve();

        if (opts.refreshTableMetadata === true && typeof h.refreshTableMetadata === 'function') {
            chain = chain.then(function () {
                return h.refreshTableMetadata({ includeSessionStatus: false });
            }).then(function (tables) {
                if (typeof h.setTableSeatsCache === 'function') {
                    h.setTableSeatsCache(asArray(tables));
                }
                return tables;
            });
        }
        if (typeof h.refreshSessionTotals === 'function') {
            chain = chain.then(function () {
                return h.refreshSessionTotals({ force: true });
            });
        }
        return chain.then(function () {
            if (typeof h.renderMergedViews === 'function') {
                h.renderMergedViews();
            }
        });
    }

    function buildMergedGridView(tableSeats, sessions) {
        return mergeTableSeatsForDisplay(tableSeats, sessions);
    }

    /**
     * 卓グリッド（都度発行 / REST フォールバック）: tables + active-sessions を並列取得して merge。
     * @param {{
     *   fetchTableSeats: function(object): Promise<Array>,
     *   fetchActiveSessions: function(object): Promise<Array>,
     *   setTableSeatsCache?: function(Array): void,
     *   onSessionsLoaded?: function(Array): void
     * }} hooks
     * @param {{ includeTotals?: boolean }} options
     */
    function loadMergedTableGrid(hooks, options) {
        var h = hooks || {};
        var opts = options || {};
        var includeTotals = opts.includeTotals === true;
        if (typeof h.fetchTableSeats !== 'function' || typeof h.fetchActiveSessions !== 'function') {
            return Promise.reject(new Error('loadMergedTableGrid: fetchTableSeats and fetchActiveSessions are required'));
        }
        return Promise.all([
            h.fetchTableSeats({ includeSessionStatus: true }),
            h.fetchActiveSessions({ includeTotals: includeTotals })
        ]).then(function (pair) {
            var tables = asArray(pair[0]);
            var sessions = asArray(pair[1]);
            if (typeof h.setTableSeatsCache === 'function') {
                h.setTableSeatsCache(tables);
            }
            if (typeof h.onSessionsLoaded === 'function') {
                h.onSessionsLoaded(sessions);
            }
            return mergeTableSeatsForDisplay(tables, sessions);
        });
    }

    /**
     * 卓カードの合計・経過時間は GET /sessions/active?includeTotals=true 必須。
     * Firestore 直読だけでは totalAmount が 0 のままのことがある。
     */
    function enrichSessionCardDetailsFromApi(hooks) {
        var h = hooks || {};
        if (typeof h.refreshSessionTotals === 'function') {
            return Promise.resolve(h.refreshSessionTotals({ force: true }));
        }
        return Promise.resolve([]);
    }

    function createSessionListCoordinator(options) {
        var opts = options || {};

        function plan(options) {
            return planSessionListLoad({
                isFirestoreDirectReadActive: opts.isFirestoreDirectReadActive,
                usesTableSeatGrid: opts.usesTableSeatGrid
            }, options);
        }

        function refreshMergedGrid(refreshOpts) {
            return refreshFirestoreMergedGrid({
                refreshTableMetadata: opts.fetchTableSeats,
                refreshSessionTotals: opts.refreshSessionTotals,
                renderMergedViews: opts.renderMergedViews,
                setTableSeatsCache: opts.setTableSeatsCache
            }, refreshOpts);
        }

        function buildMergedView(tableSeats, sessions) {
            return buildMergedGridView(tableSeats, sessions);
        }

        function loadTableGrid(loadOpts) {
            return loadMergedTableGrid({
                fetchTableSeats: opts.fetchTableSeats,
                fetchActiveSessions: opts.fetchActiveSessions,
                setTableSeatsCache: opts.setTableSeatsCache,
                onSessionsLoaded: opts.onSessionsLoaded
            }, loadOpts);
        }

        function enrichCardDetails() {
            return enrichSessionCardDetailsFromApi({
                refreshSessionTotals: opts.refreshSessionTotals
            });
        }

        return {
            plan: plan,
            refreshMergedGrid: refreshMergedGrid,
            loadTableGrid: loadTableGrid,
            mergeTableSeatsForDisplay: mergeTableSeatsForDisplay,
            buildMergedView: buildMergedView,
            enrichCardDetails: enrichCardDetails
        };
    }

    global.MasterOrderStaffSessionListSdk = {
        version: SDK_VERSION,
        planSessionListLoad: planSessionListLoad,
        mergeTableSeatsForDisplay: mergeTableSeatsForDisplay,
        buildMergedGridView: buildMergedGridView,
        enrichSessionCardDetailsFromApi: enrichSessionCardDetailsFromApi,
        refreshFirestoreMergedGrid: refreshFirestoreMergedGrid,
        loadMergedTableGrid: loadMergedTableGrid,
        createSessionListCoordinator: createSessionListCoordinator
    };
})(typeof window !== 'undefined' ? window : globalThis);
