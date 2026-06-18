/**
 * MasterOrder Staff Notifications — ベル通知 UI
 *
 * 依存: staff-sdk (listMyNotifications, acceptInvitation, rejectInvitation, dismissNotification)
 * グローバル: MasterOrderStaffNotificationsSdk
 */
(function (global) {
    'use strict';

    var SDK_VERSION = '1.0.1';
    var TYPE_SHOP_INVITE = 'SHOP_INVITE';
    var INTERACTION_READ_ONLY = 'READ_ONLY';
    var INTERACTION_APPROVE_DENY = 'APPROVE_DENY';
    var POLL_MS = 30000;
    var DISMISSED_STORAGE_PREFIX = 'mo_staff_dismissed_notifications:';
    var READ_ONLY_ID_PREFIX = 'read-only:';

    function dismissedStorageKey(userId) {
        var uid = String(userId || '').trim();
        return uid ? DISMISSED_STORAGE_PREFIX + uid : null;
    }

    function loadDismissedIds(userId) {
        var key = dismissedStorageKey(userId);
        if (!key) {
            return {};
        }
        try {
            var raw = localStorage.getItem(key);
            if (!raw) {
                return {};
            }
            var parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_ignored) {
            return {};
        }
    }

    function saveDismissedIds(userId, map) {
        var key = dismissedStorageKey(userId);
        if (!key) {
            return;
        }
        try {
            localStorage.setItem(key, JSON.stringify(map || {}));
        } catch (_ignored) { /* ignore */ }
    }

    function isReadOnlyNotificationId(id) {
        return String(id || '').indexOf(READ_ONLY_ID_PREFIX) === 0;
    }

    function formatOccurredAt(value) {
        if (!value) {
            return '';
        }
        var d = new Date(value);
        if (isNaN(d.getTime())) {
            return '';
        }
        var month = d.getMonth() + 1;
        var day = d.getDate();
        var hour = d.getHours();
        var minute = String(d.getMinutes()).padStart(2, '0');
        return month + '月' + day + '日 ' + hour + '時' + minute + '分';
    }

    function shopDisplayName(name) {
        var trimmed = String(name || '').trim();
        if (!trimmed) {
            return '店舗';
        }
        if (/店$/.test(trimmed)) {
            return trimmed;
        }
        return trimmed + '店';
    }

    function roleLabel(roleType) {
        var map = {
            SHOP_OWNER: 'オーナー',
            SHOP_MANAGER: 'マネージャー',
            SHOP_STAFF: 'スタッフ',
            SYSTEM_ADMIN: '管理者'
        };
        return map[String(roleType || '').toUpperCase()] || '';
    }

    function buildInviteMessage(notification) {
        var when = formatOccurredAt(notification.occurredAt);
        var shop = shopDisplayName(notification.shopName);
        var role = roleLabel(notification.roleType);
        var base = shop + 'にインバイトされました';
        if (when) {
            base += ' ' + when;
        }
        if (role) {
            base += '（' + role + '）';
        }
        return base;
    }

    function buildMessage(notification) {
        if (!notification) {
            return '';
        }
        if (notification.type === TYPE_SHOP_INVITE) {
            return buildInviteMessage(notification);
        }
        return String(notification.message || notification.title || 'お知らせ');
    }

    /**
     * @param {{
     *   clientSdk: object,
     *   storageUserId?: string,
     *   elements: { bellBtn?: Element, badge?: Element, panel?: Element, list?: Element, empty?: Element },
     *   onChanged?: function(Array): void,
     *   onShopListRefresh?: function(): Promise<void>|void,
     *   toast?: function(string, string): void
     * }} options
     */
    function createStaffNotificationsController(options) {
        var opts = options || {};
        var clientSdk = opts.clientSdk;
        var el = opts.elements || {};
        var storageUserId = String(opts.storageUserId || '').trim();
        var dismissed = loadDismissedIds(storageUserId);
        var notifications = [];
        var panelOpen = false;
        var pollTimer = null;
        var visibilityListener = null;
        var loading = false;
        var refreshQueued = false;
        var respondingId = null;
        var destroyed = false;

        var onBellClick = function (ev) {
            ev.stopPropagation();
            setPanelOpen(!panelOpen);
            if (panelOpen) {
                void refresh();
            }
        };
        var onPanelClick = function (ev) {
            ev.stopPropagation();
        };
        var onDocumentClick = function () {
            if (panelOpen) {
                setPanelOpen(false);
            }
        };

        function toast(message, type) {
            if (typeof opts.toast === 'function') {
                opts.toast(message, type || 'ok');
            }
        }

        function notifyChanged() {
            if (typeof opts.onChanged === 'function') {
                opts.onChanged(notifications.slice());
            }
        }

        function visibleNotifications(list) {
            return (Array.isArray(list) ? list : []).filter(function (item) {
                if (!item || !item.id) {
                    return false;
                }
                if (isReadOnlyNotificationId(item.id)) {
                    return !dismissed[item.id];
                }
                return true;
            });
        }

        function mergeNotificationsForRefresh(current, incoming) {
            var server = visibleNotifications(incoming);
            if (!respondingId) {
                return server;
            }
            var stillResponding = server.some(function (row) {
                return row && row.id === respondingId;
            });
            if (stillResponding) {
                return server;
            }
            var pending = (Array.isArray(current) ? current : []).find(function (row) {
                return row && row.id === respondingId;
            });
            return pending ? server.concat([pending]) : server;
        }

        function updateBadge() {
            if (!el.badge) {
                return;
            }
            var count = notifications.length;
            el.badge.textContent = count > 99 ? '99+' : String(count);
            el.badge.hidden = count <= 0;
        }

        function setPanelOpen(open) {
            panelOpen = !!open;
            if (el.panel) {
                el.panel.hidden = !panelOpen;
            }
            if (el.bellBtn) {
                el.bellBtn.setAttribute('aria-expanded', panelOpen ? 'true' : 'false');
            }
        }

        function removeFromUi(notificationId) {
            if (!notificationId) {
                return;
            }
            notifications = notifications.filter(function (row) {
                return row.id !== notificationId;
            });
            updateBadge();
            renderList();
            notifyChanged();
        }

        function persistReadOnlyDismiss(notificationId) {
            if (!isReadOnlyNotificationId(notificationId)) {
                return;
            }
            dismissed[notificationId] = Date.now();
            saveDismissedIds(storageUserId, dismissed);
        }

        function renderList() {
            if (!el.list) {
                updateBadge();
                return;
            }
            el.list.replaceChildren();
            if (!notifications.length) {
                if (el.empty) {
                    el.empty.hidden = false;
                }
                updateBadge();
                return;
            }
            if (el.empty) {
                el.empty.hidden = true;
            }

            notifications.forEach(function (notification) {
                var card = document.createElement('article');
                card.className = 'staff-notification-card';
                card.dataset.notificationId = notification.id;
                var isResponding = respondingId === notification.id;

                var body = document.createElement('p');
                body.className = 'staff-notification-card__message';
                body.textContent = buildMessage(notification);
                card.appendChild(body);

                if (notification.interaction === INTERACTION_APPROVE_DENY && notification.shopId != null) {
                    var actions = document.createElement('div');
                    actions.className = 'staff-notification-card__actions';

                    var allowBtn = document.createElement('button');
                    allowBtn.type = 'button';
                    allowBtn.className = 'staff-notification-btn staff-notification-btn--allow';
                    allowBtn.textContent = '◯ 許可';
                    allowBtn.disabled = isResponding;
                    allowBtn.addEventListener('click', function (ev) {
                        ev.stopPropagation();
                        void respondInvite(notification, true);
                    });

                    var denyBtn = document.createElement('button');
                    denyBtn.type = 'button';
                    denyBtn.className = 'staff-notification-btn staff-notification-btn--deny';
                    denyBtn.textContent = '✗ 拒否';
                    denyBtn.disabled = isResponding;
                    denyBtn.addEventListener('click', function (ev) {
                        ev.stopPropagation();
                        void respondInvite(notification, false);
                    });

                    actions.appendChild(allowBtn);
                    actions.appendChild(denyBtn);
                    card.appendChild(actions);
                } else {
                    card.classList.add('staff-notification-card--readonly');
                    card.addEventListener('click', function () {
                        if (respondingId) {
                            return;
                        }
                        void dismissReadOnly(notification);
                    });
                }

                el.list.appendChild(card);
            });
            updateBadge();
        }

        async function dismissReadOnly(notification) {
            if (!notification || !notification.id) {
                return;
            }
            if (!isReadOnlyNotificationId(notification.id)) {
                removeFromUi(notification.id);
                return;
            }
            try {
                if (clientSdk && typeof clientSdk.dismissNotification === 'function') {
                    await clientSdk.dismissNotification(notification.id);
                } else {
                    toast('通知 API が利用できません', 'error');
                    return;
                }
                persistReadOnlyDismiss(notification.id);
                removeFromUi(notification.id);
            } catch (e) {
                toast('通知の消去に失敗: ' + (e && e.message ? e.message : String(e)), 'error');
            }
        }

        async function respondInvite(notification, allow) {
            if (!clientSdk || !notification || notification.shopId == null) {
                return;
            }
            if (respondingId) {
                return;
            }
            var shopId = notification.shopId;
            var apiFn = allow ? clientSdk.acceptInvitation : clientSdk.rejectInvitation;
            if (typeof apiFn !== 'function') {
                toast('通知 API が利用できません', 'error');
                return;
            }
            respondingId = notification.id;
            renderList();
            try {
                await apiFn.call(clientSdk, shopId);
                toast(
                    shopDisplayName(notification.shopName) + (allow ? 'への参加を許可しました' : 'への招待を拒否しました'),
                    'ok'
                );
                removeFromUi(notification.id);
                if (typeof opts.onShopListRefresh === 'function') {
                    await opts.onShopListRefresh();
                }
            } catch (e) {
                toast((allow ? '許可' : '拒否') + 'に失敗: ' + (e && e.message ? e.message : String(e)), 'error');
            } finally {
                respondingId = null;
                renderList();
            }
        }

        async function refresh() {
            if (destroyed) {
                return;
            }
            if (!clientSdk || typeof clientSdk.listMyNotifications !== 'function') {
                notifications = [];
                renderList();
                return;
            }
            if (loading) {
                refreshQueued = true;
                return;
            }
            loading = true;
            try {
                var list = await clientSdk.listMyNotifications();
                notifications = mergeNotificationsForRefresh(notifications, list);
                renderList();
            } catch (_ignored) {
                /* keep previous list */
            } finally {
                loading = false;
                if (refreshQueued) {
                    refreshQueued = false;
                    void refresh();
                }
            }
        }

        function onVisibilityChange() {
            if (destroyed || global.document.visibilityState !== 'visible') {
                return;
            }
            void refresh();
        }

        function startPolling() {
            stopPolling();
            pollTimer = global.setInterval(function () {
                if (global.document.visibilityState !== 'visible') {
                    return;
                }
                void refresh();
            }, POLL_MS);
            if (!visibilityListener) {
                visibilityListener = onVisibilityChange;
                global.document.addEventListener('visibilitychange', visibilityListener);
            }
        }

        function stopPolling() {
            if (pollTimer != null) {
                global.clearInterval(pollTimer);
                pollTimer = null;
            }
            if (visibilityListener) {
                global.document.removeEventListener('visibilitychange', visibilityListener);
                visibilityListener = null;
            }
        }

        function bindUi() {
            if (el.bellBtn) {
                el.bellBtn.addEventListener('click', onBellClick);
            }
            if (el.panel) {
                el.panel.addEventListener('click', onPanelClick);
            }
            global.document.addEventListener('click', onDocumentClick);
        }

        function destroy() {
            if (destroyed) {
                return;
            }
            destroyed = true;
            stopPolling();
            setPanelOpen(false);
            if (el.bellBtn) {
                el.bellBtn.removeEventListener('click', onBellClick);
            }
            if (el.panel) {
                el.panel.removeEventListener('click', onPanelClick);
            }
            global.document.removeEventListener('click', onDocumentClick);
            notifications = [];
            respondingId = null;
            updateBadge();
        }

        bindUi();

        return {
            refresh: refresh,
            startPolling: startPolling,
            stopPolling: stopPolling,
            destroy: destroy,
            getNotifications: function () { return notifications.slice(); },
            closePanel: function () { setPanelOpen(false); }
        };
    }

    global.MasterOrderStaffNotificationsSdk = {
        version: SDK_VERSION,
        TYPE_SHOP_INVITE: TYPE_SHOP_INVITE,
        INTERACTION_READ_ONLY: INTERACTION_READ_ONLY,
        INTERACTION_APPROVE_DENY: INTERACTION_APPROVE_DENY,
        formatOccurredAt: formatOccurredAt,
        buildMessage: buildMessage,
        createStaffNotificationsController: createStaffNotificationsController
    };
})(typeof window !== 'undefined' ? window : this);
