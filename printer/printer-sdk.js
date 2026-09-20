/**
 * MasterOrder Printer — public facade IIFE
 * アプリは従来どおり MasterOrderStaffEscPosSdk を使う。
 * 依存: printer-codec.js → printer-receipt.js → printer-modes.js → printer-transport.js → printer-drivers.js
 */
(function (global) {
    'use strict';

    var P = global.MasterOrderPrinter;
    if (!P || typeof P.printOfficialReceipt !== 'function') {
        throw new Error('MasterOrderPrinter transport が先に読み込まれていません');
    }

    global.MasterOrderStaffEscPosSdk = {
        VERSION: P.VERSION,
        DEFAULT_PRINTER_KEY: P.DEFAULT_PRINTER_KEY,
        SERIAL_PACE_KEY: P.SERIAL_PACE_KEY,
        BUFFER_PRESETS: P.BUFFER_PRESETS,
        PACE_MS_PRESETS: P.PACE_MS_PRESETS,
        RECEIPT_DOT_WIDTH: P.RECEIPT_DOT_WIDTH,
        PREVIEW_SAMPLE: P.PREVIEW_SAMPLE,
        listPrinterModes: P.listPrinterModes,
        getPrinterMode: P.getPrinterMode,
        setPrinterMode: P.setPrinterMode,
        isPrinterModeReady: P.isPrinterModeReady,
        isManualPrinterMode: P.isManualPrinterMode,
        describePrinterMode: P.describePrinterMode,
        getActivePrintPath: P.getActivePrintPath,
        describeActivePrintPath: P.describeActivePrintPath,
        getPrinterLanUrl: P.getPrinterLanUrl,
        setPrinterLanUrl: P.setPrinterLanUrl,
        describeSerialPace: P.describeSerialPace,
        resetSerialPace: P.resetSerialPace,
        setManualBufferPace: P.setManualBufferPace,
        applyShopPrinterSettings: P.applyShopPrinterSettings,
        exportShopPrinterSettings: P.exportShopPrinterSettings,
        getManualBufferBytes: P.getManualBufferBytes,
        getManualPaceMs: P.getManualPaceMs,
        beginSerialPaceCalibration: P.beginSerialPaceCalibration,
        isSerialPaceAdjusted: P.isSerialPaceAdjusted,
        getSerialPaceId: P.getSerialPaceId,
        formatYen: P.formatYen,
        sanitizeReceiptText: P.sanitizeReceiptText,
        wrapReceiptText: P.wrapReceiptText,
        shopFieldsFromShop: P.shopFieldsFromShop,
        flattenSessionReceiptLines: P.flattenSessionReceiptLines,
        buildPreviewSampleReceiptPayload: P.buildPreviewSampleReceiptPayload,
        buildCheckoutReceiptPayload: P.buildCheckoutReceiptPayload,
        buildOfficialReceiptParts: P.buildOfficialReceiptParts,
        buildOfficialReceiptBytes: P.buildOfficialReceiptBytes,
        buildPrinterLoadTestParts: P.buildPrinterLoadTestParts,
        renderBannerEscStar: P.renderBannerEscStar,
        downloadReceiptBytes: P.downloadReceiptBytes,
        isNativePlatform: P.isNativePlatform,
        supportsNativePrinter: P.supportsNativePrinter,
        supportsUsb: P.supportsUsb,
        supportsSerial: P.supportsSerial,
        supportsBluetooth: P.supportsBluetooth,
        supportsWebBluetooth: P.supportsWebBluetooth,
        listConnectedPrinters: P.listConnectedPrinters,
        requestUsbPrinter: P.requestUsbPrinter,
        requestSerialPrinter: P.requestSerialPrinter,
        requestBluetoothSerialPrinter: P.requestBluetoothSerialPrinter,
        requestWebBluetoothPrinter: P.requestWebBluetoothPrinter,
        requestBluetoothPrinter: P.requestBluetoothPrinter,
        requestTcpPrinter: P.requestTcpPrinter,
        getDefaultPrinter: P.getDefaultPrinter,
        setDefaultPrinter: P.setDefaultPrinter,
        clearDefaultPrinter: P.clearDefaultPrinter,
        forgetPrinter: P.forgetPrinter,
        printOfficialReceipt: P.printOfficialReceipt
    };
})(typeof window !== 'undefined' ? window : globalThis);
