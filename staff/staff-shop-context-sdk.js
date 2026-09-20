/**
 * MasterOrder Staff Shop Context SDK — 店舗単位の subscribe / manage-menus 取得を dedupe。
 *
 * getManageMenus と getShopSubscribe の二重 subscribe 取得を防ぎ、
 * 在庫ガード等でも同じキャッシュを再利用する。
 *
 * グローバル: MasterOrderStaffShopContextSdk
 */
(function (global) {
    'use strict';

    var SDK_VERSION = '1.0.0';
    var DEFAULT_SUBSCRIBE_TTL_MS = 120000;

    function normalizeShopId(shopId) {
        return shopId == null ? '' : String(shopId);
    }

    function isFresh(entry, ttlMs) {
        if (!entry || entry.fetchedAt == null) {
            return false;
        }
        var ttl = ttlMs != null && ttlMs > 0 ? ttlMs : DEFAULT_SUBSCRIBE_TTL_MS;
        return (Date.now() - entry.fetchedAt) < ttl;
    }

    /**
     * @returns {{
     *   peekSubscribe: function(number|string): *,
     *   invalidate: function(number|string=): void,
     *   getSubscribe: function(http, shopSubscribePath, number|string, object=): Promise<*>,
     *   loadManageMenus: function(http, paths, number|string, object): Promise<{menus: Array, subscribe: *}>
     * }}
     */
    function createShopContextStore() {
        var subscribeByShop = Object.create(null);
        var inflightSubscribeByShop = Object.create(null);
        var manageMenusInflightByShop = Object.create(null);
        var manageMenusCacheByShop = Object.create(null);
        var DEFAULT_MENUS_TTL_MS = 60 * 1000;

        function peekSubscribe(shopId) {
            var key = normalizeShopId(shopId);
            var entry = subscribeByShop[key];
            return entry ? entry.value : null;
        }

        function invalidate(shopId) {
            if (shopId == null) {
                subscribeByShop = Object.create(null);
                inflightSubscribeByShop = Object.create(null);
                manageMenusInflightByShop = Object.create(null);
                manageMenusCacheByShop = Object.create(null);
                return;
            }
            var key = normalizeShopId(shopId);
            delete subscribeByShop[key];
            delete inflightSubscribeByShop[key];
            delete manageMenusInflightByShop[key];
            delete manageMenusCacheByShop[key];
        }

        function getSubscribe(http, shopSubscribePath, shopId, options) {
            var opts = options || {};
            var key = normalizeShopId(shopId);
            if (!key) {
                return Promise.resolve(null);
            }
            if (!opts.force) {
                var cached = subscribeByShop[key];
                if (isFresh(cached, opts.ttlMs)) {
                    return Promise.resolve(cached.value);
                }
                if (inflightSubscribeByShop[key]) {
                    return inflightSubscribeByShop[key];
                }
            } else {
                delete inflightSubscribeByShop[key];
            }

            var promise = http.get(shopSubscribePath(shopId))
                .then(function (sub) {
                    subscribeByShop[key] = { value: sub, fetchedAt: Date.now() };
                    delete inflightSubscribeByShop[key];
                    return sub;
                })
                .catch(function (err) {
                    delete inflightSubscribeByShop[key];
                    if (opts.allowNullOnError) {
                        return null;
                    }
                    return Promise.reject(err);
                });
            inflightSubscribeByShop[key] = promise;
            return promise;
        }

        function loadManageMenus(http, paths, shopId, helpers) {
            var key = normalizeShopId(shopId);
            if (!key) {
                return Promise.resolve({ menus: [], subscribe: null });
            }
            var h = helpers || {};
            var force = h.force === true;
            var ttlMs = h.ttlMs != null ? h.ttlMs : DEFAULT_MENUS_TTL_MS;
            if (!force) {
                var cachedMenus = manageMenusCacheByShop[key];
                if (cachedMenus && isFresh(cachedMenus, ttlMs)) {
                    return Promise.resolve(cachedMenus.value);
                }
            }
            if (manageMenusInflightByShop[key]) {
                return manageMenusInflightByShop[key];
            }

            var shopIsFree = typeof h.shopIsFree === 'function'
                ? h.shopIsFree
                : function () { return false; };
            var mergeMenusWithInventory = typeof h.mergeMenusWithInventory === 'function'
                ? h.mergeMenusWithInventory
                : function (menus) { return menus; };

            var promise = Promise.all([
                http.get(paths.manageMenus(shopId)),
                getSubscribe(http, paths.shopSubscribe, shopId, { allowNullOnError: true })
            ]).then(function (pair) {
                var menus = Array.isArray(pair[0]) ? pair[0] : [];
                var subscribe = pair[1];
                var result = { menus: menus, subscribe: subscribe };
                if (shopIsFree(subscribe)) {
                    return result;
                }
                // 在庫は管理メニュー取得時のみ（ログイン暖機や全店プリフェッチでは呼ばない）
                return http.get(paths.shopInventory(shopId)).catch(function () { return []; })
                    .then(function (inventory) {
                        inventory = Array.isArray(inventory) ? inventory : [];
                        result.menus = mergeMenusWithInventory(menus, inventory);
                        return result;
                    });
            }).then(function (result) {
                manageMenusCacheByShop[key] = { value: result, fetchedAt: Date.now() };
                return result;
            }).finally(function () {
                delete manageMenusInflightByShop[key];
            });

            manageMenusInflightByShop[key] = promise;
            return promise;
        }

        return {
            peekSubscribe: peekSubscribe,
            invalidate: invalidate,
            getSubscribe: getSubscribe,
            loadManageMenus: loadManageMenus
        };
    }

    global.MasterOrderStaffShopContextSdk = {
        VERSION: SDK_VERSION,
        DEFAULT_SUBSCRIBE_TTL_MS: DEFAULT_SUBSCRIBE_TTL_MS,
        create: createShopContextStore,
        shared: createShopContextStore()
    };
})(typeof window !== 'undefined' ? window : globalThis);
