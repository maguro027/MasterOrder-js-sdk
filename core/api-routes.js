/**
 * MasterOrder HTTP API ルート定義（正本）。
 *
 * ## アーキテクチャ
 * - 来客メニュー read（order-bundle / menus/search / topping catalog）は **Gate Worker**（`window._gatePublicBase`）。
 * - セッション・注文 POST は **Server API**（`window._serverBase`）。
 * - Firestore / D1 / KV への直接接続は **Server プロセスだけ**（リスナー・暖機・永続化）。
 * - 各 Server ノードは SSE 購読店舗について in-memory キャッシュ（アクティブセッション等）を持ち、
 *   GET /sessions/active 等は可能な限りキャッシュを返す（Firestore 全件 GET を避ける）。
 * - Cloudflare Tunnel / ロードバランサで「店舗 → 特定ノード」に寄せるか、単一ノード運用を想定。
 *
 * Firebase JS SDK: Client は **Auth**（+ Phase 2 以降スタッフは Firestore read のみ）。
 * Order: Phase 3 で scoped Custom Token + Firestore read（フラグ OFF 既定）。
 */
(function (global) {
    'use strict';

  /**
   * @typedef {Object} ApiRouteEntry
   * @property {string} method HTTP メソッド
   * @property {string} path パステンプレート（:param はプレースホルダ）
   * @property {'staff'|'guest'|'public'|'realtime'} audience
   * @property {string} [note]
   */

    var API_ROUTES = {
        policy: {
            browserMustNotUse: ['firestore.googleapis.com', 'firebaseio.com'],
            dataPlane: 'MasterOrder Server (node) REST + SSE only',
            firestoreAccess: 'server-internal only'
        },

        staff: {
            myShops: { method: 'GET', path: '/shops/my-shop', audience: 'staff' },
            createShop: { method: 'POST', path: '/shops', audience: 'staff' },
            myProfile: { method: 'GET', path: '/auth/me/profile', audience: 'staff' },
            updateMyProfile: { method: 'PATCH', path: '/auth/me/profile', audience: 'staff' },
            setMyPublicId: { method: 'PATCH', path: '/auth/me/public-id', audience: 'staff' },
            shopDashboard: { method: 'GET', path: '/shops/:shopId/dashboard', audience: 'staff', note: 'period クエリ' },
            orderPageTemplates: { method: 'GET', path: '/shops/order-page-templates', audience: 'staff' },
            updateOrderPageTemplate: { method: 'PATCH', path: '/shops/:shopId/order-page-template', audience: 'staff' },
            updateSessionMode: { method: 'PATCH', path: '/shops/:shopId/session-mode', audience: 'staff' },
            updateMaxActiveSessions: {
                method: 'PATCH',
                path: '/shops/:shopId/max-active-sessions',
                audience: 'staff'
            },
            updateTargetSales: {
                method: 'PATCH',
                path: '/shops/:shopId/target-sales',
                audience: 'staff'
            },
            shopTables: { method: 'GET', path: '/shops/:shopId/tables', audience: 'staff', note: 'KITEI_QR 卓一覧' },
            ensureTablePassphrases: {
                method: 'POST',
                path: '/shops/:shopId/tables/passphrases/ensure',
                audience: 'staff'
            },
            refreshTablePassphrase: {
                method: 'POST',
                path: '/shops/:shopId/tables/:tableNo/passphrase/refresh',
                audience: 'staff'
            },
            fixedQrDisplay: {
                method: 'GET',
                path: '/shops/:shopId/tables/:tableNo/fixed-qr-display',
                audience: 'staff'
            },
            activeSessions: { method: 'GET', path: '/sessions/active', audience: 'staff', note: 'shopId, includeTotals' },
            createSession: { method: 'POST', path: '/sessions/create/:shopId', audience: 'staff' },
            checkoutSession: { method: 'POST', path: '/sessions/:sessionId/checkout', audience: 'staff' },
            sessionDetail: { method: 'GET', path: '/sessions/:sessionId', audience: 'staff', note: 'includeOrders' },
            sessionMemo: { method: 'PATCH', path: '/sessions/:sessionId/memo', audience: 'staff' },
            archiveSessions: { method: 'GET', path: '/sessions/archive', audience: 'staff' },
            archiveSessionDetail: { method: 'GET', path: '/sessions/archive/:sessionId', audience: 'staff' },
            pendingOrders: { method: 'GET', path: '/orders/pending', audience: 'staff', note: 'shopId' },
            markOrderServed: { method: 'POST', path: '/orders/:orderId/served', audience: 'staff' },
            serveOrderLine: { method: 'POST', path: '/orders/:orderId/serve-line', audience: 'staff' },
            orderEventsTicket: { method: 'POST', path: '/orders/events/ticket', audience: 'staff', note: 'shopId → SSE チケット' },
            orderEventsSse: { method: 'GET', path: '/orders/events', audience: 'realtime', note: 'sseTicket クエリ' },
            permissionsMe: { method: 'GET', path: '/auth/shops/:shopId/permissions/me', audience: 'staff' },
            members: { method: 'GET', path: '/auth/shops/:shopId/members', audience: 'staff' },
            inviteMember: { method: 'POST', path: '/auth/shops/:shopId/members/invite', audience: 'staff' },
            acceptInvitation: { method: 'POST', path: '/auth/shops/:shopId/members/accept', audience: 'staff' },
            rejectInvitation: { method: 'POST', path: '/auth/shops/:shopId/members/reject', audience: 'staff' },
            myInvitations: { method: 'GET', path: '/auth/me/invitations', audience: 'staff' },
            myNotifications: { method: 'GET', path: '/auth/me/notifications', audience: 'staff' },
            dismissNotification: { method: 'POST', path: '/auth/me/notifications/:notificationId/dismiss', audience: 'staff' },
            updateMemberRole: { method: 'PUT', path: '/auth/shop-roles/:shopId/users/:publicId', audience: 'staff' },
            removeMember: { method: 'DELETE', path: '/auth/shops/:shopId/members/:publicId', audience: 'staff' },
            syncFirebaseClaims: { method: 'POST', path: '/auth/firebase/claims/sync', audience: 'staff' },
            manageMenus: { method: 'GET', path: '/menus/manage/shop/:shopId', audience: 'staff' },
            manageMenuLimits: { method: 'GET', path: '/menus/manage/shop/:shopId/limits', audience: 'staff' },
            createMenu: { method: 'POST', path: '/shops/:shopId/menus', audience: 'staff' },
            updateMenu: { method: 'PUT', path: '/menus/:menuId', audience: 'staff' },
            uploadMenuImage: { method: 'POST', path: '/menus/:menuId/image', audience: 'staff' },
            deleteMenu: { method: 'DELETE', path: '/menus/:menuId', audience: 'staff' },
            toppingGroups: { method: 'GET', path: '/topping-groups/shops/:shopId', audience: 'staff' },
            createToppingGroup: { method: 'POST', path: '/topping-groups/shops/:shopId', audience: 'staff' },
            updateToppingGroup: { method: 'PUT', path: '/topping-groups/:groupId', audience: 'staff' },
            deleteToppingGroup: { method: 'DELETE', path: '/topping-groups/:groupId', audience: 'staff' },
            createTopping: { method: 'POST', path: '/topping-groups/:groupId/toppings', audience: 'staff' },
            updateTopping: { method: 'PUT', path: '/topping-groups/toppings/:toppingId', audience: 'staff' },
            deleteTopping: { method: 'DELETE', path: '/topping-groups/toppings/:toppingId', audience: 'staff' },
            toppingInventory: { method: 'PUT', path: '/topping-groups/toppings/:toppingId/inventory', audience: 'staff' },
            shopInventory: { method: 'GET', path: '/inventory/shops/:shopId', audience: 'staff' },
            staffManualInventoryUpdate: {
                method: 'POST',
                path: '/inventory/menus/:menuId/inventory/staff-update',
                audience: 'staff'
            },
            resetInventoryToInitial: {
                method: 'POST',
                path: '/inventory/shops/:shopId/inventory/reset-to-initial',
                audience: 'staff'
            },
            menuCategories: { method: 'GET', path: '/menu-categories/shops/:shopId', audience: 'staff' },
            createMenuCategory: { method: 'POST', path: '/menu-categories/shops/:shopId', audience: 'staff' },
            updateMenuCategory: { method: 'PUT', path: '/menu-categories/:categoryId', audience: 'staff' },
            deleteMenuCategory: { method: 'DELETE', path: '/menu-categories/:categoryId', audience: 'staff', note: 'shopId' },
            recommendMenus: { method: 'GET', path: '/shops/:shopId/recommend-menus', audience: 'staff' },
            updateRecommendMenus: { method: 'PUT', path: '/shops/:shopId/recommend-menus', audience: 'staff' },
            recommendMenuBanner: { method: 'POST', path: '/shops/:shopId/recommend-menus/:menuId/banner', audience: 'staff' },
            deleteRecommendMenuBanner: { method: 'DELETE', path: '/shops/:shopId/recommend-menus/:menuId/banner', audience: 'staff' },
            catalogUnpublished: { method: 'GET', path: '/shops/:shopId/catalog/unpublished', audience: 'staff' },
            publishCatalog: { method: 'POST', path: '/shops/:shopId/catalog/publish', audience: 'staff' },
            shopSubscribe: { method: 'GET', path: '/shops/:shopId/subscribe', audience: 'staff' },
            billingCheckoutSession: {
                method: 'POST',
                path: '/shops/:shopId/billing/checkout-session',
                audience: 'staff'
            },
            billingAddonQuote: {
                method: 'GET',
                path: '/shops/:shopId/billing/addon-quote',
                audience: 'staff',
                note: 'checkoutType, quantity'
            },
            billingPortalSession: {
                method: 'POST',
                path: '/shops/:shopId/billing/portal-session',
                audience: 'staff'
            }
        },

        auth: {
            myProfile: { method: 'GET', path: '/auth/me/profile', audience: 'staff', note: 'Staff / 将来 Order（Firebase 認証）' },
            updateMyProfile: { method: 'PATCH', path: '/auth/me/profile', audience: 'staff' },
            setMyPublicId: { method: 'PATCH', path: '/auth/me/public-id', audience: 'staff' }
        },

        guest: {
            shopBySlug: { method: 'GET', path: '/shops/public/by-slug/:slug', audience: 'public', note: 'Order 入口（apiBaseUrl）' },
            connectSession: { method: 'GET', path: '/sessions/connect/:sessionId', audience: 'guest', note: 'X-Session-PIN' },
            connectOrders: { method: 'GET', path: '/sessions/connect/:sessionId/orders', audience: 'guest', note: '履歴のみ' },
            joinSession: { method: 'GET', path: '/sessions/join/:joinToken', audience: 'guest' },
            openFixedQrSession: { method: 'POST', path: '/sessions/fixed-qr/open', audience: 'guest' },
            submitOrder: { method: 'POST', path: '/sessions/order/:sessionId', audience: 'guest', note: 'Idempotency-Key, Client-Id' },
            menuSearch: { method: 'GET', path: '/menus/search', audience: 'guest' },
            toppingGroupsForMenu: { method: 'GET', path: '/topping-groups/menus/:menuId', audience: 'guest' },
            orderToppingCatalog: { method: 'GET', path: '/topping-groups/shops/:shopId/order-catalog', audience: 'guest' },
            orderBundle: { method: 'GET', path: '/guest/shops/:shopId/order-bundle', audience: 'guest' },
            recommendMenus: { method: 'GET', path: '/shops/:shopId/recommend-menus', audience: 'guest' }
        },

        gateGuest: {
            menuSearch: { method: 'GET', path: '/v1/guest/menus/search', audience: 'guest', note: 'Gate Worker KV catalog read' },
            toppingGroupsForMenu: { method: 'GET', path: '/v1/guest/topping-groups/menus/:menuId', audience: 'guest' },
            orderToppingCatalog: { method: 'GET', path: '/v1/guest/topping-groups/shops/:shopId/order-catalog', audience: 'guest' },
            orderBundle: { method: 'GET', path: '/v1/guest/shops/:shopId/order-bundle', audience: 'guest' }
        }
    };

    function enc(value) {
        return encodeURIComponent(String(value));
    }

    /** パスビルダー（SDK 実装で使用） */
    var paths = {
        staff: {
            myShops: function () { return '/shops/my-shop'; },
            createShop: function () { return '/shops'; },
            myProfile: function () { return '/auth/me/profile'; },
            updateMyProfile: function () { return '/auth/me/profile'; },
            setMyPublicId: function () { return '/auth/me/public-id'; },
            myAccountStatus: function () { return '/auth/me/account-status'; },
            passwordResetCompleted: function () { return '/auth/password-reset-completed'; },
            shopDashboard: function (shopId) { return '/shops/' + enc(shopId) + '/dashboard'; },
            orderPageTemplates: function () { return '/shops/order-page-templates'; },
            updateOrderPageTemplate: function (shopId) { return '/shops/' + enc(shopId) + '/order-page-template'; },
            updateSessionMode: function (shopId) { return '/shops/' + enc(shopId) + '/session-mode'; },
            updateMaxActiveSessions: function (shopId) {
                return '/shops/' + enc(shopId) + '/max-active-sessions';
            },
            updateTargetSales: function (shopId) {
                return '/shops/' + enc(shopId) + '/target-sales';
            },
            shopTables: function (shopId) { return '/shops/' + enc(shopId) + '/tables'; },
            ensureTablePassphrases: function (shopId) {
                return '/shops/' + enc(shopId) + '/tables/passphrases/ensure';
            },
            refreshTablePassphrase: function (shopId, tableNo) {
                return '/shops/' + enc(shopId) + '/tables/' + enc(tableNo) + '/passphrase/refresh';
            },
            fixedQrDisplay: function (shopId, tableNo) {
                return '/shops/' + enc(shopId) + '/tables/' + enc(tableNo) + '/fixed-qr-display';
            },
            activeSessions: function () { return '/sessions/active'; },
            createSession: function (shopId) { return '/sessions/create/' + enc(shopId); },
            checkoutSession: function (sessionId) { return '/sessions/' + enc(sessionId) + '/checkout'; },
            sessionDetail: function (sessionId) { return '/sessions/' + enc(sessionId); },
            sessionMemo: function (sessionId) { return '/sessions/' + enc(sessionId) + '/memo'; },
            archiveSessions: function () { return '/sessions/archive'; },
            archiveSessionDetail: function (sessionId) { return '/sessions/archive/' + enc(sessionId); },
            pendingOrders: function () { return '/orders/pending'; },
            markOrderServed: function (orderId) { return '/orders/' + enc(orderId) + '/served'; },
            serveOrderLine: function (orderId) { return '/orders/' + enc(orderId) + '/serve-line'; },
            orderEventsTicket: function () { return '/orders/events/ticket'; },
            orderEventsSse: function () { return '/orders/events'; },
            permissionsMe: function (shopId) { return '/auth/shops/' + enc(shopId) + '/permissions/me'; },
            members: function (shopId) { return '/auth/shops/' + enc(shopId) + '/members'; },
            inviteMember: function (shopId) { return '/auth/shops/' + enc(shopId) + '/members/invite'; },
            acceptInvitation: function (shopId) {
                return '/auth/shops/' + enc(shopId) + '/members/accept';
            },
            rejectInvitation: function (shopId) {
                return '/auth/shops/' + enc(shopId) + '/members/reject';
            },
            myInvitations: function () { return '/auth/me/invitations'; },
            myNotifications: function () { return '/auth/me/notifications'; },
            dismissNotification: function (notificationId) {
                return '/auth/me/notifications/' + enc(notificationId) + '/dismiss';
            },
            updateMemberRole: function (shopId, publicId) {
                return '/auth/shop-roles/' + enc(shopId) + '/users/' + enc(publicId);
            },
            removeMember: function (shopId, publicId) {
                return '/auth/shops/' + enc(shopId) + '/members/' + enc(publicId);
            },
            syncFirebaseClaims: function () { return '/auth/firebase/claims/sync'; },
            manageMenus: function (shopId) { return '/menus/manage/shop/' + enc(shopId); },
            manageMenuLimits: function (shopId) { return '/menus/manage/shop/' + enc(shopId) + '/limits'; },
            createMenu: function (shopId) { return '/shops/' + enc(shopId) + '/menus'; },
            updateMenu: function (menuId) { return '/menus/' + enc(menuId); },
            uploadMenuImage: function (menuId) { return '/menus/' + enc(menuId) + '/image'; },
            deleteMenu: function (menuId) { return '/menus/' + enc(menuId); },
            toppingGroups: function (shopId) { return '/topping-groups/shops/' + enc(shopId); },
            createToppingGroup: function (shopId) { return '/topping-groups/shops/' + enc(shopId); },
            updateToppingGroup: function (groupId) { return '/topping-groups/' + enc(groupId); },
            deleteToppingGroup: function (groupId) { return '/topping-groups/' + enc(groupId); },
            createTopping: function (groupId) { return '/topping-groups/' + enc(groupId) + '/toppings'; },
            updateTopping: function (toppingId) { return '/topping-groups/toppings/' + enc(toppingId); },
            deleteTopping: function (toppingId) { return '/topping-groups/toppings/' + enc(toppingId); },
            toppingInventory: function (toppingId) {
                return '/topping-groups/toppings/' + enc(toppingId) + '/inventory';
            },
            shopInventory: function (shopId) { return '/inventory/shops/' + enc(shopId); },
            staffManualInventoryUpdate: function (menuId) {
                return '/inventory/menus/' + enc(menuId) + '/inventory/staff-update';
            },
            resetInventoryToInitial: function (shopId) {
                return '/inventory/shops/' + enc(shopId) + '/inventory/reset-to-initial';
            },
            menuCategories: function (shopId) { return '/menu-categories/shops/' + enc(shopId); },
            createMenuCategory: function (shopId) { return '/menu-categories/shops/' + enc(shopId); },
            updateMenuCategory: function (categoryId) { return '/menu-categories/' + enc(categoryId); },
            deleteMenuCategory: function (categoryId) { return '/menu-categories/' + enc(categoryId); },
            recommendMenus: function (shopId) { return '/shops/' + enc(shopId) + '/recommend-menus'; },
            updateRecommendMenus: function (shopId) { return '/shops/' + enc(shopId) + '/recommend-menus'; },
            recommendMenuBanner: function (shopId, menuId) {
                return '/shops/' + enc(shopId) + '/recommend-menus/' + enc(menuId) + '/banner';
            },
            deleteRecommendMenuBanner: function (shopId, menuId) {
                return '/shops/' + enc(shopId) + '/recommend-menus/' + enc(menuId) + '/banner';
            },
            catalogUnpublished: function (shopId) {
                return '/shops/' + enc(shopId) + '/catalog/unpublished';
            },
            publishCatalog: function (shopId, target) {
                var query = target ? '?target=' + enc(target) : '';
                return '/shops/' + enc(shopId) + '/catalog/publish' + query;
            },
            shopSubscribe: function (shopId) {
                return '/shops/' + enc(shopId) + '/subscribe';
            },
            billingCheckoutSession: function (shopId) {
                return '/shops/' + enc(shopId) + '/billing/checkout-session';
            },
            billingAddonQuote: function (shopId) {
                return '/shops/' + enc(shopId) + '/billing/addon-quote';
            },
            billingPortalSession: function (shopId) {
                return '/shops/' + enc(shopId) + '/billing/portal-session';
            }
        },
        auth: {
            myProfile: function () { return '/auth/me/profile'; },
            updateMyProfile: function () { return '/auth/me/profile'; },
            setMyPublicId: function () { return '/auth/me/public-id'; }
        },
        guest: {
            shopBySlug: function (slug) { return '/shops/public/by-slug/' + enc(slug); },
            connectSession: function (sessionId) { return '/sessions/connect/' + enc(sessionId); },
            connectOrders: function (sessionId) { return '/sessions/connect/' + enc(sessionId) + '/orders'; },
            joinSession: function (joinToken) { return '/sessions/join/' + enc(joinToken); },
            openFixedQrSession: function () { return '/sessions/fixed-qr/open'; },
            submitOrder: function (sessionId) { return '/sessions/order/' + enc(sessionId); },
            menuSearch: function () { return '/menus/search'; },
            toppingGroupsForMenu: function (menuId) { return '/topping-groups/menus/' + enc(menuId); },
            orderToppingCatalog: function (shopId) { return '/topping-groups/shops/' + enc(shopId) + '/order-catalog'; },
            orderBundle: function (shopId) { return '/guest/shops/' + enc(shopId) + '/order-bundle'; },
            recommendMenus: function (shopId) { return '/shops/' + enc(shopId) + '/recommend-menus'; }
        },
        gateGuest: {
            menuSearch: function () { return '/v1/guest/menus/search'; },
            toppingGroupsForMenu: function (menuId) { return '/v1/guest/topping-groups/menus/' + enc(menuId); },
            orderToppingCatalog: function (shopId) { return '/v1/guest/topping-groups/shops/' + enc(shopId) + '/order-catalog'; },
            orderBundle: function (shopId) { return '/v1/guest/shops/' + enc(shopId) + '/order-bundle'; }
        }
    };

    /**
     * apiBaseUrl がノード Server を指しているか検証（Firestore 直結禁止）。
     * @param {string} baseUrl
     * @returns {string} normalized baseUrl
     */
    function assertNodeApiBaseUrl(baseUrl) {
        var s = String(baseUrl || '').trim();
        if (!s) {
            throw new Error('MasterOrder API base URL is required (node Server only; do not use Firestore endpoints).');
        }
        var lower = s.toLowerCase();
        var blocked = API_ROUTES.policy.browserMustNotUse;
        for (var i = 0; i < blocked.length; i++) {
            if (lower.indexOf(blocked[i]) !== -1) {
                throw new Error(
                    'MasterOrder SDK: browsers must not call Firestore/Firebase data URLs. Use the MasterOrder Server API base URL.');
            }
        }
        return s;
    }

    global.MasterOrderApiRoutes = {
        API_ROUTES: API_ROUTES,
        paths: paths,
        assertNodeApiBaseUrl: assertNodeApiBaseUrl
    };
})(typeof window !== 'undefined' ? window : global);
