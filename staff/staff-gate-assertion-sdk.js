/**
 * MasterOrder Staff Gate Assertion SDK
 * Firebase ID token → Gate 短命アサーション交換（Admin SA なし認証の準備）。
 *
 * グローバル: MasterOrderStaffGateAssertionSdk
 * 手順: docs/operations/GATE_ASSERTION_CUTOVER.md
 */
(function (global) {
    'use strict';

    var SDK_VERSION = '1.0.0';
    var cached = { assertion: null, expiresAt: 0, uid: null };

    function skewSeconds() {
        return 30;
    }

    function resolveFlag(value, windowKey) {
        if (typeof value === 'function') {
            try {
                return value() === true;
            } catch (_e) {
                return false;
            }
        }
        if (value === true || value === false) {
            return value === true;
        }
        if (windowKey && typeof global !== 'undefined' && global[windowKey] === true) {
            return true;
        }
        return false;
    }

    /**
     * @param {{
     *   apiBaseUrl: string,
     *   getFirebaseIdToken: function(forceRefresh?: boolean): Promise<string|null>,
     *   getAuthUid?: function(): string|null,
     *   enabled?: boolean|function(): boolean,
     *   require?: boolean|function(): boolean,
     *   ttlSeconds?: number
     * }} options
     */
    function createGateAssertionAccessToken(options) {
        var apiBase = String(options.apiBaseUrl || '').replace(/\/$/, '');
        var ttlSeconds = options.ttlSeconds > 0 ? options.ttlSeconds : 300;

        async function mint(firebaseToken) {
            var routes = global.MasterOrderApiRoutes;
            var gatePath = routes && routes.paths && routes.paths.auth
                ? routes.paths.auth.gateAssertion(ttlSeconds)
                : '/auth/gate/assertion?ttlSeconds=' + encodeURIComponent(String(ttlSeconds));
            var url = apiBase + gatePath;
            var mintOpts = {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer ' + firebaseToken,
                    Accept: 'application/json'
                }
            };
            if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
                mintOpts.signal = AbortSignal.timeout(15000);
            }
            var res = await fetch(url, mintOpts);
            if (!res.ok) {
                var body = await res.text().catch(function () { return ''; });
                if (/Just a moment|challenges\.cloudflare\.com|<!DOCTYPE\s+html|<html[\s>]/i.test(body)) {
                    throw new Error('ネットワーク保護の確認に失敗しました。通信環境を変えるか、しばらくしてから再試行してください。');
                }
                throw new Error('Gate assertion mint failed: ' + res.status + ' ' + body.slice(0, 200));
            }
            return res.json();
        }

        /**
         * @param {boolean=} forceRefresh
         * @returns {Promise<string|null>}
         */
        return async function getAccessToken(forceRefresh) {
            var enabled = resolveFlag(options.enabled, '_gateAssertionEnabled');
            var requireAssertion = resolveFlag(options.require, '_gateAssertionRequire');
            var firebaseToken = await options.getFirebaseIdToken(forceRefresh === true);
            if (!firebaseToken) {
                cached = { assertion: null, expiresAt: 0, uid: null };
                return null;
            }
            if (!enabled) {
                return firebaseToken;
            }

            var uid = typeof options.getAuthUid === 'function' ? options.getAuthUid() : null;
            var now = Math.floor(Date.now() / 1000);
            if (
                !forceRefresh
                && cached.assertion
                && cached.expiresAt > now + skewSeconds()
                && (!uid || cached.uid === uid)
            ) {
                return cached.assertion;
            }

            try {
                var data = await mint(firebaseToken);
                if (!data || !data.assertion) {
                    if (requireAssertion) {
                        throw new Error('Gate assertion mint returned empty assertion');
                    }
                    return firebaseToken;
                }
                cached = {
                    assertion: String(data.assertion),
                    expiresAt: Number(data.expiresAt) || now + ttlSeconds,
                    uid: uid
                };
                return cached.assertion;
            } catch (err) {
                if (requireAssertion) {
                    throw err;
                }
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[GateAssertion] falling back to Firebase ID token', err);
                }
                return firebaseToken;
            }
        };
    }

    global.MasterOrderStaffGateAssertionSdk = {
        version: SDK_VERSION,
        createGateAssertionAccessToken: createGateAssertionAccessToken,
        clearCache: function () {
            cached = { assertion: null, expiresAt: 0, uid: null };
        }
    };
})(typeof window !== 'undefined' ? window : globalThis);
