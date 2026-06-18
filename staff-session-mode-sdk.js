/**
 * MasterOrder Staff Session Mode SDK — 固定QR / 都度QR セッション表示モード判定。
 *
 * グローバル: MasterOrderStaffSessionModeSdk
 */
(function (global) {
    'use strict';

    var SDK_VERSION = '1.0.0';

    /**
     * 店舗セッションモード判定コンテキスト。
     * @param {{ getCurrentShop: function(): object|null, firestoreDirectReadEnabled?: boolean, getTableSeatsCacheLength?: function(): number }} options
     */
    function createSessionModeContext(options) {
        var opts = options || {};
        var getCurrentShop = opts.getCurrentShop;
        var firestoreDirectReadEnabled = !!opts.firestoreDirectReadEnabled;
        var getTableSeatsCacheLength = opts.getTableSeatsCacheLength;

        function tableSeatsCacheLength() {
            if (typeof getTableSeatsCacheLength === 'function') {
                return Number(getTableSeatsCacheLength()) || 0;
            }
            return 0;
        }

        function resolvedSessionMode() {
            var shop = typeof getCurrentShop === 'function' ? getCurrentShop() : null;
            var mode = shop && shop.sessionMode;
            return mode === 'KITEI_QR' ? 'KITEI_QR' : 'TSUDO_HAKKO';
        }

        function resolveShopSeatCount() {
            var shop = typeof getCurrentShop === 'function' ? getCurrentShop() : null;
            var max = shop && Number(shop.maxActiveSessions);
            if (max > 0) {
                return max;
            }
            if (tableSeatsCacheLength()) {
                return tableSeatsCacheLength();
            }
            if (resolvedSessionMode() === 'KITEI_QR') {
                return 30;
            }
            return 0;
        }

        /** 席数ベースの卓カードグリッド（固定QR / 都度発行共通） */
        function usesTableSeatGrid() {
            if (resolvedSessionMode() === 'KITEI_QR') {
                return true;
            }
            var seatCount = resolveShopSeatCount();
            if (seatCount <= 0) {
                return tableSeatsCacheLength() > 0;
            }
            return true;
        }

        /** 固定QRは常に卓グリッド。都度発行はそのまま */
        function effectiveSessionListMode() {
            return resolvedSessionMode();
        }

        /** 固定QR のとき Firestore セッション直読（都度発行は REST+SSE） */
        function staffFirestoreSessionsDirectReadActive() {
            return firestoreDirectReadEnabled && resolvedSessionMode() === 'KITEI_QR';
        }

        function tableSeatStatusLabel(status, isKiteiMode) {
            var isUsing = String(status || '').toUpperCase() === 'USING';
            if (isKiteiMode) {
                return isUsing ? 'Active' : 'Wait';
            }
            return isUsing ? 'アクティブ' : 'クローズ';
        }

        function isFixedQrSessionTab() {
            return resolvedSessionMode() === 'KITEI_QR';
        }

        function usesTableSeatGridTab() {
            return usesTableSeatGrid();
        }

        return {
            resolvedSessionMode: resolvedSessionMode,
            resolveShopSeatCount: resolveShopSeatCount,
            usesTableSeatGrid: usesTableSeatGrid,
            effectiveSessionListMode: effectiveSessionListMode,
            staffFirestoreSessionsDirectReadActive: staffFirestoreSessionsDirectReadActive,
            tableSeatStatusLabel: tableSeatStatusLabel,
            isFixedQrSessionTab: isFixedQrSessionTab,
            usesTableSeatGridTab: usesTableSeatGridTab
        };
    }

    var sessionModeApi = {
        VERSION: SDK_VERSION,
        createSessionModeContext: createSessionModeContext
    };

    global.MasterOrderStaffSessionModeSdk = sessionModeApi;
})(typeof window !== 'undefined' ? window : globalThis);
