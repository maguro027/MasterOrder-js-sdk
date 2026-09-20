/**
 * MasterOrder Staff Lazy Loader — 遅延チャンク（charts / escpos）の読み込み。
 *
 * グローバル: MasterOrderStaffLazyLoader
 */
(function (global) {
    'use strict';

    var VERSION = '1.0.0';
    var DEFAULT_BUNDLE_VERSION = 'staff-bundle-295';
    var loadingByKey = {};

    function bundleVersion() {
        try {
            var scripts = document.getElementsByTagName('script');
            for (var i = 0; i < scripts.length; i++) {
                var src = scripts[i].src || '';
                var match = src.match(/staff-sdk\.bundle\.js\?v=([^&]+)/);
                if (match && match[1]) {
                    return match[1];
                }
            }
        } catch (_ignored) { /* ignore */ }
        return DEFAULT_BUNDLE_VERSION;
    }

    function resolveUrl(fileName) {
        var v = bundleVersion();
        return '/js/' + fileName + '?v=' + encodeURIComponent(v);
    }

    function loadScriptOnce(src) {
        return new Promise(function (resolve, reject) {
            if (typeof document === 'undefined') {
                reject(new Error('document is required to load ' + src));
                return;
            }
            var existing = document.querySelector('script[data-masterorder-src="' + src + '"]');
            if (existing) {
                if (existing.getAttribute('data-masterorder-loaded') === '1') {
                    resolve();
                    return;
                }
                existing.addEventListener('load', function () { resolve(); });
                existing.addEventListener('error', function () {
                    reject(new Error('Failed to load ' + src));
                });
                return;
            }
            var script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.setAttribute('data-cfasync', 'false');
            script.setAttribute('data-masterorder-src', src);
            script.onload = function () {
                script.setAttribute('data-masterorder-loaded', '1');
                resolve();
            };
            script.onerror = function () {
                reject(new Error('Failed to load ' + src));
            };
            document.head.appendChild(script);
        });
    }

    function ensureKey(key, predicate, fileName) {
        if (predicate()) {
            return Promise.resolve();
        }
        if (loadingByKey[key]) {
            return loadingByKey[key];
        }
        loadingByKey[key] = loadScriptOnce(resolveUrl(fileName))
            .then(function () {
                if (!predicate()) {
                    throw new Error(fileName + ' loaded but globals are missing');
                }
            })
            .catch(function (err) {
                delete loadingByKey[key];
                throw err;
            });
        return loadingByKey[key];
    }

    function chartsReady() {
        return !!(global.MasterOrderStaffDashboardSdk
            && global.MasterOrderStaffProductAnalysisSdk);
    }

    function escposReady() {
        return !!(global.MasterOrderStaffEscPosSdk
            && typeof global.MasterOrderStaffEscPosSdk.buildOfficialReceiptBytes === 'function');
    }

    function ensureCharts() {
        return ensureKey('charts', chartsReady, 'staff-sdk.lazy-charts.js');
    }

    function ensureEscPos() {
        return ensureKey('escpos', escposReady, 'staff-sdk.lazy-escpos.js');
    }

    /**
     * Firebase Firestore compat を必要時だけ読み込む（Auth は先行ロード想定）。
     */
    function ensureFirestoreCompat() {
        if (global.firebase && typeof global.firebase.firestore === 'function') {
            return Promise.resolve();
        }
        var key = 'firestore-compat';
        if (loadingByKey[key]) {
            return loadingByKey[key];
        }
        var src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js';
        loadingByKey[key] = loadScriptOnce(src).then(function () {
            if (!global.firebase || typeof global.firebase.firestore !== 'function') {
                throw new Error('firebase-firestore-compat.js failed to register');
            }
        }).catch(function (err) {
            delete loadingByKey[key];
            throw err;
        });
        return loadingByKey[key];
    }

    global.MasterOrderStaffLazyLoader = {
        VERSION: VERSION,
        ensureCharts: ensureCharts,
        ensureEscPos: ensureEscPos,
        ensureFirestoreCompat: ensureFirestoreCompat,
        chartsReady: chartsReady,
        escposReady: escposReady
    };

    /* ログイン待ちと重ねて charts チャンクを先読み（売上管理 / 商品分析の初回を短縮） */
    if (typeof document !== 'undefined') {
        var warmCharts = function () {
            ensureCharts().catch(function () { /* ignore */ });
        };
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(warmCharts, { timeout: 400 });
        } else {
            setTimeout(warmCharts, 0);
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
