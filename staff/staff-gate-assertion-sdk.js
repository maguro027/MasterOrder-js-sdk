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

    /** JWT の exp（秒）。検証はしない。読めなければ 0。 */
    function firebaseIdTokenExp(token) {
        try {
            var parts = String(token || '').split('.');
            if (parts.length < 2 || !parts[1]) {
                return 0;
            }
            var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            while (b64.length % 4) {
                b64 += '=';
            }
            var json = JSON.parse(atob(b64));
            var exp = Number(json && json.exp);
            return Number.isFinite(exp) && exp > 0 ? exp : 0;
        } catch (_e) {
            return 0;
        }
    }

    /** 期限切れ、または skew 秒以内に切れる ID トークンは再取得する。 */
    function firebaseIdTokenNeedsRefresh(token, withinSeconds) {
        var skew = withinSeconds == null ? 90 : Number(withinSeconds);
        if (!Number.isFinite(skew) || skew < 0) {
            skew = 90;
        }
        var exp = firebaseIdTokenExp(token);
        if (!exp) {
            return true;
        }
        return exp <= Math.floor(Date.now() / 1000) + skew;
    }

    function isMintAuthRejected(err) {
        var status = err && Number(err.status);
        if (status === 401 || status === 403) {
            return true;
        }
        var msg = err && err.message ? String(err.message) : '';
        return /Gate assertion mint failed:\s*40[13]/.test(msg);
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

        var mintInflight = null;

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
                var err = new Error('Gate assertion mint failed: ' + res.status);
                err.status = res.status;
                throw err;
            }
            return res.json();
        }

        async function mintWithFreshFirebaseToken() {
            var firebaseToken = await options.getFirebaseIdToken(false);
            if (!firebaseToken) {
                return null;
            }
            if (firebaseIdTokenNeedsRefresh(firebaseToken, 90)) {
                firebaseToken = await options.getFirebaseIdToken(true);
                if (!firebaseToken) {
                    return null;
                }
            }
            try {
                return await mint(firebaseToken);
            } catch (err) {
                if (!isMintAuthRejected(err)) {
                    throw err;
                }
                var forced = await options.getFirebaseIdToken(true);
                if (!forced || forced === firebaseToken) {
                    throw err;
                }
                return await mint(forced);
            }
        }

        function mintOnce() {
            if (!mintInflight) {
                mintInflight = mintWithFreshFirebaseToken().finally(function () {
                    mintInflight = null;
                });
            }
            return mintInflight;
        }

        /**
         * @param {boolean=} forceRefresh
         * @returns {Promise<string|null>}
         */
        return async function getAccessToken(forceRefresh) {
            var enabled = resolveFlag(options.enabled, '_gateAssertionEnabled');
            var requireAssertion = resolveFlag(options.require, '_gateAssertionRequire');
            if (!enabled) {
                return options.getFirebaseIdToken(forceRefresh === true);
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
                var data = await mintOnce();
                if (!data || !data.assertion) {
                    if (requireAssertion) {
                        throw new Error('Gate assertion mint returned empty assertion');
                    }
                    return options.getFirebaseIdToken(false);
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
                return options.getFirebaseIdToken(true);
            }
        };
    }

    global.MasterOrderStaffGateAssertionSdk = {
        version: SDK_VERSION,
        createGateAssertionAccessToken: createGateAssertionAccessToken,
        firebaseIdTokenNeedsRefresh: firebaseIdTokenNeedsRefresh,
        clearCache: function () {
            cached = { assertion: null, expiresAt: 0, uid: null };
        }
    };
})(typeof window !== 'undefined' ? window : globalThis);
