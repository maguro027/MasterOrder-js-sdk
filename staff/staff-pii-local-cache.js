/**
 * Staff 端末ローカル PII キャッシュ（localStorage）。
 * サーバー Redis/Caffeine は使わない（D-CL-1）。
 *
 * グローバル: MasterOrderStaffPiiLocalCache
 */
(function (global) {
    'use strict';

    var CACHE_VERSION = 'v2';
    var PREFIX = 'mo:staff:pii:' + CACHE_VERSION + ':';
    var PROFILE_MAX_AGE_MS = 5 * 60 * 1000;
    var MEMBERS_MAX_AGE_MS = 60 * 1000;

    function hasStorage() {
        return typeof global.localStorage !== 'undefined';
    }

    function profileKey(uid) {
        return PREFIX + uid + ':profile';
    }

    function membersKey(uid, shopId) {
        return PREFIX + uid + ':members:' + shopId;
    }

    function readJson(key) {
        if (!hasStorage()) {
            return null;
        }
        try {
            var raw = global.localStorage.getItem(key);
            if (!raw) {
                return null;
            }
            return JSON.parse(raw);
        } catch (_ignored) {
            return null;
        }
    }

    function writeJson(key, value) {
        if (!hasStorage()) {
            return;
        }
        try {
            global.localStorage.setItem(key, JSON.stringify(value));
        } catch (_ignored) {
            /* quota / private mode */
        }
    }

    function removeKey(key) {
        if (!hasStorage()) {
            return;
        }
        try {
            global.localStorage.removeItem(key);
        } catch (_ignored) {
            /* ignore */
        }
    }

    function readFreshEntry(key, maxAgeMs) {
        var entry = readJson(key);
        if (!entry || typeof entry.savedAt !== 'number'
                || Date.now() - entry.savedAt < 0
                || Date.now() - entry.savedAt > maxAgeMs) {
            removeKey(key);
            return null;
        }
        return entry;
    }

    function saveProfile(uid, profile) {
        if (!uid || !profile) {
            return;
        }
        writeJson(profileKey(uid), {
            savedAt: Date.now(),
            profile: profile
        });
    }

    function loadProfile(uid) {
        if (!uid) {
            return null;
        }
        var entry = readJson(profileKey(uid));
        if (!entry || typeof entry.savedAt !== 'number' || !entry.profile) {
            return null;
        }
        var age = Date.now() - entry.savedAt;
        if (age < 0) {
            removeKey(profileKey(uid));
            return null;
        }
        // TTL 切れでもキーは残す（loadProfileStale / SWR 用）。24h 超は破棄。
        if (age > 24 * 60 * 60 * 1000) {
            removeKey(profileKey(uid));
            return null;
        }
        if (age > PROFILE_MAX_AGE_MS) {
            return null;
        }
        return entry.profile;
    }

    /**
     * TTL 切れでも表示用に返す（stale-while-revalidate）。
     * 24h 超は破棄。
     */
    function loadProfileStale(uid) {
        if (!uid) {
            return null;
        }
        var entry = readJson(profileKey(uid));
        if (!entry || typeof entry.savedAt !== 'number' || !entry.profile) {
            return null;
        }
        var age = Date.now() - entry.savedAt;
        if (age < 0 || age > 24 * 60 * 60 * 1000) {
            removeKey(profileKey(uid));
            return null;
        }
        return entry.profile;
    }

    function saveShopMembers(uid, shopId, members) {
        if (!uid || shopId == null) {
            return;
        }
        writeJson(membersKey(uid, shopId), {
            shopId: shopId,
            savedAt: Date.now(),
            members: Array.isArray(members) ? members : []
        });
    }

    function loadShopMembers(uid, shopId) {
        if (!uid || shopId == null) {
            return null;
        }
        var entry = readFreshEntry(membersKey(uid, shopId), MEMBERS_MAX_AGE_MS);
        if (!entry || !Array.isArray(entry.members)) {
            return null;
        }
        return entry.members;
    }

    function invalidateShopMembers(uid, shopId) {
        if (!uid || shopId == null) {
            return;
        }
        removeKey(membersKey(uid, shopId));
    }

    function clearAll(uid) {
        if (!uid || !hasStorage()) {
            return;
        }
        var currentNeedle = PREFIX + uid + ':';
        var anyVersionPrefix = 'mo:staff:pii:';
        var uidNeedle = ':' + uid + ':';
        var toRemove = [];
        for (var i = 0; i < global.localStorage.length; i++) {
            var key = global.localStorage.key(i);
            if (key && (key.indexOf(currentNeedle) === 0
                    || (key.indexOf(anyVersionPrefix) === 0 && key.indexOf(uidNeedle) >= 0))) {
                toRemove.push(key);
            }
        }
        toRemove.forEach(removeKey);
    }

    /** ログアウト時: 全アカウント分の PII キャッシュを破棄 */
    function clearAllUsers() {
        if (!hasStorage()) {
            return;
        }
        var toRemove = [];
        for (var i = 0; i < global.localStorage.length; i++) {
            var key = global.localStorage.key(i);
            if (key && key.indexOf('mo:staff:pii:') === 0) {
                toRemove.push(key);
            }
        }
        toRemove.forEach(removeKey);
    }

    function parseRealtimePayload(raw) {
        if (raw == null) {
            return null;
        }
        if (typeof raw === 'object') {
            return raw;
        }
        try {
            return JSON.parse(String(raw));
        } catch (_ignored) {
            return null;
        }
    }

  /**
   * SSE order-update から membership 無効化を処理（D-CL-3）。
   * @param {string} firebaseUid
   * @param {*} rawEventData
   */
    function handleRealtimeEvent(firebaseUid, rawEventData) {
        var payload = parseRealtimePayload(rawEventData);
        if (!payload || payload.type !== 'MEMBERSHIP_CHANGED' || payload.shopId == null) {
            return false;
        }
        invalidateShopMembers(firebaseUid, payload.shopId);
        return true;
    }

    global.MasterOrderStaffPiiLocalCache = {
        saveProfile: saveProfile,
        loadProfile: loadProfile,
        loadProfileStale: loadProfileStale,
        saveShopMembers: saveShopMembers,
        loadShopMembers: loadShopMembers,
        invalidateShopMembers: invalidateShopMembers,
        clearAll: clearAll,
        clearAllUsers: clearAllUsers,
        handleRealtimeEvent: handleRealtimeEvent
    };
})(typeof window !== 'undefined' ? window : globalThis);
