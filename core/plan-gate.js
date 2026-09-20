/**
 * プランゲート — isFree 1 本で来客広告 / 在庫 API を分岐する。
 *
 * Free:  広告 ON、在庫管理 OFF（Firestore 在庫 read/write なし）
 * 有料:  広告 OFF、在庫管理 ON
 */
(function (global) {
    'use strict';

    function resolveIsFree(source) {
        if (!source || typeof source !== 'object') {
            return false;
        }
        if (source.isFree === true) {
            return true;
        }
        if (source.isFree === false) {
            return false;
        }
        if (String(source.rank || '').toUpperCase() === 'FREE') {
            return true;
        }
        return false;
    }

    /** guest-shop-public 等の有料フラグを優先（焼き込み order-bundle の陳腐化に耐える） */
    function isExplicitlyPaid(source) {
        if (!source || typeof source !== 'object') {
            return false;
        }
        if (source.adsEnabled === false || source.isFree === false) {
            return true;
        }
        return false;
    }

    /** 来客 UI — メニュー内・フッター広告を出すか */
    function shouldShowGuestAds(shop, bundle) {
        if (isExplicitlyPaid(shop)) {
            return false;
        }
        if (resolveIsFree(shop)) {
            return true;
        }
        if (isExplicitlyPaid(bundle)) {
            return false;
        }
        if (resolveIsFree(bundle)) {
            return true;
        }
        return false;
    }

    /** スタッフ / Server — 在庫 API を呼ぶか */
    function shouldUseInventory(subscribeOrShop) {
        return !resolveIsFree(subscribeOrShop);
    }

    global.MasterOrderPlanGate = {
        resolveIsFree: resolveIsFree,
        shouldShowGuestAds: shouldShowGuestAds,
        shouldUseInventory: shouldUseInventory
    };
})(typeof window !== 'undefined' ? window : globalThis);
