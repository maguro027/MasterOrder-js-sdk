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
    /** @public_id 入力欄のサンプル（保存時は小文字に正規化。masterorder 等は予約語） */
    var DEFAULT_PUBLIC_ID_SAMPLE = 'alice_shop';

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

    function normalizePublicIdInput(raw) {
        var value = String(raw == null ? '' : raw).trim();
        if (value.charAt(0) === '@') {
            value = value.slice(1).trim();
        }
        return value.toLowerCase();
    }

    function reservedPublicIdSet() {
        var list = global.MASTERORDER_RESERVED_PUBLIC_HANDLES;
        var out = {};
        if (Array.isArray(list)) {
            for (var i = 0; i < list.length; i++) {
                var id = String(list[i] || '').trim().toLowerCase();
                if (id) {
                    out[id] = true;
                }
            }
        }
        if (!Object.keys(out).length) {
            ['admin', 'root', 'staff', 'system', 'test', 'demo', 'masterorder', 'support', 'help', 'guest', 'user', 'api', 'www']
                .forEach(function (id) {
                    out[id] = true;
                });
        }
        return out;
    }

    function isReservedPublicId(value) {
        var needle = normalizePublicIdInput(value);
        if (!needle) {
            return false;
        }
        return !!reservedPublicIdSet()[needle];
    }

    function publicIdClientMessage(code, normalized) {
        var id = String(normalized || '').trim().toLowerCase();
        if (code === 'PUBLIC_ID_TAKEN') {
            return id ? '「' + id + '」は既に使われています' : 'そのアカウントIDは既に使われています';
        }
        if (code === 'PUBLIC_ID_RESERVED') {
            return id ? '「' + id + '」は使用できないIDです' : 'そのアカウントIDは使用できません';
        }
        if (code === 'PUBLIC_ID_IMMUTABLE') {
            return '名前の変更はできません';
        }
        if (code === 'EMPTY') {
            return 'アカウントIDを入力してください';
        }
        if (code === 'TOO_SHORT' || (id && id.length < 3)) {
            return id
                ? 'アカウントIDは3〜20文字です（「' + id + '」は' + id.length + '文字です）'
                : 'アカウントIDは3〜20文字です';
        }
        if (code === 'TOO_LONG' || (id && id.length > 20)) {
            return 'アカウントIDは3〜20文字です';
        }
        if (code === 'BAD_START' || (id && !/^[a-z]/.test(id))) {
            return '先頭は英小文字にしてください';
        }
        return '使えるのは英小文字・数字・アンダースコアのみです';
    }

    function validatePublicIdClient(raw) {
        var value = normalizePublicIdInput(raw);
        if (!value) {
            return null;
        }
        if (value.length < 3) {
            return publicIdClientMessage('TOO_SHORT', value);
        }
        if (value.length > 20) {
            return publicIdClientMessage('TOO_LONG', value);
        }
        if (!/^[a-z]/.test(value)) {
            return publicIdClientMessage('BAD_START', value);
        }
        if (!/^[a-z][a-z0-9_]*$/.test(value)) {
            return publicIdClientMessage('BAD_FORMAT', value);
        }
        if (isReservedPublicId(value)) {
            return publicIdClientMessage('PUBLIC_ID_RESERVED', value);
        }
        return null;
    }

    function formatProfileSaveError(err) {
        var code = err && err.payload && err.payload.code ? String(err.payload.code) : '';
        var serverMsg = err && err.payload && err.payload.message ? String(err.payload.message).trim() : '';
        var publicId = err && err.payload && err.payload.publicId ? String(err.payload.publicId) : '';
        if (code === 'PUBLIC_ID_TAKEN') {
            return publicIdClientMessage('PUBLIC_ID_TAKEN', publicId);
        }
        if (code === 'PUBLIC_ID_IMMUTABLE') {
            return publicIdClientMessage('PUBLIC_ID_IMMUTABLE', publicId);
        }
        if (code === 'PUBLIC_ID_RESERVED') {
            return publicIdClientMessage('PUBLIC_ID_RESERVED', publicId);
        }
        if (code === 'INVALID_PUBLIC_ID') {
            return serverMsg || publicIdClientMessage('BAD_FORMAT', publicId);
        }
        if (code === 'GATE_NOT_CONFIGURED' || code === 'GATE_UNAVAILABLE' || code === 'MISCONFIGURED') {
            return 'アカウントIDの設定サービスに接続できません。しばらくしてから再試行するか、管理者に連絡してください';
        }
        if (serverMsg) {
            return serverMsg;
        }
        return err && err.message ? String(err.message) : String(err);
    }

    var PROFILE_COMPLETE_FLAG_PREFIX = 'mo_staff_profile_complete:';

    function profileHasRequiredFields(profile) {
        if (!profile) {
            return false;
        }
        var family = profile.familyName ? String(profile.familyName).trim() : '';
        var given = profile.givenName ? String(profile.givenName).trim() : '';
        var publicId = profile.publicId ? String(profile.publicId).trim() : '';
        return family.length > 0 && given.length > 0 && publicId.length > 0;
    }

    function isProfileSetupComplete(profile) {
        return profileHasRequiredFields(profile);
    }

    function needsOnboarding(profile) {
        return !profileHasRequiredFields(profile);
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
     *     profilePublicIdCheckBtn?: Element,
     *     profilePublicIdCheckStatus?: Element,
     *     profileEmailInput?: Element,
     *     profileEditStatus?: Element,
     *     profileEditBackBtn?: Element,
     *     profileEditSaveBtn?: Element,
     *     profileTermsBlock?: Element,
     *     profileTermsAcceptInput?: HTMLInputElement,
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
        var onboardingPromise = null;

        function profileCompleteStorageKey() {
            var user = typeof opts.getAuthUser === 'function' ? opts.getAuthUser() : null;
            var uid = user && user.uid ? String(user.uid) : '';
            return uid ? (PROFILE_COMPLETE_FLAG_PREFIX + uid) : PROFILE_COMPLETE_FLAG_PREFIX;
        }

        function readProfileCompleteFlag() {
            try {
                return global.localStorage.getItem(profileCompleteStorageKey()) === '1';
            } catch (_ignored) {
                return false;
            }
        }

        function writeProfileCompleteFlag(complete) {
            try {
                var key = profileCompleteStorageKey();
                if (complete) {
                    global.localStorage.setItem(key, '1');
                } else {
                    global.localStorage.removeItem(key);
                }
            } catch (_ignored) {
                // ignore
            }
        }

        function rememberProfileCompletion() {
            writeProfileCompleteFlag(isProfileSetupComplete(userProfile));
        }

        function setOnboardingLock(active) {
            if (!global.document || !global.document.body) {
                return;
            }
            if (active) {
                global.document.body.classList.add('staff-onboarding-active');
            } else {
                global.document.body.classList.remove('staff-onboarding-active');
            }
        }

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
            if (el.profileBtn) {
                el.profileBtn.setAttribute('aria-expanded', 'false');
            }
            var settingsApi = global.MasterOrderStaffAppSettings;
            if (settingsApi && typeof settingsApi.close === 'function') {
                settingsApi.close();
            }
            if (!el.profileMenu) {
                return;
            }
            if (el.profileMenu.closest && el.profileMenu.closest('#appSettingsSheet')) {
                return;
            }
            el.profileMenu.hidden = true;
        }

        function openProfileMenu() {
            var settingsApi = global.MasterOrderStaffAppSettings;
            if (settingsApi && typeof settingsApi.open === 'function') {
                settingsApi.open();
                return;
            }
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

        async function waitForAccessToken(maxAttempts) {
            var attempts = maxAttempts > 0 ? maxAttempts : 3;
            if (!clientSdk || typeof clientSdk.getAccessToken !== 'function') {
                return null;
            }
            var i;
            for (i = 0; i < attempts; i += 1) {
                try {
                    var token = await Promise.resolve(clientSdk.getAccessToken());
                    if (token) {
                        return token;
                    }
                } catch (err) {
                    // auth race — retry
                }
                if (i + 1 < attempts) {
                    await new Promise(function (resolve) {
                        setTimeout(resolve, 150 * (i + 1));
                    });
                }
            }
            return null;
        }

        async function loadProfile(callOptions) {
            profileLoadedFromNetwork = false;
            if (!clientSdk || typeof clientSdk.getMyProfile !== 'function') {
                userProfile = fallbackProfileFromAuth();
                renderDisplayName();
                return userProfile;
            }
            // SWR: キャッシュがあればトークン待ち前に返す。先に waitForAccessToken すると名前表示が遅くなる。
            try {
                userProfile = await clientSdk.getMyProfile(callOptions);
                profileLoadedFromNetwork = true;
                rememberProfileCompletion();
                renderDisplayName();
                return userProfile;
            } catch (err) {
                // 初回・トークン未準備・401 のみ短く待って再試行
                if (typeof clientSdk.getAccessToken === 'function') {
                    var token = await waitForAccessToken(3);
                    if (token) {
                        try {
                            userProfile = await clientSdk.getMyProfile(callOptions);
                            profileLoadedFromNetwork = true;
                            rememberProfileCompletion();
                            renderDisplayName();
                            return userProfile;
                        } catch (retryErr) {
                            console.warn('profile load failed', retryErr);
                        }
                    } else {
                        console.warn('profile load failed', err);
                    }
                } else {
                    console.warn('profile load failed', err);
                }
                userProfile = fallbackProfileFromAuth();
                renderDisplayName();
                return userProfile;
            }
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
                    ? '@' + profile.publicId + ' は変更できません（名前の変更はできません）。'
                    : '一度設定すると変更できません。英小文字で始める3〜20文字（数字・アンダースコア可）。admin・root などの使用禁止名は不可。LP のような2文字は使えません。';
            }
            if (el.profilePublicIdCheckBtn) {
                el.profilePublicIdCheckBtn.hidden = hasPublicId;
                el.profilePublicIdCheckBtn.disabled = hasPublicId;
            }
            setPublicIdCheckStatus('', '');
            updateProfileFullNamePreview();
        }

        function setPublicIdCheckStatus(message, kind) {
            var statusEl = el.profilePublicIdCheckStatus;
            if (!statusEl) {
                return;
            }
            var text = String(message || '').trim();
            statusEl.hidden = !text;
            statusEl.textContent = text;
            statusEl.className = 'profile-public-id-check' + (kind ? ' is-' + kind : '');
        }

        async function checkPublicIdAvailability() {
            if (el.profilePublicIdInput && el.profilePublicIdInput.readOnly) {
                return;
            }
            var raw = el.profilePublicIdInput ? el.profilePublicIdInput.value.trim() : '';
            if (!raw) {
                setPublicIdCheckStatus('アカウントIDを入力してください', 'err');
                return;
            }
            var clientErr = validatePublicIdClient(raw);
            if (clientErr) {
                setPublicIdCheckStatus(clientErr, 'err');
                return;
            }
            var normalized = normalizePublicIdInput(raw);
            var sdk = opts.clientSdk;
            if (!sdk || typeof sdk.checkPublicId !== 'function') {
                setPublicIdCheckStatus('「' + normalized + '」は形式・使用禁止名の問題はありません。他の人が使っているかは保存時に確認されます。', 'ok');
                return;
            }
            if (el.profilePublicIdCheckBtn) {
                el.profilePublicIdCheckBtn.disabled = true;
            }
            setPublicIdCheckStatus('確認しています…', '');
            try {
                var result = await sdk.checkPublicId(normalized);
                if (result && result.available) {
                    setPublicIdCheckStatus('「' + (result.publicId || normalized) + '」は使用できます', 'ok');
                    return;
                }
                var code = result && result.code ? String(result.code) : '';
                var message = result && result.message ? String(result.message).trim() : '';
                setPublicIdCheckStatus(message || publicIdClientMessage(code, result && result.publicId || normalized), 'err');
            } catch (err) {
                var status = err && (err.status || err.statusCode || (err.payload && err.payload.status));
                if (status === 404 || status === 501) {
                    setPublicIdCheckStatus('「' + normalized + '」は形式・使用禁止名の問題はありません。他の人が使っているかは保存時に確認されます。', 'ok');
                    return;
                }
                setPublicIdCheckStatus(formatProfileSaveError(err), 'err');
            } finally {
                if (el.profilePublicIdCheckBtn && !(userProfile && userProfile.publicId)) {
                    el.profilePublicIdCheckBtn.disabled = false;
                }
            }
        }

        function applyProfileEditChromeMode() {
            var card = el.profileEditScreen
                ? el.profileEditScreen.querySelector('.profile-edit-card')
                : null;
            var title = card ? card.querySelector('h2') : null;
            var subtitle = card ? card.querySelector('.profile-edit-subtitle') : null;
            if (onboardingActive) {
                if (title) {
                    title.textContent = 'アカウント初期設定';
                }
                if (subtitle) {
                    subtitle.textContent = '利用規約に同意のうえ、苗字・名前・アカウントIDをすべて入力してください。IDは一度設定すると変更できません。';
                }
                if (el.profileEditBackBtn) {
                    el.profileEditBackBtn.style.display = 'none';
                }
                if (el.profileShopSelectBtn) {
                    el.profileShopSelectBtn.style.display = 'none';
                }
                if (el.changeShopBtn) {
                    el.changeShopBtn.style.display = 'none';
                }
                setOnboardingLock(true);
                if (el.profileTermsBlock) {
                    el.profileTermsBlock.hidden = false;
                }
                if (el.profileTermsAcceptInput) {
                    el.profileTermsAcceptInput.checked = false;
                    el.profileTermsAcceptInput.disabled = false;
                }
                if (el.profileEditSaveBtn) {
                    el.profileEditSaveBtn.textContent = '同意して開始';
                }
                syncOnboardingSaveEnabled();
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
                if (el.profileShopSelectBtn) {
                    el.profileShopSelectBtn.style.display = '';
                }
                if (el.changeShopBtn) {
                    el.changeShopBtn.style.display = '';
                }
                setOnboardingLock(false);
                if (el.profileTermsBlock) {
                    el.profileTermsBlock.hidden = true;
                }
                if (el.profileEditSaveBtn) {
                    el.profileEditSaveBtn.textContent = '保存';
                    el.profileEditSaveBtn.disabled = false;
                }
            }
        }

        function syncOnboardingSaveEnabled() {
            if (!el.profileEditSaveBtn) {
                return;
            }
            if (!onboardingActive) {
                el.profileEditSaveBtn.disabled = false;
                return;
            }
            var agreed = !!(el.profileTermsAcceptInput && el.profileTermsAcceptInput.checked);
            el.profileEditSaveBtn.disabled = !agreed;
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

        function paintProfileEditScreen() {
            applyProfileEditChromeMode();
            fillProfileEditForm(userProfile || fallbackProfileFromAuth());
            if (el.profileEditScreen) {
                el.profileEditScreen.style.display = 'flex';
                el.profileEditScreen.removeAttribute('hidden');
            }
            if (el.profileEditStatus) {
                el.profileEditStatus.textContent = '';
                el.profileEditStatus.className = 'status';
            }
            if (el.profileFamilyNameInput) {
                try {
                    el.profileFamilyNameInput.focus();
                } catch (_focusErr) {
                    // WebView では focus が拒否されることがある
                }
            }
        }

        function openProfileOnboarding() {
            if (onboardingPromise) {
                paintProfileEditScreen();
                return onboardingPromise;
            }
            onboardingPromise = new Promise(function (resolve) {
                onboardingActive = true;
                onboardingResolver = function (profile) {
                    onboardingPromise = null;
                    resolve(profile);
                };
                closeProfileMenu();
                var chain = Promise.resolve();
                if (typeof hooks.onBeforeProfileEditOpen === 'function') {
                    chain = chain.then(function () {
                        return hooks.onBeforeProfileEditOpen();
                    });
                }
                // プロフィール再取得前に必ず初期設定画面を出す（取得待ちで真っ白になるのを防ぐ）
                chain = chain.then(function () {
                    paintProfileEditScreen();
                    return loadProfile();
                }).then(function () {
                    paintProfileEditScreen();
                    if (!needsOnboarding(userProfile)) {
                        onboardingActive = false;
                        var done = onboardingResolver;
                        onboardingResolver = null;
                        onboardingPromise = null;
                        setOnboardingLock(false);
                        applyProfileEditChromeMode();
                        if (el.profileEditScreen) {
                            el.profileEditScreen.style.display = 'none';
                        }
                        if (typeof done === 'function') {
                            done(userProfile);
                        }
                    }
                }).catch(function (err) {
                    if (typeof console !== 'undefined' && console.warn) {
                        console.warn('[StaffUser] onboarding open failed', err);
                    }
                    if (!userProfile) {
                        userProfile = fallbackProfileFromAuth();
                    }
                    paintProfileEditScreen();
                    if (el.profileEditStatus) {
                        el.profileEditStatus.textContent =
                            'プロフィールの取得に失敗しました。入力して続行できます。';
                        el.profileEditStatus.className = 'status error';
                    }
                });
                void chain;
            });
            return onboardingPromise;
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

        function requireValidOrError(textUi, input, fieldLabel, options) {
            if (!textUi || !input) {
                return null;
            }
            var result = textUi.requireValid(input, fieldLabel, options);
            return result === true ? null : result;
        }

        async function saveProfileEdit() {
            var familyName = el.profileFamilyNameInput ? el.profileFamilyNameInput.value.trim() : '';
            var givenName = el.profileGivenNameInput ? el.profileGivenNameInput.value.trim() : '';
            if (!familyName) {
                showStatus(el.profileEditStatus, '苗字を入力してください', 'error');
                return;
            }
            if (!givenName) {
                showStatus(el.profileEditStatus, '名前を入力してください', 'error');
                return;
            }
            var publicIdInput = el.profilePublicIdInput;
            var hasExistingPublicId = !!(userProfile && userProfile.publicId
                && String(userProfile.publicId).trim());
            var publicIdRaw = publicIdInput ? publicIdInput.value.trim() : '';
            if (onboardingActive && !hasExistingPublicId && !publicIdRaw) {
                showStatus(el.profileEditStatus, 'アカウントIDを入力してください', 'error');
                return;
            }
            if (onboardingActive) {
                if (!el.profileTermsAcceptInput || !el.profileTermsAcceptInput.checked) {
                    showStatus(el.profileEditStatus, '利用規約に同意してください', 'error');
                    return;
                }
            }
            var textUi = global.MasterOrderTextInputUi;
            if (textUi) {
                var familyErr = requireValidOrError(textUi, el.profileFamilyNameInput, '苗字', {
                    maxLength: textUi.LIMITS.personName,
                    personName: true
                });
                if (familyErr) {
                    showStatus(el.profileEditStatus, familyErr, 'error');
                    return;
                }
                var givenErr = requireValidOrError(textUi, el.profileGivenNameInput, '名前', {
                    maxLength: textUi.LIMITS.personName,
                    personName: true
                });
                if (givenErr) {
                    showStatus(el.profileEditStatus, givenErr, 'error');
                    return;
                }
            }
            var wantsPublicId = publicIdInput
                && !publicIdInput.readOnly
                && publicIdRaw;
            if (onboardingActive && !hasExistingPublicId) {
                wantsPublicId = true;
            }
            if (wantsPublicId) {
                var publicIdErr = validatePublicIdClient(publicIdRaw);
                if (publicIdErr) {
                    showStatus(el.profileEditStatus, publicIdErr, 'error');
                    return;
                }
            }
            if (el.profileEditSaveBtn) {
                el.profileEditSaveBtn.disabled = true;
            }
            try {
                if (onboardingActive && (!el.profileTermsAcceptInput || !el.profileTermsAcceptInput.checked)) {
                    showStatus(el.profileEditStatus, '利用規約に同意してください', 'error');
                    syncOnboardingSaveEnabled();
                    return;
                }
                if (clientSdk && typeof clientSdk.saveProfile === 'function') {
                    userProfile = await clientSdk.saveProfile({
                        familyName: familyName || null,
                        givenName: givenName || null,
                        publicId: wantsPublicId ? publicIdRaw : null,
                        allowPublicId: !!wantsPublicId,
                        acceptTerms: !!(onboardingActive && el.profileTermsAcceptInput
                            && el.profileTermsAcceptInput.checked)
                    });
                } else if (clientSdk) {
                    userProfile = await clientSdk.updateMyProfile({
                        familyName: familyName || null,
                        givenName: givenName || null,
                        acceptTerms: !!(onboardingActive && el.profileTermsAcceptInput
                            && el.profileTermsAcceptInput.checked)
                    });
                    if (wantsPublicId && typeof clientSdk.setMyPublicId === 'function') {
                        userProfile = await clientSdk.setMyPublicId(publicIdRaw);
                    }
                }
                if (onboardingActive && !isProfileSetupComplete(userProfile)) {
                    showStatus(el.profileEditStatus, '苗字・名前・アカウントIDの設定を完了してください', 'error');
                    return;
                }
                rememberProfileCompletion();
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
                showStatus(el.profileEditStatus, '保存に失敗しました: ' + formatProfileSaveError(err), 'error');
            } finally {
                if (el.profileEditSaveBtn) {
                    if (onboardingActive) {
                        syncOnboardingSaveEnabled();
                    } else {
                        el.profileEditSaveBtn.disabled = false;
                    }
                }
            }
        }

        async function redeemPromoCode() {
            var input = el.profilePromoCodeInput;
            var code = input ? String(input.value || '').trim() : '';
            if (!code) {
                showStatus(el.profilePromoStatus, 'コードを入力してください', 'error');
                return;
            }
            if (!clientSdk || typeof clientSdk.redeemPromotion !== 'function') {
                showStatus(el.profilePromoStatus, 'この画面からはまだ使えません', 'error');
                return;
            }
            if (el.profilePromoRedeemBtn) {
                el.profilePromoRedeemBtn.disabled = true;
            }
            try {
                var result = await clientSdk.redeemPromotion(code);
                if (input) {
                    input.value = '';
                }
                var ownerGranted = !!(result && (result.ownerGranted === true || result.accountType === 'OWNER'));
                var message = result && result.message
                    ? String(result.message)
                    : (ownerGranted
                        ? 'オーナー化しました。反映まで数分かかることがあります。'
                        : 'プロモーションを適用しました');
                if (ownerGranted && userProfile) {
                    userProfile.accountType = 'OWNER';
                    userProfile.canCreateShop = true;
                    if (!(Number(userProfile.shopSlots) > 0)) {
                        userProfile.shopSlots = 1;
                    }
                }
                showStatus(el.profilePromoStatus, message, 'success');
                toast(message, 'success');
                if (typeof clientSdk.getMyProfile === 'function') {
                    clientSdk.getMyProfile().then(function (profile) {
                        if (!profile) {
                            return;
                        }
                        userProfile = profile;
                        renderDisplayName();
                    }).catch(function () {});
                }
            } catch (err) {
                var serverMsg = err && err.payload && err.payload.message ? String(err.payload.message) : '';
                showStatus(el.profilePromoStatus, serverMsg || (err && err.message) || '適用できませんでした', 'error');
            } finally {
                if (el.profilePromoRedeemBtn) {
                    el.profilePromoRedeemBtn.disabled = false;
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
                    el.sessionModeHeaderEffectiveHint.textContent = '';
                }
                return;
            }
            el.sessionModeHeaderBadge.hidden = true;
            if (el.sessionModeHeaderEffectiveHint) {
                el.sessionModeHeaderEffectiveHint.hidden = true;
                el.sessionModeHeaderEffectiveHint.textContent = '';
            }
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
            /* 通知 SDK の有無に関わらず chrome は必ず出す（プロフィール/ログアウト用） */
            show();
            var notifSdk = global.MasterOrderStaffNotificationsSdk;
            if (!notifSdk || typeof notifSdk.createStaffNotificationsController !== 'function') {
                if (el.staffNotificationsBar) {
                    el.staffNotificationsBar.hidden = true;
                }
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
            if (el.staffNotificationsBar) {
                el.staffNotificationsBar.hidden = false;
            }
        }

        function onProfileBtnClick(ev) {
            ev.stopPropagation();
            var settingsApi = global.MasterOrderStaffAppSettings;
            if (settingsApi && typeof settingsApi.toggle === 'function') {
                settingsApi.toggle();
                return;
            }
            if (el.profileMenu && el.profileMenu.hidden) {
                openProfileMenu();
            } else {
                closeProfileMenu();
            }
        }

        function onDocumentClick(ev) {
            var sheet = global.document.getElementById('appSettingsSheet');
            var menuInSheet = el.profileMenu && el.profileMenu.closest && el.profileMenu.closest('#appSettingsSheet');
            if (menuInSheet) {
                if (!sheet || sheet.hidden) {
                    return;
                }
                if (sheet.contains(ev.target)) {
                    return;
                }
                closeProfileMenu();
                return;
            }
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
                    if (onboardingActive) {
                        return;
                    }
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
            if (el.profilePromoRedeemBtn) {
                el.profilePromoRedeemBtn.addEventListener('click', function () {
                    void redeemPromoCode();
                });
            }
            if (el.profilePublicIdCheckBtn) {
                el.profilePublicIdCheckBtn.addEventListener('click', function () {
                    void checkPublicIdAvailability();
                });
            }
            if (el.profilePublicIdInput) {
                el.profilePublicIdInput.addEventListener('input', function () {
                    setPublicIdCheckStatus('', '');
                });
            }
            if (el.profileTermsAcceptInput) {
                el.profileTermsAcceptInput.addEventListener('change', syncOnboardingSaveEnabled);
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
                    if (onboardingActive) {
                        return;
                    }
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
            setOnboardingLock(false);
            stopNotifications();
            closeProfileMenu();
            unbindUi();
            hide();
        }

        var profileLoadedFromNetwork = false;

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
            needsOnboarding: function () {
                if (profileLoadedFromNetwork) {
                    return needsOnboarding(userProfile);
                }
                // 取得前/失敗時: 完了フラグがある既存端末だけ通す。新規は他UIへ進めない。
                if (readProfileCompleteFlag()) {
                    return false;
                }
                return true;
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
        needsOnboarding: needsOnboarding,
        profileHasRequiredFields: profileHasRequiredFields,
        normalizePublicIdInput: normalizePublicIdInput,
        validatePublicIdClient: validatePublicIdClient,
        isReservedPublicId: isReservedPublicId,
        resolveDisplayFamilyName: resolveDisplayFamilyName,
        buildProfileFullName: buildProfileFullName,
        createStaffUserChrome: createStaffUserChrome
    };
})(typeof window !== 'undefined' ? window : globalThis);
