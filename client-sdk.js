/**
 * @deprecated staff-sdk.js を使用してください（MasterOrderStaffSdk）。
 * このファイルは MasterOrderClientSdk エイリアス用の互換シムです。
 * staff-sdk.js を読み込むと MasterOrderClientSdk も同時に設定されます。
 */
(function (global) {
    'use strict';
    if (!global.MasterOrderStaffSdk) {
        throw new Error(
            'Load staff-sdk.js (not client-sdk.js alone). ' +
            'MasterOrderStaffSdk is canonical; client-sdk.js is a legacy alias shim.');
    }
    global.MasterOrderClientSdk = global.MasterOrderStaffSdk;
})(typeof window !== 'undefined' ? window : globalThis);
