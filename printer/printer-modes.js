/**
 * MasterOrder Printer — modes IIFE
 * マニュアル（従来の CDC 送り）と、Windows / スター精密 / Epson ドライバ。
 * 依存: printer-codec.js（MasterOrderPrinter）
 */
(function (global) {
    'use strict';

    var P = global.MasterOrderPrinter || (global.MasterOrderPrinter = {});
    var MODE_KEY = 'mo.staff.printerMode';
    var LAN_URL_KEY = 'mo.staff.printerLanUrl';
    var MODE_ESCPOS_MANUAL = 'escpos-manual';
    var MODE_ESCPOS_CDC = 'escpos-cdc';
    var MODE_WINDOWS_DRIVER = 'windows-driver';
    var MODE_STAR_PRNT = 'star-prnt';
    var MODE_EPSON_EPOS = 'epson-epos';

    var PRINTER_MODES = [
        {
            id: MODE_ESCPOS_MANUAL,
            label: 'マニュアル（ESC/POS）',
            ready: true,
            needsTune: true,
            needsLan: false,
            note: '安価な ESC/POS 互換機向け。バッファ容量と送り間隔を自分で指定します。Web Serial keep-open。'
        },
        {
            id: MODE_WINDOWS_DRIVER,
            label: 'OS 印刷ダイアログ',
            ready: true,
            needsTune: false,
            needsLan: false,
            note: 'ブラウザ／OS の印刷ダイアログが開きます。スマホでは AirPrint やシステムのプリンタ一覧から選べます。USB シリアルへは直接送りません。'
        },
        {
            id: MODE_STAR_PRNT,
            label: 'スター精密',
            ready: true,
            needsTune: true,
            needsLan: true,
            note: 'LAN の IP を入れると Star WebPRNT。空のままだと USB シリアルへ通常の ESC/POS を送ります（専用 Star コマンドではありません）。'
        },
        {
            id: MODE_EPSON_EPOS,
            label: 'EPSON ePOS',
            ready: true,
            needsTune: true,
            needsLan: true,
            note: 'LAN の IP を入れると ePOS XML。空のままだと USB シリアルへ通常の ESC/POS を送ります（ePOS SOAP ではありません）。'
        }
    ];

    function canonicalModeId(id) {
        var want = String(id || '');
        if (want === MODE_ESCPOS_CDC) {
            return MODE_ESCPOS_MANUAL;
        }
        return want;
    }

    function findPrinterMode(id) {
        var want = canonicalModeId(id);
        var i;
        for (i = 0; i < PRINTER_MODES.length; i += 1) {
            if (PRINTER_MODES[i].id === want) {
                return PRINTER_MODES[i];
            }
        }
        return null;
    }

    function listPrinterModes() {
        return PRINTER_MODES.slice();
    }

    function getPrinterMode() {
        try {
            var raw = global.localStorage && global.localStorage.getItem(MODE_KEY);
            var meta = findPrinterMode(raw);
            if (meta) {
                return meta.id;
            }
        } catch (_e) {
            /* ignore */
        }
        return MODE_ESCPOS_MANUAL;
    }

    function setPrinterMode(id) {
        var meta = findPrinterMode(id);
        if (!meta) {
            throw new Error('未知の印刷方式です');
        }
        if (!global.localStorage) {
            throw new Error('このブラウザでは印刷方式を保存できません');
        }
        global.localStorage.setItem(MODE_KEY, meta.id);
        return meta.id;
    }

    function isPrinterModeReady(id) {
        var meta = findPrinterMode(id || getPrinterMode());
        return !!(meta && meta.ready);
    }

    function isManualPrinterMode(id) {
        return canonicalModeId(id || getPrinterMode()) === MODE_ESCPOS_MANUAL;
    }

    function describePrinterMode(id) {
        var meta = findPrinterMode(id || getPrinterMode());
        if (!meta) {
            return '未知の印刷方式です';
        }
        if (meta.ready) {
            return meta.note;
        }
        return meta.label + ' は準備中です。いまはマニュアル（ESC/POS）を選んでください。';
    }

    function getPrinterLanUrl() {
        try {
            var raw = global.localStorage && global.localStorage.getItem(LAN_URL_KEY);
            return raw ? String(raw).trim() : '';
        } catch (_e) {
            return '';
        }
    }

    function setPrinterLanUrl(url) {
        if (!global.localStorage) {
            throw new Error('このブラウザではプリンタ URL を保存できません');
        }
        var value = String(url == null ? '' : url).trim();
        if (!value) {
            global.localStorage.removeItem(LAN_URL_KEY);
            return '';
        }
        global.localStorage.setItem(LAN_URL_KEY, value);
        return value;
    }

    P.PRINTER_MODE_KEY = MODE_KEY;
    P.PRINTER_LAN_URL_KEY = LAN_URL_KEY;
    P.PRINTER_MODE_ESCPOS_MANUAL = MODE_ESCPOS_MANUAL;
    P.PRINTER_MODE_ESCPOS_CDC = MODE_ESCPOS_CDC;
    P.PRINTER_MODE_WINDOWS_DRIVER = MODE_WINDOWS_DRIVER;
    P.PRINTER_MODE_STAR_PRNT = MODE_STAR_PRNT;
    P.PRINTER_MODE_EPSON_EPOS = MODE_EPSON_EPOS;
    P.listPrinterModes = listPrinterModes;
    P.getPrinterMode = getPrinterMode;
    P.setPrinterMode = setPrinterMode;
    P.isPrinterModeReady = isPrinterModeReady;
    P.isManualPrinterMode = isManualPrinterMode;
    P.describePrinterMode = describePrinterMode;
    P.getPrinterLanUrl = getPrinterLanUrl;
    P.setPrinterLanUrl = setPrinterLanUrl;
})(typeof window !== 'undefined' ? window : globalThis);
