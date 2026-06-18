/**
 * MasterOrder Guest Firestore SDK — 来客セッション scoped 直読（Phase 3）。
 *
 * 依存: firebase-app-compat.js, firebase-auth-compat.js, firebase-firestore-compat.js
 * グローバル: MasterOrderGuestFirestoreSdk
 *
 * PIN 成功 → Server が発行した Custom Token で signIn 後、
 * {@code shops/{shopId}/active_sessions/{sessionId}/orders} を購読する。
 * 書き込みは Server API のみ。
 */
(function (global) {
    'use strict';

    var SDK_VERSION = '1.0.0';
    var db = null;
    var listenersByKey = {};

    function requireFirebase() {
        if (!global.firebase || !global.firebase.firestore) {
            throw new Error('firebase-firestore-compat.js is required before guest-firestore-sdk.js');
        }
    }

    function sessionRef(shopId, sessionId) {
        return db.collection('shops')
            .doc(String(shopId))
            .collection('active_sessions')
            .doc(String(sessionId));
    }

    function parseItemsJson(raw) {
        if (!raw) {
            return [];
        }
        try {
            var parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (_e) {
            return [];
        }
    }

    function mapFirestoreStatus(raw) {
        var s = String(raw || '').toUpperCase();
        if (s === 'SERVED') {
            return 'SERVED';
        }
        if (s === 'CANCELED' || s === 'CANCELLED') {
            return 'CANCELLED';
        }
        return 'PREPARING';
    }

    function mapOrderDocument(doc) {
        if (!doc || !doc.exists) {
            return null;
        }
        var data = doc.data() || {};
        var items = parseItemsJson(data.itemsJson);
        return {
            orderId: data.orderId != null ? Number(data.orderId) : null,
            orderTime: data.orderedAt || null,
            totalPrice: data.totalPrice != null ? Number(data.totalPrice) : 0,
            status: mapFirestoreStatus(data.status),
            items: items
        };
    }

    function sortOrders(list) {
        return list.slice().sort(function (a, b) {
            var ta = a.orderTime || '';
            var tb = b.orderTime || '';
            if (ta === tb) {
                return Number(a.orderId || 0) - Number(b.orderId || 0);
            }
            return String(ta).localeCompare(String(tb));
        });
    }

    function init(firebaseApp) {
        requireFirebase();
        if (!firebaseApp) {
            throw new Error('MasterOrderGuestFirestoreSdk.init requires a Firebase app instance');
        }
        db = global.firebase.firestore(firebaseApp);
    }

    function stopListener(key) {
        var existing = listenersByKey[key];
        if (existing && typeof existing === 'function') {
            existing();
        }
        delete listenersByKey[key];
    }

    function stopAll() {
        Object.keys(listenersByKey).forEach(stopListener);
    }

    /**
     * Custom Token で Firebase Auth にサイレントサインイン（UI にアカウント作成は見せない）。
     * @param {object} auth firebase.auth() インスタンス
     * @param {string} customToken connect 応答の firebaseCustomToken
     */
    function signInWithCustomToken(auth, customToken) {
        if (!auth || !customToken) {
            return Promise.reject(new Error('auth and customToken are required'));
        }
        return auth.signInWithCustomToken(customToken);
    }

    /**
     * セッション doc + orders サブコレクションを購読。
     * @param {number|string} shopId
     * @param {string} sessionId
     * @param {{ onOrders?: function(Array), onSessionInactive?: function(), onError?: function(Error) }} handlers
     * @returns {function(): void} unsubscribe
     */
    function watchSession(shopId, sessionId, handlers) {
        requireFirebase();
        if (!db) {
            throw new Error('MasterOrderGuestFirestoreSdk.init() must be called first');
        }
        var h = handlers || {};
        var key = 'guest:' + String(shopId) + ':' + String(sessionId);
        stopListener(key);

        var ref = sessionRef(shopId, sessionId);
        var ordersQuery = ref.collection('orders');
        var sawServerSnapshot = false;
        var inactiveConfirmTimer = null;

        function clearInactiveConfirmTimer() {
            if (inactiveConfirmTimer != null) {
                clearTimeout(inactiveConfirmTimer);
                inactiveConfirmTimer = null;
            }
        }

        function confirmSessionInactiveOnServer() {
            if (typeof h.onSessionInactive !== 'function') {
                return;
            }
            ref.get({ source: 'server' }).then(function (doc) {
                if (!doc.exists) {
                    h.onSessionInactive();
                    return;
                }
                var data = doc.data() || {};
                if (data.isActive === false) {
                    h.onSessionInactive();
                }
            }).catch(function (err) {
                if (typeof h.onError === 'function') {
                    h.onError(err);
                }
            });
        }

        function scheduleInactiveConfirm() {
            if (!sawServerSnapshot) {
                return;
            }
            clearInactiveConfirmTimer();
            inactiveConfirmTimer = setTimeout(confirmSessionInactiveOnServer, 600);
        }

        var sessionUnsub = ref.onSnapshot(
            function (doc) {
                if (doc.metadata && doc.metadata.fromCache === false) {
                    sawServerSnapshot = true;
                }
                if (!doc.exists) {
                    scheduleInactiveConfirm();
                    return;
                }
                var data = doc.data() || {};
                if (data.isActive === false) {
                    scheduleInactiveConfirm();
                    return;
                }
                clearInactiveConfirmTimer();
            },
            function (err) {
                if (typeof h.onError === 'function') {
                    h.onError(err);
                }
            }
        );

        var ordersUnsub = ordersQuery.onSnapshot(
            function (snapshot) {
                var orders = [];
                snapshot.forEach(function (doc) {
                    var mapped = mapOrderDocument(doc);
                    if (mapped) {
                        orders.push(mapped);
                    }
                });
                if (typeof h.onOrders === 'function') {
                    h.onOrders(sortOrders(orders));
                }
            },
            function (err) {
                if (typeof h.onError === 'function') {
                    h.onError(err);
                }
            }
        );

        var unsubscribe = function () {
            clearInactiveConfirmTimer();
            sessionUnsub();
            ordersUnsub();
            delete listenersByKey[key];
        };
        listenersByKey[key] = unsubscribe;
        return unsubscribe;
    }

    global.MasterOrderGuestFirestoreSdk = {
        version: SDK_VERSION,
        init: init,
        signInWithCustomToken: signInWithCustomToken,
        watchSession: watchSession,
        stopAll: stopAll,
        mapOrderDocument: mapOrderDocument
    };
})(typeof window !== 'undefined' ? window : globalThis);
