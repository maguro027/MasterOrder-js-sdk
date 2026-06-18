/**
 * MasterOrder Staff User SDK — トップバー chrome（プロフィール・通知・コンテキストバッジ）
 *
 * 依存: core-sdk（任意）, staff-notifications-sdk
 * グローバル: MasterOrderStaffUserSdk
 */
(function (global) {
    'use strict';

    var SDK_VERSION = '1.0.0';
    /** 未登録時の表示用（DB には保存しない） */
    var DEFAULT_FAMILY_NAME_PLACEHOLDER = '未設定';
    /** @public_id 入力欄のサンプル（保存時は小文字に正規化） */
    var DEFAULT_PUBLIC_ID_SAMPLE = 'MasterOrder';

    function buildProfileFullName(familyName, givenName, fallback, placeholder) {
        var fb = fallback || placeholder || DEFAULT_FAMILY_NAME_PLACEHOLDER;
        if (global.MasterOrderCoreSdk && typeof global.MasterOrderCoreSdk.buildProfileFullName === 'function') {
            return global.MasterOrderCoreSdk.buildProfileFullName(familyName, givenName, fb);
        }
        return fb;
    }

    function resolveDisplayFamilyName(profile, placeholder) {
        var ph = placeholder || DEFAULT_FAMILY_NAME_PLACEHOLDER;
        if (global.MasterOrderCoreSdk && typeof global.MasterOrderCoreSdk.resolveDisplayFamilyName === 'function') {
            return global.MasterOrderCoreSdk.resolveDisplayFamilyName(profile, ph);
        }
        var value = profile && profile.familyName ? String(profile.familyName).trim() : '';
        return value || ph;
    }

    function modeLabel(mode) {
        return mode === 'KITEI_QR' ? '固定QR' : '都度QR';
    }

    function isProfileSetupComplete(profile) {
        if (!profile) {
            return false;
        }
        var family = profile.familyName ? String(profile.familyName).trim() : '';
        var given = profile.givenName ? String(profile.givenName).trim() : '';
        return family.length > 0 || given.length > 0;
    }

    /**
     * @param {{
     *   clientSdk: object,
     *   getAuthUser?: function(): object|null,
     *   profileFamilyNamePlaceholder?: string,
     *   elements: {
     *     chrome?: Element,
     *     staffTopBarBadges?: Element,
     *     staffNotificationsBar?: Element,
     *     profileWrap?: Element,
     *     profileBtn?: Element,
     *     profileMenu?: Element,
     *     profileEditBtn?: Element,
     *     profileShopSelectBtn?: Element,
     *     logoutBtn?: Element,
     *     userFamilyName?: Element,
     *     profileEditScreen?: Element,
     *     profileFamilyNameInput?: Element,
     *     profileGivenNameInput?: Element,
     *     profileFullNamePreview?: Element,
     *     profilePublicIdInput?: Element,
     *     profilePublicIdHint?: Element,
     *     profileEmailInput?: Element,
     *     profileEditStatus?: Element,
     *     profileEditBackBtn?: Element,
     *     profileEditSaveBtn?: Element,
     *     shopName?: Element,
     *     sessionModeHeaderBadge?: Element,
     *     sessionModeHeaderEffectiveHint?: Element,
     *     changeShopBtn?: Element,
     *     notifications?: {
     *       bellBtn?: Element,
     *       badge?: Element,
     *       panel?: Element,
     *       list?: Element,
     *       empty?: Element
     *     }
     *   },
     *   hooks?: {
     *     toast?: function(string, string): void,
     *     showStatus?: function(Element, string, string): void,
     *     onLogout?: function(): Promise<void>|void,
     *     isLogoutBlocked?: function(): boolean,
     *     onLogoutBlocked?: function(): void,
     *     onShopSelectRequest?: function(): void,
     *     onBeforeProfileEditOpen?: function(): Promise<void>|void,
     *     onProfileEditClose?: function(): void,
     *     onProfileSaved?: function(object): Promise<void>|void,
     *     getContextBadgeState?: function(): { visible?: boolean, savedMode?: string, effectiveMode?: string },
     *     onShopListRefresh?: function(): Promise<void>|void
     *   }
     * }} options
     */
    function createStaffUserChrome(options) {
        var opts = options || {};
        var hooks = opts.hooks || {};
        var el = opts.elements || {};
        var notifEl = el.notifications || {};
        var clientSdk = opts.clientSdk;
        var placeholder = opts.profileFamilyNamePlaceholder || DEFAULT_FAMILY_NAME_PLACEHOLDER;
        var userProfile = null;
        var notificationsCtrl = null;
        var destroyed = false;
        var onboardingActive = false;
        var onboardingResolver = null;

        function toast(message, type) {
            if (typeof hooks.toast === 'function') {
                hooks.toast(message, type || 'ok');
            }
        }

        function showStatus(statusEl, message, type) {
            if (typeof hooks.showStatus === 'function') {
                hooks.showStatus(statusEl, message, type);
            }
        }

        function show() {
            global.document.body.classList.add('staff-shell-active');
            if (el.chrome) {
                el.chrome.hidden = false;
            }
        }

        function hide() {
            closeProfileMenu();
            global.document.body.classList.remove('staff-shell-active');
            if (el.chrome) {
                el.chrome.hidden = true;
            }
        }

        function closeProfileMenu() {
            if (!el.profileMenu || !el.profileBtn) {
                return;
            }
            el.profileMenu.hidden = true;
            el.profileBtn.setAttribute('aria-expanded', 'false');
        }

        function openProfileMenu() {
            if (!el.profileMenu || !el.profileBtn) {
                return;
            }
            el.profileMenu.hidden = false;
            el.profileBtn.setAttribute('aria-expanded', 'true');
        }

        function renderDisplayName() {
            if (el.userFamilyName) {
                el.userFamilyName.textContent = resolveDisplayFamilyName(userProfile, placeholder);
            }
        }

        function setDisplayName(name) {
            if (el.userFamilyName) {
                el.userFamilyName.textContent = String(name || '').trim() || placeholder;
            }
        }

        function fallbackProfileFromAuth() {
            var authUser = typeof opts.getAuthUser === 'function' ? opts.getAuthUser() : null;
            if (!authUser) {
                return null;
            }
            return {
                email: authUser.email || '',
                familyName: null,
                givenName: null,
                fullName: null,
                publicId: null
            };
        }

        async function loadProfile() {
            if (!clientSdk || typeof clientSdk.getMyProfile !== 'function') {
                userProfile = fallbackProfileFromAuth();
                renderDisplayName();
                return userProfile;
            }
            try {
                userProfile = await clientSdk.getMyProfile();
            } catch (err) {
                console.warn('profile load failed', err);
                userProfile = fallbackProfileFromAuth();
            }
            renderDisplayName();
            return userProfile;
        }

        function getProfile() {
            return userProfile;
        }

        function setProfile(profile) {
            userProfile = profile || null;
            renderDisplayName();
        }

        function updateProfileFullNamePreview() {
            if (!el.profileFullNamePreview) {
                return;
            }
            var familyName = el.profileFamilyNameInput ? el.profileFamilyNameInput.value : '';
            var givenName = el.profileGivenNameInput ? el.profileGivenNameInput.value : '';
            var fallback = userProfile && userProfile.fullName ? userProfile.fullName : '';
            el.profileFullNamePreview.textContent = buildProfileFullName(familyName, givenName, fallback, placeholder) || '—';
        }

        function fillProfileEditForm(profile) {
            profile = profile || userProfile || {};
            var authUser = typeof opts.getAuthUser === 'function' ? opts.getAuthUser() : null;
            var email = profile.email
                || (authUser && authUser.email ? authUser.email : '');
            if (el.profileFamilyNameInput) {
                el.profileFamilyNameInput.value = profile.familyName || '';
            }
            if (el.profileGivenNameInput) {
                el.profileGivenNameInput.value = profile.givenName || '';
            }
            if (el.profileEmailInput) {
                el.profileEmailInput.value = email;
            }
            var hasPublicId = !!(profile.publicId && String(profile.publicId).trim());
            if (el.profilePublicIdInput) {
                el.profilePublicIdInput.value = hasPublicId ? profile.publicId : '';
                el.profilePublicIdInput.readOnly = hasPublicId;
                el.profilePublicIdInput.placeholder = hasPublicId ? '' : ('例: ' + DEFAULT_PUBLIC_ID_SAMPLE);
            }
            if (el.profilePublicIdHint) {
                el.profilePublicIdHint.textContent = hasPublicId
                    ? '@' + profile.publicId + ' は変更できません。'
                    : '初回のみ設定できます（英小文字・数字・アンダースコア）。';
            }
            updateProfileFullNamePreview();
        }

        function applyProfileEditChromeMode() {
            var card = el.profileEditScreen
                ? el.profileEditScreen.querySelector('.profile-edit-card')
                : null;
            var title = card ? card.querySelector('h2') : null;
            var subtitle = card ? card.querySelector('.subtitle') : null;
            if (onboardingActive) {
                if (title) {
                    title.textContent = 'アカウント初期設定';
                }
                if (subtitle) {
                    subtitle.textContent = '苗字または名前を入力してください。@public_id は任意です（初回のみ設定可能）。メールはログインアカウントのものが使われます。';
                }
                if (el.profileEditBackBtn) {
                    el.profileEditBackBtn.style.display = 'none';
                }
            } else {
                if (title) {
                    title.textContent = 'プロフィール';
                }
                if (subtitle) {
                    subtitle.textContent = '苗字と名前を分けて登録します。フルネームは自動で組み立てられます。';
                }
                if (el.profileEditBackBtn) {
                    el.profileEditBackBtn.style.display = '';
                }
            }
        }

        async function openProfileEdit() {
            onboardingActive = false;
            onboardingResolver = null;
            closeProfileMenu();
            if (typeof hooks.onBeforeProfileEditOpen === 'function') {
                await hooks.onBeforeProfileEditOpen();
            }
            await loadProfile();
            fillProfileEditForm(userProfile);
            applyProfileEditChromeMode();
            if (el.profileEditScreen) {
                el.profileEditScreen.style.display = 'flex';
            }
            if (el.profileEditStatus) {
                el.profileEditStatus.textContent = '';
                el.profileEditStatus.className = 'status';
            }
            if (el.profileFamilyNameInput) {
                el.profileFamilyNameInput.focus();
            }
            updateContextBadges();
        }

        function openProfileOnboarding() {
            if (onboardingActive) {
                return Promise.resolve(userProfile);
            }
            return new Promise(function (resolve) {
                onboardingActive = true;
                onboardingResolver = resolve;
                closeProfileMenu();
                var chain = Promise.resolve();
                if (typeof hooks.onBeforeProfileEditOpen === 'function') {
                    chain = chain.then(function () {
                        return hooks.onBeforeProfileEditOpen();
                    });
                }
                chain.then(function () {
                    return loadProfile();
                }).then(function () {
                    fillProfileEditForm(userProfile);
                    applyProfileEditChromeMode();
                    if (el.profileEditScreen) {
                        el.profileEditScreen.style.display = 'flex';
                    }
                    if (el.profileEditStatus) {
                        el.profileEditStatus.textContent = '';
                        el.profileEditStatus.className = 'status';
                    }
                    if (el.profileFamilyNameInput) {
                        el.profileFamilyNameInput.focus();
                    }
                });
            });
        }

        function closeProfileEdit() {
            if (onboardingActive) {
                return;
            }
            if (el.profileEditScreen) {
                el.profileEditScreen.style.display = 'none';
            }
            if (el.profileEditStatus) {
                el.profileEditStatus.textContent = '';
                el.profileEditStatus.className = 'status';
            }
            if (typeof hooks.onProfileEditClose === 'function') {
                hooks.onProfileEditClose();
            }
            updateContextBadges();
        }

        async function saveProfileEdit() {
            var familyName = el.profileFamilyNameInput ? el.profileFamilyNameInput.value.trim() : '';
            var givenName = el.profileGivenNameInput ? el.profileGivenNameInput.value.trim() : '';
            if (!familyName && !givenName) {
                showStatus(el.profileEditStatus, '苗字または名前を入力してください', 'error');
                return;
            }
            var textUi = global.MasterOrderTextInputUi;
            if (textUi) {
                var familyErr = textUi.requireValid(el.profileFamilyNameInput, '苗字', { maxLength: textUi.LIMITS.shortLabel });
                if (familyErr) {
                    showStatus(el.profileEditStatus, familyErr, 'error');
                    return;
                }
                var givenErr = textUi.requireValid(el.profileGivenNameInput, '名前', { maxLength: textUi.LIMITS.shortLabel });
                if (givenErr) {
                    showStatus(el.profileEditStatus, givenErr, 'error');
                    return;
                }
            }
            if (el.profileEditSaveBtn) {
                el.profileEditSaveBtn.disabled = true;
            }
            try {
                var publicIdInput = el.profilePublicIdInput;
                var wantsPublicId = publicIdInput
                    && !publicIdInput.readOnly
                    && publicIdInput.value.trim();
                if (clientSdk && typeof clientSdk.saveProfile === 'function') {
                    userProfile = await clientSdk.saveProfile({
                        familyName: familyName || null,
                        givenName: givenName || null,
                        publicId: wantsPublicId ? publicIdInput.value.trim() : null,
                        allowPublicId: !!wantsPublicId
                    });
                } else if (clientSdk) {
                    userProfile = await clientSdk.updateMyProfile({
                        familyName: familyName || null,
                        givenName: givenName || null
                    });
                    if (wantsPublicId && typeof clientSdk.setMyPublicId === 'function') {
                        userProfile = await clientSdk.setMyPublicId(publicIdInput.value.trim());
                    }
                }
                renderDisplayName();
                if (typeof hooks.onProfileSaved === 'function') {
                    await hooks.onProfileSaved(userProfile);
                }
                if (onboardingActive) {
                    onboardingActive = false;
                    var done = onboardingResolver;
                    onboardingResolver = null;
                    if (el.profileEditScreen) {
                        el.profileEditScreen.style.display = 'none';
                    }
                    applyProfileEditChromeMode();
                    if (typeof done === 'function') {
                        done(userProfile);
                    }
                    toast('アカウント設定を保存しました', 'success');
                } else {
                    toast('プロフィールを保存しました', 'success');
                    closeProfileEdit();
                }
            } catch (err) {
                showStatus(el.profileEditStatus, '保存に失敗しました: ' + (err && err.message ? err.message : String(err)), 'error');
            } finally {
                if (el.profileEditSaveBtn) {
                    el.profileEditSaveBtn.disabled = false;
                }
            }
        }

        function setShopName(name) {
            if (el.shopName) {
                el.shopName.textContent = name || '';
            }
        }

        function updateContextBadges() {
            var state = typeof hooks.getContextBadgeState === 'function'
                ? hooks.getContextBadgeState() || {}
                : {};
            var visible = !!state.visible;
            if (el.staffTopBarBadges) {
                el.staffTopBarBadges.hidden = !visible;
            }
            if (!el.sessionModeHeaderBadge) {
                return;
            }
            if (!visible) {
                el.sessionModeHeaderBadge.hidden = true;
                if (el.sessionModeHeaderEffectiveHint) {
                    el.sessionModeHeaderEffectiveHint.hidden = true;
                }
                return;
            }
            el.sessionModeHeaderBadge.hidden = false;
            var savedMode = state.savedMode || 'TSUDO_HAKKO';
            el.sessionModeHeaderBadge.querySelectorAll('.session-mode-header-option').forEach(function (node) {
                node.classList.toggle('active', node.dataset.mode === savedMode);
            });
            var effective = state.effectiveMode || savedMode;
            var mismatch = effective !== savedMode;
            if (el.sessionModeHeaderEffectiveHint) {
                if (mismatch) {
                    el.sessionModeHeaderEffectiveHint.hidden = false;
                    el.sessionModeHeaderEffectiveHint.textContent = effective === 'TSUDO_HAKKO'
                        ? '表示:都度QR'
                        : '表示:固定QR';
                } else {
                    el.sessionModeHeaderEffectiveHint.hidden = true;
                    el.sessionModeHeaderEffectiveHint.textContent = '';
                }
            }
            el.sessionModeHeaderBadge.title = mismatch
                ? '店舗設定は' + modeLabel(savedMode)
                    + 'ですが、セッション画面は' + modeLabel(effective)
                    + 'で動作しています（卓未設定など）'
                : '';
        }

        function stopNotifications() {
            if (notificationsCtrl) {
                if (typeof notificationsCtrl.destroy === 'function') {
                    notificationsCtrl.destroy();
                } else {
                    if (typeof notificationsCtrl.stopPolling === 'function') {
                        notificationsCtrl.stopPolling();
                    }
                    if (typeof notificationsCtrl.closePanel === 'function') {
                        notificationsCtrl.closePanel();
                    }
                }
            }
            notificationsCtrl = null;
            if (el.staffNotificationsBar) {
                el.staffNotificationsBar.hidden = true;
            }
        }

        function refreshNotifications() {
            if (notificationsCtrl && typeof notificationsCtrl.refresh === 'function') {
                return notificationsCtrl.refresh();
            }
            return Promise.resolve();
        }

        function startNotifications() {
            var notifSdk = global.MasterOrderStaffNotificationsSdk;
            if (!notifSdk || typeof notifSdk.createStaffNotificationsController !== 'function') {
                return;
            }
            stopNotifications();
            var authUser = typeof opts.getAuthUser === 'function' ? opts.getAuthUser() : null;
            notificationsCtrl = notifSdk.createStaffNotificationsController({
                clientSdk: clientSdk,
                storageUserId: authUser && authUser.uid ? authUser.uid : '',
                elements: {
                    bellBtn: notifEl.bellBtn,
                    badge: notifEl.badge,
                    panel: notifEl.panel,
                    list: notifEl.list,
                    empty: notifEl.empty
                },
                toast: toast,
                onShopListRefresh: hooks.onShopListRefresh
            });
            notificationsCtrl.startPolling();
            void notificationsCtrl.refresh();
            show();
            if (el.staffNotificationsBar) {
                el.staffNotificationsBar.hidden = false;
            }
        }

        function onProfileBtnClick(ev) {
            ev.stopPropagation();
            if (el.profileMenu && el.profileMenu.hidden) {
                openProfileMenu();
            } else {
                closeProfileMenu();
            }
        }

        function onDocumentClick(ev) {
            if (!el.profileWrap || !el.profileMenu || el.profileMenu.hidden) {
                return;
            }
            if (!el.profileWrap.contains(ev.target)) {
                closeProfileMenu();
            }
        }

        async function onLogoutClick() {
            if (typeof hooks.isLogoutBlocked === 'function' && hooks.isLogoutBlocked()) {
                if (typeof hooks.onLogoutBlocked === 'function') {
                    hooks.onLogoutBlocked();
                }
                return;
            }
            closeProfileMenu();
            if (typeof hooks.onLogout === 'function') {
                await hooks.onLogout();
            }
        }

        function bindUi() {
            if (el.profileBtn) {
                el.profileBtn.addEventListener('click', onProfileBtnClick);
            }
            if (el.profileEditBtn) {
                el.profileEditBtn.addEventListener('click', function () {
                    void openProfileEdit();
                });
            }
            if (el.profileShopSelectBtn) {
                el.profileShopSelectBtn.addEventListener('click', function () {
                    closeProfileMenu();
                    if (typeof hooks.onShopSelectRequest === 'function') {
                        hooks.onShopSelectRequest();
                    }
                });
            }
            if (el.logoutBtn) {
                el.logoutBtn.addEventListener('click', function () {
                    void onLogoutClick();
                });
            }
            if (el.profileEditBackBtn) {
                el.profileEditBackBtn.addEventListener('click', closeProfileEdit);
            }
            if (el.profileEditSaveBtn) {
                el.profileEditSaveBtn.addEventListener('click', function () {
                    void saveProfileEdit();
                });
            }
            if (el.profileFamilyNameInput) {
                el.profileFamilyNameInput.addEventListener('input', updateProfileFullNamePreview);
            }
            if (el.profileGivenNameInput) {
                el.profileGivenNameInput.addEventListener('input', updateProfileFullNamePreview);
            }
            if (global.MasterOrderTextInputUi) {
                global.MasterOrderTextInputUi.bindStaffProfileInputs({
                    familyName: el.profileFamilyNameInput,
                    givenName: el.profileGivenNameInput
                });
            }
            if (el.changeShopBtn) {
                el.changeShopBtn.addEventListener('click', function () {
                    if (typeof hooks.onShopSelectRequest === 'function') {
                        hooks.onShopSelectRequest();
                    }
                });
            }
            global.document.addEventListener('click', onDocumentClick);
        }

        function unbindUi() {
            if (el.profileBtn) {
                el.profileBtn.removeEventListener('click', onProfileBtnClick);
            }
            global.document.removeEventListener('click', onDocumentClick);
        }

        function destroy() {
            if (destroyed) {
                return;
            }
            destroyed = true;
            stopNotifications();
            closeProfileMenu();
            unbindUi();
            hide();
        }

        bindUi();

        return {
            show: show,
            hide: hide,
            destroy: destroy,
            loadProfile: loadProfile,
            getProfile: getProfile,
            setProfile: setProfile,
            renderDisplayName: renderDisplayName,
            setDisplayName: setDisplayName,
            openProfileEdit: openProfileEdit,
            openProfileOnboarding: openProfileOnboarding,
            closeProfileEdit: closeProfileEdit,
            isProfileSetupComplete: function () {
                return isProfileSetupComplete(userProfile);
            },
            closeProfileMenu: closeProfileMenu,
            openProfileMenu: openProfileMenu,
            startNotifications: startNotifications,
            refreshNotifications: refreshNotifications,
            stopNotifications: stopNotifications,
            updateContextBadges: updateContextBadges,
            setShopName: setShopName
        };
    }

    global.MasterOrderStaffUserSdk = {
        VERSION: SDK_VERSION,
        DEFAULT_FAMILY_NAME_PLACEHOLDER: DEFAULT_FAMILY_NAME_PLACEHOLDER,
        isProfileSetupComplete: isProfileSetupComplete,
        resolveDisplayFamilyName: resolveDisplayFamilyName,
        buildProfileFullName: buildProfileFullName,
        createStaffUserChrome: createStaffUserChrome
    };
})(typeof window !== 'undefined' ? window : globalThis);
