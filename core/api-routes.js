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
            shopDashboard: { method: 'GET', path: '/shops/:shopId/dashboard', audience: 'staff', note: 'period / month / from / to（YYYY-MM-DD または YYYY-MM）' },
            shopDashboardMonths: { method: 'GET', path: '/shops/:shopId/dashboard/months', audience: 'staff' },
            shopCashDelta: {
                method: 'GET',
                path: '/shops/:shopId/cash-delta',
                audience: 'staff',
                note: 'day または from/to（YYYY-MM-DD）。MANAGER+'
            },
            orderPageTemplates: { method: 'GET', path: '/shops/order-page-templates', audience: 'staff' },
            updateOrderPageTemplate: { method: 'PATCH', path: '/shops/:shopId/order-page-template', audience: 'staff' },
            updateSessionMode: { method: 'PATCH', path: '/shops/:shopId/session-mode', audience: 'staff' },
            inventoryResetSchedule: {
                method: 'GET',
                path: '/shops/:shopId/inventory-reset-schedule',
                audience: 'staff'
            },
            updateInventoryResetSchedule: {
                method: 'PATCH',
                path: '/shops/:shopId/inventory-reset-schedule',
                audience: 'staff'
            },
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
            updateShopProfile: {
                method: 'PATCH',
                path: '/shops/:shopId/profile',
                audience: 'staff'
            },
            uploadShopBanner: {
                method: 'POST',
                path: '/shops/:shopId/banner',
                audience: 'staff',
                note: 'multipart file'
            },
            uploadShopLogo: {
                method: 'POST',
                path: '/shops/:shopId/logo',
                audience: 'staff',
                note: 'multipart file → R2 logo/shop/{uuid}'
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
            staffConnectFixedQr: {
                method: 'POST',
                path: '/sessions/fixed-qr/staff-connect',
                audience: 'staff',
                note: '当該店スタッフ: 固定QR → 既存セッション接続'
            },
            activeSessions: { method: 'GET', path: '/sessions/active', audience: 'staff', note: 'shopId, includeTotals' },
            createSession: { method: 'POST', path: '/sessions/create/:shopId', audience: 'staff' },
            checkoutSession: { method: 'POST', path: '/sessions/:sessionId/checkout', audience: 'staff' },
            ackStaffRequest: {
                method: 'POST',
                path: '/sessions/:sessionId/staff-request/ack',
                audience: 'staff',
                note: '来客 CALL/CHECKOUT 対応完了'
            },
            sessionDetail: { method: 'GET', path: '/sessions/:sessionId', audience: 'staff', note: 'includeOrders' },
            sessionMemo: { method: 'PATCH', path: '/sessions/:sessionId/memo', audience: 'staff' },
            sessionGuestCounts: {
                method: 'PATCH',
                path: '/sessions/:sessionId/guest-counts',
                audience: 'staff',
                note: 'male / female / unset / boys / girls + family / couple / companions。人数変更は1分3回'
            },
            archiveSessions: { method: 'GET', path: '/sessions/archive', audience: 'staff' },
            archiveSessionDetail: { method: 'GET', path: '/sessions/archive/:sessionId', audience: 'staff' },
            pendingOrders: { method: 'GET', path: '/orders/pending', audience: 'staff', note: 'shopId' },
            markOrderServed: { method: 'POST', path: '/orders/:orderId/served', audience: 'staff' },
            serveOrderLine: { method: 'POST', path: '/orders/:orderId/serve-line', audience: 'staff' },
            cancelOrderLine: { method: 'POST', path: '/orders/:orderId/cancel-line', audience: 'staff' },
            cancelOrder: { method: 'DELETE', path: '/orders/:orderId', audience: 'staff' },
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
            registerFcmToken: {
                method: 'POST',
                path: '/staff/shops/:shopId/fcm-tokens',
                audience: 'staff',
                note: 'Android FCM token register'
            },
            unregisterFcmToken: {
                method: 'DELETE',
                path: '/staff/shops/:shopId/fcm-tokens',
                audience: 'staff',
                note: 'Android FCM token unregister'
            },
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
            resetAllInventoryToInitial: {
                method: 'POST',
                path: '/inventory/shops/:shopId/inventory/reset-all-to-initial',
                audience: 'staff'
            },
            menuCategories: { method: 'GET', path: '/menu-categories/shops/:shopId', audience: 'staff' },
            promotionGroups: { method: 'GET', path: '/promotion-groups/shops/:shopId', audience: 'staff' },
            createPromotionGroup: { method: 'POST', path: '/promotion-groups/shops/:shopId', audience: 'staff' },
            updatePromotionGroup: { method: 'PUT', path: '/promotion-groups/:groupId', audience: 'staff' },
            updatePromotionGroupOffSaleLink: { method: 'PATCH', path: '/promotion-groups/:groupId/off-sale-link', audience: 'staff' },
            updatePromotionGroupBannerDisplay: { method: 'PATCH', path: '/promotion-groups/:groupId/banner-display', audience: 'staff' },
            deletePromotionGroup: { method: 'DELETE', path: '/promotion-groups/:groupId', audience: 'staff' },
            setPromotionGroupPaused: { method: 'POST', path: '/promotion-groups/:groupId/paused', audience: 'staff' },
            uploadPromotionGroupBanner: { method: 'POST', path: '/promotion-groups/:groupId/banner', audience: 'staff' },
            deletePromotionGroupBanner: { method: 'DELETE', path: '/promotion-groups/:groupId/banner', audience: 'staff' },
            createMenuCategory: { method: 'POST', path: '/menu-categories/shops/:shopId', audience: 'staff' },
            updateMenuCategory: { method: 'PUT', path: '/menu-categories/:categoryId', audience: 'staff' },
            deleteMenuCategory: { method: 'DELETE', path: '/menu-categories/:categoryId', audience: 'staff', note: 'shopId' },
            recommendMenus: { method: 'GET', path: '/shops/:shopId/recommend-menus', audience: 'staff' },
            updateRecommendMenus: { method: 'PUT', path: '/shops/:shopId/recommend-menus', audience: 'staff' },
            recommendMenuBanner: { method: 'POST', path: '/shops/:shopId/recommend-menus/:menuId/banner', audience: 'staff' },
            deleteRecommendMenuBanner: { method: 'DELETE', path: '/shops/:shopId/recommend-menus/:menuId/banner', audience: 'staff' },
            updateRecommendMenuBannerLink: {
                method: 'PATCH',
                path: '/shops/:shopId/recommend-menus/:menuId/banner-link',
                audience: 'staff'
            },
            guestTopLayout: { method: 'GET', path: '/shops/:shopId/guest-top-layout', audience: 'staff' },
            updateGuestTopLayout: { method: 'PUT', path: '/shops/:shopId/guest-top-layout', audience: 'staff' },
            uploadGuestTopTileImage: {
                method: 'POST',
                path: '/shops/:shopId/guest-top-layout/tile-image',
                audience: 'staff'
            },
            listGuestBanners: { method: 'GET', path: '/shops/:shopId/guest-banners', audience: 'staff' },
            guestBannerQuota: { method: 'GET', path: '/shops/:shopId/guest-banners/quota', audience: 'staff' },
            createGuestBanner: { method: 'POST', path: '/shops/:shopId/guest-banners', audience: 'staff' },
            createGuestBannerWithImage: {
                method: 'POST',
                path: '/shops/:shopId/guest-banners/with-image',
                audience: 'staff'
            },
            reorderGuestBanners: { method: 'POST', path: '/shops/:shopId/guest-banners/reorder', audience: 'staff' },
            updateGuestBanner: { method: 'PATCH', path: '/shops/:shopId/guest-banners/:bannerId', audience: 'staff' },
            uploadGuestBannerImage: { method: 'POST', path: '/shops/:shopId/guest-banners/:bannerId/image', audience: 'staff' },
            deleteGuestBanner: { method: 'DELETE', path: '/shops/:shopId/guest-banners/:bannerId', audience: 'staff' },
            sessionScript: { method: 'GET', path: '/shops/:shopId/session-script', audience: 'staff' },
            updateSessionScript: { method: 'PUT', path: '/shops/:shopId/session-script', audience: 'staff' },
            discountPresets: { method: 'GET', path: '/shops/:shopId/discount-presets', audience: 'staff' },
            updateDiscountPresets: { method: 'PUT', path: '/shops/:shopId/discount-presets', audience: 'staff' },
            applyDiscountPreset: {
                method: 'POST',
                path: '/orders/discount-preset',
                audience: 'staff',
                note: 'sessionId query + presetId body'
            },
            couponClaimPreview: { method: 'GET', path: '/coupons/claim/:token', audience: 'public' },
            couponClaim: { method: 'POST', path: '/coupons/claim/:token', audience: 'customer' },
            couponWallet: { method: 'GET', path: '/coupons/wallet', audience: 'customer', note: 'shopId optional' },
            couponWalletApply: {
                method: 'POST',
                path: '/coupons/wallet/apply',
                audience: 'customer',
                note: 'sessionId + holdingId query'
            },
            approveDiscountPresetRequest: {
                method: 'POST',
                path: '/shops/:shopId/discount-preset-requests/:requestId/approve',
                audience: 'staff'
            },
            denyDiscountPresetRequest: {
                method: 'POST',
                path: '/shops/:shopId/discount-preset-requests/:requestId/deny',
                audience: 'staff'
            },
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
            },
            billingCancelSubscription: {
                method: 'POST',
                path: '/shops/:shopId/billing/cancel-subscription',
                audience: 'staff'
            },
            billingPlayAcknowledge: {
                method: 'POST',
                path: '/shops/:shopId/billing/play/acknowledge',
                audience: 'staff'
            },
            defenseSettings: {
                method: 'GET',
                path: '/shops/:shopId/defense-settings',
                audience: 'staff'
            },
            updateDefenseSettings: {
                method: 'PATCH',
                path: '/shops/:shopId/defense-settings',
                audience: 'staff'
            },
            createGuestBan: {
                method: 'POST',
                path: '/shops/:shopId/guest-bans',
                audience: 'staff'
            },
            guestBanAction: {
                method: 'POST',
                path: '/shops/:shopId/guest-ban-actions',
                audience: 'staff',
                note: 'orderId + SESSION_BLOCK|SHOP_BAN — staff may request SHOP_BAN'
            },
            approveGuestBanRequest: {
                method: 'POST',
                path: '/shops/:shopId/guest-ban-requests/:requestId/approve',
                audience: 'staff'
            },
            denyGuestBanRequest: {
                method: 'POST',
                path: '/shops/:shopId/guest-ban-requests/:requestId/deny',
                audience: 'staff'
            },
            lookupGuestBan: {
                method: 'GET',
                path: '/shops/:shopId/guest-bans/lookup',
                audience: 'staff',
                note: 'banId or subjectId'
            },
            liftGuestBan: {
                method: 'DELETE',
                path: '/shops/:shopId/guest-bans/:banId',
                audience: 'staff'
            },
            clearGuestIpRisk: {
                method: 'PATCH',
                path: '/orders/:orderId/guest-ip-risk',
                audience: 'staff'
            }
        },

        auth: {
            myProfile: { method: 'GET', path: '/auth/me/profile', audience: 'staff', note: 'Staff / 将来 Order（Firebase 認証）' },
            updateMyProfile: { method: 'PATCH', path: '/auth/me/profile', audience: 'staff' },
            setMyPublicId: { method: 'PATCH', path: '/auth/me/public-id', audience: 'staff' },
            gateAssertion: { method: 'POST', path: '/auth/gate/assertion', audience: 'staff', note: 'Firebase ID token → Gate 短命アサーション' }
        },

        guest: {
            shopBySlug: { method: 'GET', path: '/shops/public/by-slug/:slug', audience: 'public', note: 'Order 入口（apiBaseUrl）' },
            connectSession: { method: 'GET', path: '/sessions/connect/:sessionId', audience: 'guest', note: 'X-Session-PIN' },
            connectOrders: { method: 'GET', path: '/sessions/connect/:sessionId/orders', audience: 'guest', note: '履歴のみ' },
            joinSession: { method: 'GET', path: '/sessions/join/:joinToken', audience: 'guest' },
            openFixedQrSession: { method: 'POST', path: '/sessions/fixed-qr/open', audience: 'guest' },
            submitOrder: { method: 'POST', path: '/sessions/order/:sessionId', audience: 'guest', note: 'Idempotency-Key, Client-Id' },
            registerGuestRoster: {
                method: 'POST',
                path: '/sessions/:sessionId/guest-roster',
                audience: 'guest',
                note: 'X-Session-PIN + X-MasterOrder-Client-Id'
            },
            confirmGuestPeoples: {
                method: 'POST',
                path: '/sessions/:sessionId/guest-peoples',
                audience: 'guest',
                note: 'X-Session-PIN — 都度QR人数確定'
            },
            staffRequest: {
                method: 'POST',
                path: '/sessions/:sessionId/staff-request',
                audience: 'guest',
                note: 'X-Session-PIN — body { type: CALL|CHECKOUT }'
            },
            menuSearch: { method: 'GET', path: '/menus/public/by-slug/:slug', audience: 'public', note: 'レガシー Node 経路（来客カタログは gateGuest のみ）' }
            // 来客カタログ read: Gate gateGuest のみ（Node order-bundle / recommend は閉鎖）。
        },

        gateGuest: {
            shopBySlug: { method: 'GET', path: '/v1/guest/shops/by-slug/:slug', audience: 'guest', note: 'Gate Worker KV slug resolve' },
            menuSearch: { method: 'GET', path: '/v1/guest/menus/search', audience: 'guest', note: 'Gate Worker KV catalog read（要 shopPublicId UUID）' },
            toppingGroupsForMenu: { method: 'GET', path: '/v1/guest/topping-groups/menus/:menuId', audience: 'guest', note: '要 shopPublicId UUID' },
            orderToppingCatalog: { method: 'GET', path: '/v1/guest/topping-groups/shops/:shopPublicId/order-catalog', audience: 'guest' },
            orderBundle: { method: 'GET', path: '/v1/guest/shops/:shopPublicId/order-bundle', audience: 'guest' },
            pricingRevision: { method: 'GET', path: '/v1/guest/shops/:shopPublicId/pricing-revision', audience: 'guest', note: '軽量 pcr プローブ' }
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
            shopDashboardMonths: function (shopId) { return '/shops/' + enc(shopId) + '/dashboard/months'; },
            shopCashDelta: function (shopId) { return '/shops/' + enc(shopId) + '/cash-delta'; },
            orderPageTemplates: function () { return '/shops/order-page-templates'; },
            updateOrderPageTemplate: function (shopId) { return '/shops/' + enc(shopId) + '/order-page-template'; },
            updateSessionMode: function (shopId) { return '/shops/' + enc(shopId) + '/session-mode'; },
            inventoryResetSchedule: function (shopId) {
                return '/shops/' + enc(shopId) + '/inventory-reset-schedule';
            },
            updateInventoryResetSchedule: function (shopId) {
                return '/shops/' + enc(shopId) + '/inventory-reset-schedule';
            },
            updateMaxActiveSessions: function (shopId) {
                return '/shops/' + enc(shopId) + '/max-active-sessions';
            },
            updateTargetSales: function (shopId) {
                return '/shops/' + enc(shopId) + '/target-sales';
            },
            updateShopProfile: function (shopId) {
                return '/shops/' + enc(shopId) + '/profile';
            },
            uploadShopBanner: function (shopId) {
                return '/shops/' + enc(shopId) + '/banner';
            },
            uploadShopLogo: function (shopId) {
                return '/shops/' + enc(shopId) + '/logo';
            },
            shopReceiptLogo: function (shopId) {
                return '/shops/' + enc(shopId) + '/receipt-logo';
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
            staffConnectFixedQr: function () { return '/sessions/fixed-qr/staff-connect'; },
            activeSessions: function () { return '/sessions/active'; },
            createSession: function (shopId) { return '/sessions/create/' + enc(shopId); },
            checkoutSession: function (sessionId) { return '/sessions/' + enc(sessionId) + '/checkout'; },
            ackStaffRequest: function (sessionId) {
                return '/sessions/' + enc(sessionId) + '/staff-request/ack';
            },
            sessionDetail: function (sessionId) { return '/sessions/' + enc(sessionId); },
            sessionMemo: function (sessionId) { return '/sessions/' + enc(sessionId) + '/memo'; },
            sessionGuestCounts: function (sessionId) { return '/sessions/' + enc(sessionId) + '/guest-counts'; },
            archiveSessions: function () { return '/sessions/archive'; },
            archiveSessionDetail: function (sessionId) { return '/sessions/archive/' + enc(sessionId); },
            pendingOrders: function () { return '/orders/pending'; },
            markOrderServed: function (orderId) { return '/orders/' + enc(orderId) + '/served'; },
            serveOrderLine: function (orderId) { return '/orders/' + enc(orderId) + '/serve-line'; },
            cancelOrderLine: function (orderId) { return '/orders/' + enc(orderId) + '/cancel-line'; },
            cancelOrder: function (orderId) { return '/orders/' + enc(orderId); },
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
            registerFcmToken: function (shopId) {
                return '/staff/shops/' + enc(shopId) + '/fcm-tokens';
            },
            unregisterFcmToken: function (shopId) {
                return '/staff/shops/' + enc(shopId) + '/fcm-tokens';
            },
            updateMemberRole: function (shopId, publicId) {
                return '/auth/shop-roles/' + enc(shopId) + '/users/' + enc(publicId);
            },
            removeMember: function (shopId, publicId) {
                return '/auth/shops/' + enc(shopId) + '/members/' + enc(publicId);
            },
            syncFirebaseClaims: function () { return '/auth/firebase/claims/sync'; },
            gateAssertion: function (ttlSeconds) {
                var q = ttlSeconds != null && ttlSeconds !== ''
                    ? '?ttlSeconds=' + enc(String(ttlSeconds))
                    : '';
                return '/auth/gate/assertion' + q;
            },
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
            resetAllInventoryToInitial: function (shopId) {
                return '/inventory/shops/' + enc(shopId) + '/inventory/reset-all-to-initial';
            },
            menuCategories: function (shopId) { return '/menu-categories/shops/' + enc(shopId); },
            promotionGroups: function (shopId) { return '/promotion-groups/shops/' + enc(shopId); },
            createPromotionGroup: function (shopId) { return '/promotion-groups/shops/' + enc(shopId); },
            updatePromotionGroup: function (groupId) { return '/promotion-groups/' + enc(groupId); },
            updatePromotionGroupOffSaleLink: function (groupId) { return '/promotion-groups/' + enc(groupId) + '/off-sale-link'; },
            updatePromotionGroupBannerDisplay: function (groupId) { return '/promotion-groups/' + enc(groupId) + '/banner-display'; },
            deletePromotionGroup: function (groupId) { return '/promotion-groups/' + enc(groupId); },
            setPromotionGroupPaused: function (groupId) { return '/promotion-groups/' + enc(groupId) + '/paused'; },
            uploadPromotionGroupBanner: function (groupId) { return '/promotion-groups/' + enc(groupId) + '/banner'; },
            deletePromotionGroupBanner: function (groupId) { return '/promotion-groups/' + enc(groupId) + '/banner'; },
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
        updateRecommendMenuBannerLink: function (shopId, menuId) {
            return '/shops/' + enc(shopId) + '/recommend-menus/' + enc(menuId) + '/banner-link';
        },
        guestTopLayout: function (shopId) { return '/shops/' + enc(shopId) + '/guest-top-layout'; },
        updateGuestTopLayout: function (shopId) { return '/shops/' + enc(shopId) + '/guest-top-layout'; },
        uploadGuestTopTileImage: function (shopId) {
            return '/shops/' + enc(shopId) + '/guest-top-layout/tile-image';
        },
        listGuestBanners: function (shopId) { return '/shops/' + enc(shopId) + '/guest-banners'; },
        guestBannerQuota: function (shopId) { return '/shops/' + enc(shopId) + '/guest-banners/quota'; },
        createGuestBanner: function (shopId) { return '/shops/' + enc(shopId) + '/guest-banners'; },
        createGuestBannerWithImage: function (shopId) {
            return '/shops/' + enc(shopId) + '/guest-banners/with-image';
        },
        reorderGuestBanners: function (shopId) {
            return '/shops/' + enc(shopId) + '/guest-banners/reorder';
        },
        updateGuestBanner: function (shopId, bannerId) {
            return '/shops/' + enc(shopId) + '/guest-banners/' + enc(bannerId);
        },
        uploadGuestBannerImage: function (shopId, bannerId) {
            return '/shops/' + enc(shopId) + '/guest-banners/' + enc(bannerId) + '/image';
        },
        deleteGuestBanner: function (shopId, bannerId) {
            return '/shops/' + enc(shopId) + '/guest-banners/' + enc(bannerId);
        },
        sessionScript: function (shopId) { return '/shops/' + enc(shopId) + '/session-script'; },
        updateSessionScript: function (shopId) { return '/shops/' + enc(shopId) + '/session-script'; },
        discountPresets: function (shopId) { return '/shops/' + enc(shopId) + '/discount-presets'; },
        updateDiscountPresets: function (shopId) { return '/shops/' + enc(shopId) + '/discount-presets'; },
        applyDiscountPreset: function () { return '/orders/discount-preset'; },
        couponClaimPreview: function (token) { return '/coupons/claim/' + enc(token); },
        couponClaim: function (token) { return '/coupons/claim/' + enc(token); },
        couponWallet: function (shopId) {
            return shopId != null ? '/coupons/wallet?shopId=' + enc(shopId) : '/coupons/wallet';
        },
        couponWalletApply: function (sessionId, holdingId) {
            return '/coupons/wallet/apply?sessionId=' + enc(sessionId) + '&holdingId=' + enc(holdingId);
        },
        approveDiscountPresetRequest: function (shopId, requestId) {
            return '/shops/' + enc(shopId) + '/discount-preset-requests/' + enc(requestId) + '/approve';
        },
        denyDiscountPresetRequest: function (shopId, requestId) {
            return '/shops/' + enc(shopId) + '/discount-preset-requests/' + enc(requestId) + '/deny';
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
            },
            billingCancelSubscription: function (shopId) {
                return '/shops/' + enc(shopId) + '/billing/cancel-subscription';
            },
            billingPlayAcknowledge: function (shopId) {
                return '/shops/' + enc(shopId) + '/billing/play/acknowledge';
            },
            defenseSettings: function (shopId) {
                return '/shops/' + enc(shopId) + '/defense-settings';
            },
            updateDefenseSettings: function (shopId) {
                return '/shops/' + enc(shopId) + '/defense-settings';
            },
            createGuestBan: function (shopId) {
                return '/shops/' + enc(shopId) + '/guest-bans';
            },
            guestBanAction: function (shopId) {
                return '/shops/' + enc(shopId) + '/guest-ban-actions';
            },
            approveGuestBanRequest: function (shopId, requestId) {
                return '/shops/' + enc(shopId) + '/guest-ban-requests/' + enc(requestId) + '/approve';
            },
            denyGuestBanRequest: function (shopId, requestId) {
                return '/shops/' + enc(shopId) + '/guest-ban-requests/' + enc(requestId) + '/deny';
            },
            lookupGuestBan: function (shopId) {
                return '/shops/' + enc(shopId) + '/guest-bans/lookup';
            },
            liftGuestBan: function (shopId, banId) {
                return '/shops/' + enc(shopId) + '/guest-bans/' + enc(banId);
            },
            clearGuestIpRisk: function (orderId) {
                return '/orders/' + enc(orderId) + '/guest-ip-risk';
            }
        },
        auth: {
            myProfile: function () { return '/auth/me/profile'; },
            updateMyProfile: function () { return '/auth/me/profile'; },
            setMyPublicId: function () { return '/auth/me/public-id'; },
            gateAssertion: function (ttlSeconds) {
                var q = ttlSeconds != null && ttlSeconds !== ''
                    ? '?ttlSeconds=' + enc(String(ttlSeconds))
                    : '';
                return '/auth/gate/assertion' + q;
            }
        },
        guest: {
            shopBySlug: function (slug) { return '/shops/public/by-slug/' + enc(slug); },
            connectSession: function (sessionId) { return '/sessions/connect/' + enc(sessionId); },
            connectOrders: function (sessionId) { return '/sessions/connect/' + enc(sessionId) + '/orders'; },
            joinSession: function (joinToken) { return '/sessions/join/' + enc(joinToken); },
            openFixedQrSession: function () { return '/sessions/fixed-qr/open'; },
            submitOrder: function (sessionId) { return '/sessions/order/' + enc(sessionId); },
            registerGuestRoster: function (sessionId) {
                return '/sessions/' + enc(sessionId) + '/guest-roster';
            },
            confirmGuestPeoples: function (sessionId) {
                return '/sessions/' + enc(sessionId) + '/guest-peoples';
            },
            staffRequest: function (sessionId) {
                return '/sessions/' + enc(sessionId) + '/staff-request';
            },
            menuSearch: function (slug) { return '/menus/public/by-slug/' + enc(slug); }
        },
        gateGuest: {
            shopBySlug: function (slug) { return '/v1/guest/shops/by-slug/' + enc(slug); },
            menuSearch: function () { return '/v1/guest/menus/search'; },
            toppingGroupsForMenu: function (menuId) { return '/v1/guest/topping-groups/menus/' + enc(menuId); },
            orderToppingCatalog: function (shopPublicId) { return '/v1/guest/topping-groups/shops/' + enc(shopPublicId) + '/order-catalog'; },
            orderBundle: function (shopPublicId) { return '/v1/guest/shops/' + enc(shopPublicId) + '/order-bundle'; },
            pricingRevision: function (shopPublicId) { return '/v1/guest/shops/' + enc(shopPublicId) + '/pricing-revision'; }
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
