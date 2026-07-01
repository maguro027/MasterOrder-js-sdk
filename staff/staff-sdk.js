/**
 * MasterOrder Staff SDK — 店舗スタッフ向け（Firebase Auth + Server REST/SSE）。
 *
 * 依存: api-routes.js → core-sdk.js → staff-sdk.js
 * グローバル: MasterOrderStaffSdk（推奨） / MasterOrderClientSdk（後方互換エイリアス）
 *
 * UI から Server へ直接 fetch せず、createStaffSdk() 経由で通信してください。
 */
(function (global) {
    'use strict';

    var SDK_VERSION = '1.2.2';

    var STAFF_SESSION_UPDATED_EVENT = 'masterorder:staff-session-updated';

    function emitStaffSessionUpdated(detail) {
        if (typeof global.dispatchEvent !== 'function') {
            return;
        }
        try {
            global.dispatchEvent(new CustomEvent(STAFF_SESSION_UPDATED_EVENT, {
                detail: detail || {}
            }));
        } catch (_ignored) {
            /* ignore */
        }
    }

    var core = global.MasterOrderCoreSdk;
    if (!core) {
        throw new Error('MasterOrderCoreSdk is required before staff-sdk.js');
    }
    var apiRouteRegistry = global.MasterOrderApiRoutes;
    if (!apiRouteRegistry || !apiRouteRegistry.paths || !apiRouteRegistry.paths.staff) {
        throw new Error('MasterOrderApiRoutes is required. Load api-routes.js before staff-sdk.js');
    }
    var staffPaths = apiRouteRegistry.paths.staff;
    var authPaths = apiRouteRegistry.paths.auth || staffPaths;

    function issueSseTicket(http, shopId) {
        return http.post(core.withQuery(staffPaths.orderEventsTicket(), { shopId: shopId }), undefined)
            .then(function (body) {
                if (!body || !body.sseTicket) {
                    throw new Error('sseTicket missing in ticket response');
                }
                return body.sseTicket;
            });
    }

    /**
     * スタッフ API クライアント（Firebase ID トークン付き HTTP + SSE）。
     * @param {{ apiBaseUrl: string, getIdToken?: function(): Promise<string|null>, onUnauthorized?: function(), sseReconnectDelayMs?: number }} options
     */
    function createStaffSdk(options) {
        var apiBaseUrl = options.apiBaseUrl;
        var fallbackBases = options.fallbackBaseUrls;
        if (!fallbackBases && typeof window !== 'undefined' && window._serverBaseFallbacks) {
            fallbackBases = window._serverBaseFallbacks;
        }
        var http = core.createHttpClient({
            baseUrl: apiBaseUrl,
            fallbackBaseUrls: fallbackBases,
            getAccessToken: options.getIdToken,
            onUnauthorized: options.onUnauthorized
        });

        var sse = core.createSseClient({
            reconnectDelayMs: options.sseReconnectDelayMs || 5000,
            minReconnectGapMs: options.sseMinReconnectGapMs || 15000
        });

        var profileApi = core.createProfileApi(http, authPaths);
        var accountStateApi = core.createAccountStateApi(http, authPaths);
        var piiCache = global.MasterOrderStaffPiiLocalCache;
        var getFirebaseUid = typeof options.getFirebaseUid === 'function'
            ? options.getFirebaseUid
            : function () { return options.firebaseUid || null; };

        function cacheProfile(profile) {
            var uid = getFirebaseUid();
            if (uid && piiCache && profile) {
                piiCache.saveProfile(uid, profile);
            }
            return profile;
        }

        function getMyProfileWithCache() {
            var uid = getFirebaseUid();
            return profileApi.getMyProfile()
                .then(cacheProfile)
                .catch(function (err) {
                    if (uid && piiCache) {
                        var cached = piiCache.loadProfile(uid);
                        if (cached) {
                            return cached;
                        }
                    }
                    return Promise.reject(err);
                });
        }

        function wrapProfileMutation(fn) {
            return function () {
                var args = arguments;
                return fn.apply(profileApi, args).then(cacheProfile);
            };
        }

        function wrapSseHandler(handler) {
            return function (event) {
                var uid = getFirebaseUid();
                if (uid && piiCache && event) {
                    piiCache.handleRealtimeEvent(uid, event.data);
                }
                if (typeof handler === 'function') {
                    handler(event);
                }
            };
        }

        function listShopMembersWithCache(shopId) {
            var uid = getFirebaseUid();
            return http.get(staffPaths.members(shopId))
                .then(function (members) {
                    var list = Array.isArray(members) ? members : [];
                    if (uid && piiCache) {
                        piiCache.saveShopMembers(uid, shopId, list);
                    }
                    return list;
                })
                .catch(function (err) {
                    if (uid && piiCache) {
                        var cached = piiCache.loadShopMembers(uid, shopId);
                        if (cached) {
                            return cached;
                        }
                    }
                    return Promise.reject(err);
                });
        }

        return {
            api: http.request,
            clearLocalPiiCache: function () {
                var uid = getFirebaseUid();
                if (uid && piiCache) {
                    piiCache.clearAll(uid);
                }
            },
            getMyShops: function () {
                return http.get(staffPaths.myShops());
            },
            createShop: function (payload) {
                return http.post(staffPaths.createShop(), payload);
            },
            getMyProfile: getMyProfileWithCache,
            updateMyProfile: wrapProfileMutation(profileApi.updateMyProfile),
            setMyPublicId: wrapProfileMutation(profileApi.setMyPublicId),
            saveProfile: wrapProfileMutation(profileApi.saveProfile),
            getMyAccountStatus: accountStateApi.getMyAccountStatus,
            reportPasswordResetCompleted: accountStateApi.reportPasswordResetCompleted,
            syncFirebaseClaims: function () {
                return http.post(staffPaths.syncFirebaseClaims(), undefined);
            },
            getShopDashboard: function (shopId, period) {
                return http.get(core.withQuery(staffPaths.shopDashboard(shopId), {
                    period: period
                }));
            },
            getOrderPageTemplates: function (shopId) {
                return http.get(core.withQuery(staffPaths.orderPageTemplates(), {
                    shopId: shopId
                }));
            },
            updateOrderPageTemplate: function (shopId, templateKey) {
                return http.request(staffPaths.updateOrderPageTemplate(shopId), {
                    method: 'PATCH',
                    body: JSON.stringify({ templateKey: templateKey })
                });
            },
            updateSessionMode: function (shopId, sessionMode) {
                return http.request(staffPaths.updateSessionMode(shopId), {
                    method: 'PATCH',
                    body: JSON.stringify({ sessionMode: sessionMode })
                });
            },
            updateMaxActiveSessions: function (shopId, maxActiveSessions) {
                return http.patch(staffPaths.updateMaxActiveSessions(shopId), {
                    maxActiveSessions: maxActiveSessions
                });
            },
            updateTargetSales: function (shopId, targetSales) {
                return http.patch(staffPaths.updateTargetSales(shopId), {
                    targetSales: targetSales
                });
            },
            getShopTables: function (shopId, options) {
                var opts = options || {};
                var query = {};
                if (opts.includeSessionStatus === false) {
                    query.includeSessionStatus = false;
                }
                var reqOpts = {};
                if (opts.signal) {
                    reqOpts.signal = opts.signal;
                }
                return http.get(core.withQuery(staffPaths.shopTables(shopId), query), reqOpts);
            },
            ensureTablePassphrases: function (shopId, options) {
                var reqOpts = {};
                if (options && options.signal) {
                    reqOpts.signal = options.signal;
                }
                return http.post(staffPaths.ensureTablePassphrases(shopId), null, reqOpts);
            },
            refreshTablePassphrase: function (shopId, tableNo) {
                return http.post(staffPaths.refreshTablePassphrase(shopId, tableNo));
            },
            getFixedQrDisplay: function (shopId, tableNo) {
                return http.get(staffPaths.fixedQrDisplay(shopId, tableNo));
            },
            getActiveSessions: function (shopId, options) {
                var opts = options || {};
                var query = { shopId: shopId };
                if (opts.includeTotals === true) {
                    query.includeTotals = true;
                }
                return http.get(core.withQuery(staffPaths.activeSessions(), query))
                    .then(function (response) {
                        if (typeof core.normalizeActiveSessionListResponse === 'function') {
                            return core.normalizeActiveSessionListResponse(response);
                        }
                        return Array.isArray(response) ? response : [];
                    });
            },
            createSession: function (shopId, payload) {
                return http.post(staffPaths.createSession(shopId), payload);
            },
            checkoutSession: function (sessionId) {
                return http.post(staffPaths.checkoutSession(sessionId));
            },
            getSessionDetail: function (sessionId, options) {
                var opts = options || {};
                var query = {};
                if (opts.includeOrders === false) {
                    query.includeOrders = false;
                }
                return http.get(core.withQuery(staffPaths.sessionDetail(sessionId), query))
                    .then(core.normalizeSessionDetailResponse);
            },
            getPendingOrders: function (shopId) {
                return http.get(core.withQuery(staffPaths.pendingOrders(), { shopId: shopId }))
                    .then(core.normalizePendingOrdersResponse);
            },
            getArchivedSessions: function (shopId, options) {
                var opts = options || {};
                return http.get(core.withQuery(staffPaths.archiveSessions(), Object.assign({ shopId: shopId }, opts)));
            },
            getArchivedSessionDetail: function (sessionId) {
                return http.get(staffPaths.archiveSessionDetail(sessionId))
                    .then(core.normalizeSessionDetailResponse);
            },
            updateSessionMemo: function (sessionId, memo) {
                return http.request(staffPaths.sessionMemo(sessionId), {
                    method: 'PATCH',
                    body: JSON.stringify({ memo: memo != null ? memo : '' })
                });
            },
            markOrderServed: function (orderId) {
                return http.post(staffPaths.markOrderServed(orderId));
            },
            serveOrderLine: function (orderId, lineIndex, quantity) {
                return http.post(staffPaths.serveOrderLine(orderId), {
                    lineIndex: lineIndex,
                    quantity: quantity != null ? quantity : 1
                });
            },
            connectOrderEvents: function (shopId, handlers) {
                var h = handlers || {};
                return sse.connectAsync({
                    url: apiBaseUrl + staffPaths.orderEventsSse(),
                    query: { shopId: shopId },
                    fetchTicket: function () {
                        return issueSseTicket(http, shopId);
                    },
                    eventName: 'order-update',
                    onMessage: wrapSseHandler(h.onOrderUpdate),
                    onOpen: h.onOpen,
                    onError: h.onError
                });
            },
            connectShopOrderEvents: function (shopId, realtimeHandler, handlers) {
                var h = handlers || {};
                return sse.connectAsync({
                    url: apiBaseUrl + staffPaths.orderEventsSse(),
                    query: { shopId: shopId },
                    fetchTicket: function () {
                        return issueSseTicket(http, shopId);
                    },
                    eventName: 'order-update',
                    onMessage: wrapSseHandler(function (event) {
                        if (typeof realtimeHandler === 'function') {
                            void realtimeHandler(event);
                        }
                    }),
                    onOpen: h.onOpen,
                    onError: h.onError
                });
            },
            closeOrderEvents: function () {
                sse.close();
            },
            getMyPermissions: function (shopId) {
                return http.get(staffPaths.permissionsMe(shopId));
            },
            listShopMembers: listShopMembersWithCache,
            inviteMemberByPublicId: function (shopId, publicId, roleType) {
                return http.post(staffPaths.inviteMember(shopId), {
                    publicId: publicId,
                    roleType: roleType
                });
            },
            acceptInvitation: function (shopId) {
                return http.post(staffPaths.acceptInvitation(shopId), {});
            },
            rejectInvitation: function (shopId) {
                return http.post(staffPaths.rejectInvitation(shopId), {});
            },
            listMyInvitations: function () {
                return http.get(staffPaths.myInvitations());
            },
            listMyNotifications: function () {
                return http.get(staffPaths.myNotifications());
            },
            dismissNotification: function (notificationId) {
                return http.post(staffPaths.dismissNotification(notificationId), {});
            },
            updateMemberRole: function (shopId, publicId, roleType) {
                return http.request(staffPaths.updateMemberRole(shopId, publicId), {
                    method: 'PUT',
                    body: JSON.stringify({ roleType: roleType })
                });
            },
            removeMember: function (shopId, publicId) {
                return http.delete(staffPaths.removeMember(shopId, publicId));
            },
            getManageMenus: function (shopId) {
                return Promise.all([
                    http.get(staffPaths.manageMenus(shopId)),
                    http.get(staffPaths.shopInventory(shopId)).catch(function () { return []; })
                ]).then(function (pair) {
                    var menus = Array.isArray(pair[0]) ? pair[0] : [];
                    var inventory = Array.isArray(pair[1]) ? pair[1] : [];
                    var ui = global.MasterOrderStaffUiSdk;
                    if (ui && typeof ui.mergeMenusWithInventory === 'function') {
                        return ui.mergeMenusWithInventory(menus, inventory);
                    }
                    return menus;
                });
            },
            getManageMenuLimits: function (shopId) {
                return http.get(staffPaths.manageMenuLimits(shopId));
            },
            createMenu: function (shopId, payload) {
                return http.post(staffPaths.createMenu(shopId), payload);
            },
            updateMenu: function (menuId, payload) {
                return http.request(staffPaths.updateMenu(menuId), {
                    method: 'PUT',
                    body: JSON.stringify(payload || {})
                });
            },
            uploadMenuImage: function (menuId, file) {
                var form = new FormData();
                form.append('file', file);
                return http.request(staffPaths.uploadMenuImage(menuId), {
                    method: 'POST',
                    body: form
                });
            },
            deleteMenu: function (menuId) {
                return http.delete(staffPaths.deleteMenu(menuId));
            },
            getCatalogUnpublished: function (shopId) {
                return http.get(staffPaths.catalogUnpublished(shopId));
            },
            publishCatalog: function (shopId, target) {
                return http.post(staffPaths.publishCatalog(shopId, target || 'all'), {});
            },
            getShopSubscribe: function (shopId) {
                return http.get(staffPaths.shopSubscribe(shopId));
            },
            createBillingCheckoutSession: function (shopId, payload) {
                return http.post(staffPaths.billingCheckoutSession(shopId), payload || {});
            },
            getBillingAddonQuote: function (shopId, checkoutType, quantity) {
                return http.get(core.withQuery(staffPaths.billingAddonQuote(shopId), {
                    checkoutType: checkoutType,
                    quantity: quantity
                }));
            },
            createBillingPortalSession: function (shopId) {
                return http.post(staffPaths.billingPortalSession(shopId), {});
            },
            getToppingGroupsByShop: function (shopId) {
                return http.get(staffPaths.toppingGroups(shopId));
            },
            createToppingGroup: function (shopId, payload) {
                return http.post(staffPaths.createToppingGroup(shopId), payload);
            },
            updateToppingGroup: function (groupId, payload) {
                return http.request(staffPaths.updateToppingGroup(groupId), {
                    method: 'PUT',
                    body: JSON.stringify(payload || {})
                });
            },
            deleteToppingGroup: function (groupId) {
                return http.delete(staffPaths.deleteToppingGroup(groupId));
            },
            createTopping: function (groupId, payload) {
                return http.post(staffPaths.createTopping(groupId), payload);
            },
            updateTopping: function (toppingId, payload) {
                return http.request(staffPaths.updateTopping(toppingId), {
                    method: 'PUT',
                    body: JSON.stringify(payload || {})
                });
            },
            deleteTopping: function (toppingId) {
                return http.delete(staffPaths.deleteTopping(toppingId));
            },
            updateToppingInventory: function (toppingId, payload) {
                return http.request(staffPaths.toppingInventory(toppingId), {
                    method: 'PUT',
                    body: JSON.stringify(payload || {})
                });
            },
            getShopInventorySummary: function (shopId) {
                return http.get(staffPaths.shopInventory(shopId));
            },
            staffManualInventoryUpdate: function (menuId, payload) {
                return http.post(staffPaths.staffManualInventoryUpdate(menuId), payload || {});
            },
            resetInventoryToInitial: function (shopId, menuIds) {
                return http.post(staffPaths.resetInventoryToInitial(shopId), {
                    menuIds: Array.isArray(menuIds) ? menuIds : []
                });
            },
            getShopMenuCategories: function (shopId) {
                return http.get(staffPaths.menuCategories(shopId));
            },
            createMenuCategory: function (shopId, payload) {
                return http.post(staffPaths.createMenuCategory(shopId), payload || {});
            },
            updateMenuCategory: function (categoryId, payload) {
                return http.request(staffPaths.updateMenuCategory(categoryId), {
                    method: 'PUT',
                    body: JSON.stringify(payload || {})
                });
            },
            deleteMenuCategory: function (categoryId, shopId) {
                return http.delete(core.withQuery(staffPaths.deleteMenuCategory(categoryId), { shopId: shopId }));
            },
            getRecommendMenus: function (shopId) {
                return http.get(staffPaths.recommendMenus(shopId))
                    .then(core.normalizeRecommendMenusResponse);
            },
            replaceRecommendMenus: function (shopId, items) {
                return http.request(staffPaths.updateRecommendMenus(shopId), {
                    method: 'PUT',
                    body: JSON.stringify({ items: items || [] })
                });
            },
            uploadRecommendMenuBanner: function (shopId, menuId, file) {
                var form = new FormData();
                form.append('file', file);
                return http.request(staffPaths.recommendMenuBanner(shopId, menuId), {
                    method: 'POST',
                    body: form
                });
            },
            removeRecommendMenuBanner: function (shopId, menuId) {
                return http.delete(staffPaths.deleteRecommendMenuBanner(shopId, menuId));
            }
        };
    }

    /** @deprecated createStaffSdk を使用 */
    function createClientSdk(options) {
        return createStaffSdk(options);
    }

    /**
     * 未提供注文一覧の取得（デバウンス・差分検知付き）。
     * @param {{ staffSdk?: object, clientSdk?: object, getShopId: function(): string|null }} options
     */
    function createPendingOrdersLoader(options) {
        var staffSdk = options.staffSdk || options.clientSdk;
        var getShopId = options.getShopId;
        var debounceMs = options.debounceMs != null ? options.debounceMs : 500;
        var lastSignature = '';
        var debounceTimer = null;
        var inFlight = false;
        var pendingReloadOpts = null;

        function load(loadOpts) {
            var opts = loadOpts || {};
            var shopId = typeof getShopId === 'function' ? getShopId() : null;
            if (!shopId || !staffSdk) {
                return Promise.resolve(null);
            }
            if (inFlight) {
                pendingReloadOpts = opts;
                return Promise.resolve(null);
            }
            if (options.onBeforeLoad) {
                var proceed = options.onBeforeLoad(opts);
                if (proceed === false) {
                    return Promise.resolve(null);
                }
            }
            inFlight = true;
            return staffSdk.getPendingOrders(shopId)
                .then(function (orders) {
                    var list = Array.isArray(orders) ? orders : [];
                    var signature = core.buildPendingOrdersSignature(list);
                    if (lastSignature && signature && signature !== lastSignature && options.onNewOrders) {
                        options.onNewOrders(list);
                    }
                    if (opts.silent && !opts.forceRender && signature && signature === lastSignature) {
                        return list;
                    }
                    lastSignature = signature;
                    if (options.onOrders) {
                        options.onOrders(list, opts);
                    }
                    return list;
                })
                .catch(function (err) {
                    if (options.onError) {
                        return options.onError(err, opts);
                    }
                    throw err;
                })
                .finally(function () {
                    inFlight = false;
                    if (pendingReloadOpts) {
                        var queued = pendingReloadOpts;
                        pendingReloadOpts = null;
                        load(queued);
                    }
                });
        }

        function scheduleLoad(loadOpts) {
            var opts = loadOpts || {};
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }
            var delay = opts.immediate ? 0 : debounceMs;
            debounceTimer = setTimeout(function () {
                debounceTimer = null;
                load(opts);
            }, delay);
        }

        return {
            load: load,
            scheduleLoad: scheduleLoad,
            resetSignature: function () {
                lastSignature = '';
            },
            getLastSignature: function () {
                return lastSignature;
            }
        };
    }

    /**
     * SSE 店舗リアルタイムイベントのディスパッチ（注文・セッション差分更新）。
     */
    function createShopRealtimeHandler(options) {
        var getShopId = options.getShopId;
        var pendingLoader = options.pendingLoader;
        var TYPE = core.SHOP_REALTIME_TYPE;

        return function handleShopRealtimeEvent(rawEvent) {
            var shopId = typeof getShopId === 'function' ? getShopId() : null;
            if (!shopId) {
                if (options.onRefreshAll) {
                    return Promise.resolve(options.onRefreshAll());
                }
                return Promise.resolve();
            }
            var ev = core.parseShopRealtimeEvent(rawEvent, shopId);
            switch (ev.type) {
                case TYPE.REFRESH_ALL:
                    if (pendingLoader) {
                        pendingLoader.scheduleLoad({ silent: true, immediate: true, forceRender: true });
                    }
                    if (options.onRefreshAll) {
                        return Promise.resolve(options.onRefreshAll());
                    }
                    return Promise.resolve();
                case TYPE.ORDER_UPDATED:
                    if (pendingLoader) {
                        pendingLoader.scheduleLoad({ silent: true, immediate: true, forceRender: true });
                    }
                    if (options.onOrderUpdated) {
                        return Promise.resolve(options.onOrderUpdated(ev));
                    }
                    if (ev.sessionId && options.isSessionDetailOpenFor
                        && options.isSessionDetailOpenFor(ev.sessionId)
                        && options.onSessionDetailRefresh) {
                        return Promise.resolve(
                            options.onSessionDetailRefresh(ev.sessionId, { includeOrders: true }));
                    }
                    return Promise.resolve();
                case TYPE.SESSION_OPENED:
                case TYPE.SESSION_UPDATED:
                    if (options.onSessionOpenedOrUpdated) {
                        return Promise.resolve(options.onSessionOpenedOrUpdated(ev));
                    }
                    return Promise.resolve();
                case TYPE.SESSION_CLOSED:
                    if (pendingLoader) {
                        pendingLoader.scheduleLoad({ silent: true, immediate: true, forceRender: true });
                    }
                    if (options.onSessionClosed) {
                        return Promise.resolve(options.onSessionClosed(ev));
                    }
                    return Promise.resolve();
                default:
                    if (options.onRefreshAll) {
                        return Promise.resolve(options.onRefreshAll());
                    }
                    return Promise.resolve();
            }
        };
    }

    /**
     * 固定QR（Firestore 直読）向け: SSE 後にセッション合計を API から差分更新。
     * @param {{ staffSdk?: object, clientSdk?: object, sessionCache: object, getShopId: function(), isFirestoreDirectReadActive: function(): boolean, usesTableSeatGrid: function(): boolean, onSessionsChanged?: function(Array, object|null), onRefreshError?: function() }} options
     */
    function createKiteiFirestoreRealtimeHooks(options) {
        var staffSdk = options.staffSdk || options.clientSdk;
        var sessionCache = options.sessionCache;
        var getShopId = options.getShopId;
        var isActive = options.isFirestoreDirectReadActive;
        var usesGrid = options.usesTableSeatGrid;
        var enrichInflight = null;

        function shouldRefreshGrid() {
            return !!(sessionCache && staffSdk
                && typeof usesGrid === 'function' && usesGrid());
        }

        function shouldRefresh(sessionId) {
            return !!(sessionId && shouldRefreshGrid());
        }

        function notifySessionsChanged(sessions, row, touched) {
            emitStaffSessionUpdated({
                sessions: sessions,
                row: row || null,
                touched: touched || (row ? [row] : [])
            });
            if (typeof options.onSessionsChanged === 'function') {
                options.onSessionsChanged(sessions, row || null);
            }
            if (typeof options.onAfterSessionsChanged === 'function') {
                options.onAfterSessionsChanged(sessions, row || null);
            }
        }

        function enrichSessionsFromApi(options) {
            options = options || {};
            if (!shouldRefreshGrid()) {
                return Promise.resolve([]);
            }
            var shopId = typeof getShopId === 'function' ? getShopId() : null;
            if (!shopId) {
                return Promise.resolve([]);
            }
            if (enrichInflight && options.force !== true) {
                return enrichInflight;
            }
            enrichInflight = staffSdk.getActiveSessions(shopId, { includeTotals: true })
                .then(function (apiList) {
                    var list = Array.isArray(apiList) ? apiList : [];
                    if (!sessionCache.getSessions().length && list.length
                        && typeof sessionCache.setSessions === 'function') {
                        sessionCache.setSessions(list, { updateSignature: true });
                        notifySessionsChanged(list, null, list);
                        return list;
                    }
                    var touched = sessionCache.enrichSessionsFromApiList
                        ? sessionCache.enrichSessionsFromApiList(list)
                        : (sessionCache.patchTotalsFromList
                            ? sessionCache.patchTotalsFromList(list)
                            : []);
                    var sessions = sessionCache.getSessions();
                    notifySessionsChanged(sessions, null, touched);
                    return touched;
                })
                .catch(function () {
                    handleRefreshError();
                    return [];
                })
                .finally(function () {
                    enrichInflight = null;
                });
            return enrichInflight;
        }

        function refreshAllSessionTotals() {
            return enrichSessionsFromApi({ force: true });
        }

        function maybeBootstrapSessionTotals() {
            return enrichSessionsFromApi();
        }

        function resetTotalsBootstrap() {
            enrichInflight = null;
        }

        function refreshSessionCard(sessionId) {
            if (!shouldRefresh(sessionId)) {
                return Promise.resolve(null);
            }
            var shopId = typeof getShopId === 'function' ? getShopId() : null;
            return sessionCache.refreshSessionFromApi(staffSdk, sessionId, shopId)
                .then(function (row) {
                    if (row) {
                        notifySessionsChanged(sessionCache.getSessions(), row, [row]);
                    }
                    return row;
                });
        }

        function handleRefreshError() {
            if (typeof options.onRefreshError === 'function') {
                options.onRefreshError();
            }
        }

        return {
            refreshSessionCard: refreshSessionCard,
            refreshAllSessionTotals: refreshAllSessionTotals,
            maybeBootstrapSessionTotals: maybeBootstrapSessionTotals,
            resetTotalsBootstrap: resetTotalsBootstrap,
            handleRefreshError: handleRefreshError
        };
    }

    /**
     * 未提供注文ローダー + SSE リアルタイムハンドラをまとめて生成。
     * @param {{ staffSdk?: object, clientSdk?: object, getShopId: function(), pendingOrders?: object, realtime?: object }} options
     */
    function createStaffRealtimeRuntime(options) {
        var pendingLoader = createPendingOrdersLoader(Object.assign({}, options.pendingOrders || {}, {
            staffSdk: options.staffSdk || options.clientSdk,
            clientSdk: options.clientSdk || options.staffSdk,
            getShopId: options.getShopId
        }));
        var shopHandler = createShopRealtimeHandler(Object.assign({}, options.realtime || {}, {
            getShopId: options.getShopId,
            pendingLoader: pendingLoader
        }));
        return {
            pendingOrdersLoader: pendingLoader,
            shopRealtimeHandler: shopHandler
        };
    }

    var staffApi = {
        VERSION: SDK_VERSION,
        STAFF_SESSION_UPDATED_EVENT: STAFF_SESSION_UPDATED_EVENT,
        emitStaffSessionUpdated: emitStaffSessionUpdated,
        createStaffSdk: createStaffSdk,
        createClientSdk: createClientSdk,
        createPendingOrdersLoader: createPendingOrdersLoader,
        createShopRealtimeHandler: createShopRealtimeHandler,
        createKiteiFirestoreRealtimeHooks: createKiteiFirestoreRealtimeHooks,
        createStaffRealtimeRuntime: createStaffRealtimeRuntime,
        buildProfileFullName: core.buildProfileFullName,
        resolveDisplayFamilyName: core.resolveDisplayFamilyName,
        normalizeUserProfile: core.normalizeUserProfile
    };

    global.MasterOrderStaffSdk = staffApi;
    global.MasterOrderClientSdk = staffApi;
})(typeof window !== 'undefined' ? window : globalThis);
