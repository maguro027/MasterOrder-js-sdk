/**
 * MasterOrder Staff Claims SDK — Firebase Custom Claims 同期・検証（access 形式）。
 *
 * Claims 形式:
 *   { a:true } または { access:[{s,r,c?,d?}], shops:["1",...] }
 *
 * グローバル: MasterOrderStaffClaimsSdk
 */
(function (global) {
    'use strict';

    var SDK_VERSION = '2.0.0';

    function claimTruthy(value) {
        return value === true || value === 'true';
    }

    function accessShopIdsFromClaims(claims) {
        if (!claims) {
            return [];
        }
        if (Array.isArray(claims.shops)) {
            return claims.shops.map(String);
        }
        if (Array.isArray(claims.access)) {
            return claims.access.map(function (entry) {
                return entry && entry.s != null ? String(entry.s) : '';
            }).filter(function (id) { return id !== ''; });
        }
        return [];
    }

    function isPlatformAdminClaims(claims) {
        return claims && claimTruthy(claims.a);
    }

    function hasStaffClaims(claims) {
        if (!claims) {
            return false;
        }
        if (isPlatformAdminClaims(claims)) {
            return true;
        }
        return accessShopIdsFromClaims(claims).length > 0;
    }

    function serverClaimsAllowShop(body, activeShopId) {
        if (!body || body.synced !== true) {
            return false;
        }
        if (body.admin === true || body.a === true) {
            return true;
        }
        if (body.staff !== true && !Array.isArray(body.access) && !Array.isArray(body.shopIds)) {
            return false;
        }
        if (activeShopId == null || activeShopId === '') {
            return body.staff === true || body.admin === true || (Array.isArray(body.access) && body.access.length > 0);
        }
        var ids = [];
        if (Array.isArray(body.shopIds)) {
            ids = body.shopIds.map(String);
        } else if (Array.isArray(body.access)) {
            ids = body.access.map(function (e) { return e && e.s != null ? String(e.s) : ''; })
                .filter(function (x) { return x !== ''; });
        }
        return ids.indexOf(String(activeShopId)) >= 0;
    }

    function staffClaimsAllowShop(claims, activeShopId) {
        if (!claims) {
            return false;
        }
        if (isPlatformAdminClaims(claims)) {
            return true;
        }
        if (!hasStaffClaims(claims)) {
            return false;
        }
        if (activeShopId == null || activeShopId === '') {
            return true;
        }
        return accessShopIdsFromClaims(claims).indexOf(String(activeShopId)) >= 0;
    }

    function findAccessEntry(claims, shopId) {
        if (!claims || !Array.isArray(claims.access) || shopId == null || shopId === '') {
            return null;
        }
        var target = String(shopId);
        for (var i = 0; i < claims.access.length; i++) {
            var entry = claims.access[i];
            if (entry && String(entry.s) === target) {
                return entry;
            }
        }
        return null;
    }

    function promiseWithTimeout(promise, timeoutMs, label) {
        var ms = timeoutMs > 0 ? timeoutMs : 15000;
        return new Promise(function (resolve, reject) {
            var timer = global.setTimeout(function () {
                reject(new Error((label || 'API') + ' がタイムアウトしました（' + Math.round(ms / 1000) + '秒）'));
            }, ms);
            Promise.resolve(promise).then(
                function (value) {
                    global.clearTimeout(timer);
                    resolve(value);
                },
                function (err) {
                    global.clearTimeout(timer);
                    reject(err);
                }
            );
        });
    }

    function createStaffClaimsSync(options) {
        var opts = options || {};
        var sdk = opts.staffSdk || opts.clientSdk;
        var getAuthUser = opts.getAuthUser;
        var getApiBase = opts.getApiBase;
        var getShopId = opts.getShopId;
        var firestoreDirectReadEnabled = !!opts.firestoreDirectReadEnabled;
        var claimsSyncTimeoutMs = opts.claimsSyncTimeoutMs > 0 ? opts.claimsSyncTimeoutMs : 15000;
        var claimsSyncPromise = null;

        function readClaims(forceRefresh) {
            var user = typeof getAuthUser === 'function' ? getAuthUser() : null;
            if (!user) {
                return Promise.resolve(null);
            }
            return user.getIdTokenResult(forceRefresh === true).then(function (result) {
                return (result && result.claims) || {};
            });
        }

        function waitForTokenClaims(shopIdForVerify, maxAttempts) {
            var user = typeof getAuthUser === 'function' ? getAuthUser() : null;
            if (!user) {
                return Promise.resolve(null);
            }
            var attempts = Math.min(maxAttempts || 3, 3);

            function tryAttempt(attempt) {
                return readClaims(true).then(function (claims) {
                    if (!shopIdForVerify || staffClaimsAllowShop(claims, shopIdForVerify)) {
                        return user.getIdToken(true).then(function () {
                            return claims;
                        });
                    }
                    if (attempt + 1 < attempts) {
                        return new Promise(function (resolve) {
                            global.setTimeout(resolve, 400);
                        }).then(function () {
                            return tryAttempt(attempt + 1);
                        });
                    }
                    return readClaims(true);
                });
            }

            return tryAttempt(0);
        }

        function postClaimsSync() {
            if (sdk && typeof sdk.syncFirebaseClaims === 'function') {
                return sdk.syncFirebaseClaims();
            }
            var user = typeof getAuthUser === 'function' ? getAuthUser() : null;
            if (!user) {
                return Promise.reject(new Error('認証が必要です'));
            }
            return user.getIdToken(true).then(function (token) {
                var apiBase = typeof getApiBase === 'function' ? getApiBase() : '';
                var url = String(apiBase || '').replace(/\/$/, '') + '/auth/firebase/claims/sync';
                return fetch(url, {
                    method: 'POST',
                    headers: { Authorization: 'Bearer ' + token }
                }).then(function (res) {
                    return res.text().then(function (text) {
                        var payload = text;
                        try {
                            payload = text ? JSON.parse(text) : null;
                        } catch (_parseErr) {
                            /* plain text error body */
                        }
                        if (!res.ok) {
                            var msg = typeof payload === 'string'
                                ? payload
                                : (payload && payload.message ? payload.message : 'claims sync HTTP ' + res.status);
                            throw new Error(msg);
                        }
                        return payload;
                    });
                });
            });
        }

        function refreshAuthToken() {
            var user = typeof getAuthUser === 'function' ? getAuthUser() : null;
            if (!user) {
                return Promise.resolve();
            }
            return user.getIdToken(true).then(function () {
                return undefined;
            });
        }

        function syncClaims(syncOptions) {
            if (!firestoreDirectReadEnabled) {
                return Promise.resolve({ ok: false, reason: 'disabled' });
            }
            if (claimsSyncPromise) {
                return claimsSyncPromise;
            }

            var syncOpts = syncOptions || {};
            var shopIdForVerify = syncOpts.shopId;
            var lightweight = syncOpts.lightweight === true;

            claimsSyncPromise = promiseWithTimeout(
                postClaimsSync(),
                claimsSyncTimeoutMs,
                'Claims 同期 API'
            ).then(function (body) {
                if (!body || body.synced !== true) {
                    return { ok: false, reason: 'api_invalid', body: body };
                }
                var isStaff = body.staff === true || body.admin === true
                    || (Array.isArray(body.access) && body.access.length > 0);
                if (!isStaff) {
                    return { ok: false, reason: 'not_staff', body: body };
                }
                if (shopIdForVerify && !serverClaimsAllowShop(body, shopIdForVerify)) {
                    console.warn('[StaffFirestore] server denied shop', shopIdForVerify, body);
                    return { ok: false, reason: 'server_denied', body: body };
                }
                if (lightweight || !shopIdForVerify) {
                    return refreshAuthToken().then(function () {
                        return readClaims(true).then(function (claims) {
                            return { ok: true, claims: claims, body: body };
                        });
                    });
                }
                if (serverClaimsAllowShop(body, shopIdForVerify)) {
                    return waitForTokenClaims(shopIdForVerify, 3).then(function (claims) {
                        if (claims && staffClaimsAllowShop(claims, shopIdForVerify)) {
                            return { ok: true, claims: claims, body: body };
                        }
                        return refreshAuthToken().then(function () {
                            return { ok: true, claims: claims || {}, body: body, tokenPending: true };
                        });
                    });
                }
                return { ok: false, reason: 'claims_not_ready', body: body };
            }).catch(function (e) {
                console.warn('[StaffFirestore] Custom Claims sync failed:', e);
                return { ok: false, reason: 'api_error', error: e };
            }).then(function (result) {
                claimsSyncPromise = null;
                return result;
            });

            return claimsSyncPromise;
        }

        function formatClaimsError(syncResult) {
            var origin = (global.location && global.location.origin) || '';
            if (origin.indexOf('staff.mcservers-wp.com') >= 0 && origin.indexOf('masterorder-staff') < 0) {
                return '旧 URL (staff.mcservers-wp.com) では API / Firestore 権限が同期できません。'
                    + ' https://masterorder-staff.mcservers-wp.com/ を開いてください。';
            }
            if (syncResult && syncResult.reason === 'api_error') {
                return 'Firebase 権限の同期 API に失敗しました。再ログインするか、ネットワークを確認してください。';
            }
            if (syncResult && syncResult.reason === 'disabled') {
                return 'Firestore 直読が無効です（client-config を確認してください）。';
            }
            if (syncResult && syncResult.reason === 'not_staff') {
                return 'この Google アカウントには店舗スタッフ権限がありません。管理者にメンバー招待を依頼してください。';
            }
            if (syncResult && syncResult.reason === 'server_denied') {
                var ids = '(なし)';
                if (syncResult.body) {
                    if (Array.isArray(syncResult.body.shopIds)) {
                        ids = syncResult.body.shopIds.join(', ');
                    } else if (Array.isArray(syncResult.body.access)) {
                        ids = syncResult.body.access.map(function (e) { return e.s; }).join(', ');
                    }
                }
                var activeShopId = typeof getShopId === 'function' ? getShopId() : '';
                return '選択中の店舗 (ID ' + activeShopId + ') は Custom Claims 対象外です（許可 shops: ' + ids + '）。'
                    + ' 店舗を切り替えるか、管理者に権限付与を依頼してください。';
            }
            if (syncResult && syncResult.body) {
                var allowedIds = '(なし)';
                if (Array.isArray(syncResult.body.shopIds)) {
                    allowedIds = syncResult.body.shopIds.join(', ');
                } else if (Array.isArray(syncResult.body.access)) {
                    allowedIds = syncResult.body.access.map(function (e) { return e.s; }).join(', ');
                }
                return 'Firebase 権限 (Custom Claims) の ID トークン反映待ちです（server shops: ' + allowedIds + '）。'
                    + ' 10 秒待ってから再読み込みするか、ログアウト→再ログインしてください。';
            }
            return 'Firebase 権限 (Custom Claims) が未同期です。一度ログアウトして再ログインしてください。';
        }

        return {
            readClaims: readClaims,
            syncClaims: syncClaims,
            formatClaimsError: formatClaimsError,
            postClaimsSync: postClaimsSync
        };
    }

    var staffClaimsApi = {
        VERSION: SDK_VERSION,
        createStaffClaimsSync: createStaffClaimsSync,
        claimTruthy: claimTruthy,
        accessShopIdsFromClaims: accessShopIdsFromClaims,
        isPlatformAdminClaims: isPlatformAdminClaims,
        hasStaffClaims: hasStaffClaims,
        serverClaimsAllowShop: serverClaimsAllowShop,
        staffClaimsAllowShop: staffClaimsAllowShop,
        findAccessEntry: findAccessEntry,
        /** @deprecated use accessShopIdsFromClaims */
        staffClaimShopIds: accessShopIdsFromClaims
    };

    global.MasterOrderStaffClaimsSdk = staffClaimsApi;
})(typeof window !== 'undefined' ? window : globalThis);
