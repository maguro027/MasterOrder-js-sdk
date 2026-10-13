/**
 * MasterOrder Staff Email Auth SDK — メール/パスワード登録と Firebase メール確認。
 *
 * 依存: firebase-auth-compat.js
 * グローバル: MasterOrderStaffEmailAuthSdk
 */
(function (global) {
    'use strict';

    var SDK_VERSION = '1.0.0';

    function usesPasswordProvider(user) {
        if (!user || !Array.isArray(user.providerData)) {
            return false;
        }
        return user.providerData.some(function (provider) {
            return provider && provider.providerId === 'password';
        });
    }

    function needsEmailVerification(user) {
        if (!user) {
            return false;
        }
        // Google 等の外部 IdP はプロバイダ側で確認済み。メール/パスワードのみ Firebase 確認を要求する。
        if (!usesPasswordProvider(user)) {
            return false;
        }
        if (!user.email) {
            return true;
        }
        return user.emailVerified !== true;
    }

    function parseOobCode(raw) {
        var input = String(raw || '').trim();
        if (!input) {
            return '';
        }
        var match = input.match(/[?&]oobCode=([^&]+)/i);
        if (match) {
            return decodeURIComponent(match[1]);
        }
        return input;
    }

    function normalizeAuthErrorCode(err) {
        var code = String((err && (err.code || err.errorCode)) || '').toLowerCase();
        var msg = (err && err.message) ? String(err.message) : String(err || '');
        if (code.indexOf('auth/') === 0) {
            return code;
        }
        var fromMsg = msg.match(/auth\/[a-z0-9-]+/i);
        if (fromMsg) {
            return fromMsg[0].toLowerCase();
        }
        if (msg.indexOf('EMAIL_EXISTS') >= 0) {
            return 'auth/email-already-in-use';
        }
        if (msg.indexOf('INVALID_EMAIL') >= 0) {
            return 'auth/invalid-email';
        }
        if (msg.indexOf('WEAK_PASSWORD') >= 0) {
            return 'auth/weak-password';
        }
        if (msg.indexOf('INVALID_LOGIN_CREDENTIALS') >= 0 || msg.indexOf('INVALID_PASSWORD') >= 0) {
            return 'auth/invalid-credential';
        }
        if (msg.indexOf('EMAIL_NOT_FOUND') >= 0 || msg.indexOf('USER_NOT_FOUND') >= 0) {
            return 'auth/user-not-found';
        }
        if (msg.indexOf('OPERATION_NOT_ALLOWED') >= 0) {
            return 'auth/operation-not-allowed';
        }
        if (msg.indexOf('TOO_MANY_ATTEMPTS') >= 0) {
            return 'auth/too-many-requests';
        }
        if (msg.indexOf('PASSWORD_DOES_NOT_MEET_REQUIREMENTS') >= 0
            || msg.indexOf('password-does-not-meet-requirements') >= 0) {
            return 'auth/password-does-not-meet-requirements';
        }
        return code;
    }

    var PASSWORD_POLICY = {
        minLength: 6,
        requireUppercase: true,
        requireLowercase: true,
        requireNumeric: false,
        requireSpecial: false
    };

    function passwordPolicyHint() {
        return '英大文字・小文字を含む6文字以上';
    }

    function validateSignupPassword(password) {
        var value = String(password || '');
        if (value.length < PASSWORD_POLICY.minLength) {
            return 'パスワードは' + PASSWORD_POLICY.minLength + '文字以上にしてください。';
        }
        if (PASSWORD_POLICY.requireUppercase && !/[A-Z]/.test(value)) {
            return 'パスワードに英大文字を含めてください。';
        }
        if (PASSWORD_POLICY.requireLowercase && !/[a-z]/.test(value)) {
            return 'パスワードに英小文字を含めてください。';
        }
        if (PASSWORD_POLICY.requireNumeric && !/[0-9]/.test(value)) {
            return 'パスワードに数字を含めてください。';
        }
        if (PASSWORD_POLICY.requireSpecial && !/[^A-Za-z0-9]/.test(value)) {
            return 'パスワードに記号を含めてください。';
        }
        return '';
    }

    function formatPasswordPolicyError(msg) {
        var missing = [];
        if (/upper case/i.test(msg) || /uppercase/i.test(msg)) {
            missing.push('英大文字');
        }
        if (/lower case/i.test(msg) || /lowercase/i.test(msg)) {
            missing.push('英小文字');
        }
        if (/numeric/i.test(msg)) {
            missing.push('数字');
        }
        if (/non-alphanumeric|special/i.test(msg)) {
            missing.push('記号');
        }
        if (missing.length) {
            return 'パスワードに ' + missing.join('・') + ' を含めてください。';
        }
        return 'パスワードが要件を満たしていません。' + passwordPolicyHint() + 'にしてください。';
    }

    function formatAuthError(err) {
        var code = normalizeAuthErrorCode(err);
        var msg = (err && err.message) ? String(err.message) : String(err || '不明なエラー');
        if (code === 'auth/email-already-in-use') {
            return 'このメールアドレスは既に登録されています。ログインしてください。';
        }
        if (code === 'auth/invalid-email') {
            return 'メールアドレスの形式が正しくありません。';
        }
        if (code === 'auth/weak-password') {
            return 'パスワードは' + PASSWORD_POLICY.minLength + '文字以上にしてください。';
        }
        if (code === 'auth/password-does-not-meet-requirements') {
            return formatPasswordPolicyError(msg);
        }
        if (isWrongPasswordError({ code: code })) {
            return 'メールアドレスまたはパスワードが正しくありません。';
        }
        if (code === 'auth/user-not-found') {
            return 'アカウントが見つかりません。新規登録してください。';
        }
        if (code === 'auth/too-many-requests') {
            return '試行回数が多すぎます。しばらく待ってから再試行してください。';
        }
        if (code === 'auth/invalid-action-code' || code === 'auth/expired-action-code') {
            return '確認コードが無効または期限切れです。確認メールを再送してください。';
        }
        if (code === 'auth/missing-email') {
            return 'メールアドレスを入力してください。';
        }
        if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
            return 'メールログインが有効になっていません。管理者に連絡してください。';
        }
        return msg;
    }

    function isWrongPasswordError(err) {
        var code = normalizeAuthErrorCode(err);
        return code === 'auth/wrong-password' || code === 'auth/invalid-credential';
    }

    /**
     * @param {object} auth firebase.auth()
     * @param {string} email
     * @param {string} password
     */
    function signUpWithEmail(auth, email, password) {
        return auth.createUserWithEmailAndPassword(String(email || '').trim(), String(password || ''));
    }

    /**
     * @param {object} auth firebase.auth()
     * @param {string} email
     * @param {string} password
     */
    function signInWithEmail(auth, email, password) {
        return auth.signInWithEmailAndPassword(String(email || '').trim(), String(password || ''));
    }

    /**
     * @param {object} auth firebase.auth()
     * @param {string} email
     * @param {object} [actionCodeSettings]
     */
    function sendPasswordResetEmail(auth, email, actionCodeSettings) {
        var trimmed = String(email || '').trim();
        if (!trimmed) {
            return Promise.reject(Object.assign(new Error('メールアドレスを入力してください。'), {
                code: 'auth/missing-email'
            }));
        }
        if (actionCodeSettings) {
            return auth.sendPasswordResetEmail(trimmed, actionCodeSettings);
        }
        return auth.sendPasswordResetEmail(trimmed);
    }

    /**
     * @param {object} auth firebase.auth()
     * @param {object} [user] firebase.User
     */
    function sendVerificationEmail(auth, user) {
        var target = user || (auth && auth.currentUser);
        if (!target) {
            return Promise.reject(new Error('ログインが必要です'));
        }
        return target.sendEmailVerification();
    }

    /**
     * メール内リンクの oobCode（または URL 全体）を適用する。
     * @param {object} auth firebase.auth()
     * @param {string} codeOrUrl
     */
    function applyVerificationCode(auth, codeOrUrl) {
        var oobCode = parseOobCode(codeOrUrl);
        if (!oobCode) {
            return Promise.reject(new Error('確認コードを入力してください'));
        }
        return auth.applyActionCode(oobCode).then(function () {
            if (auth.currentUser) {
                return auth.currentUser.reload();
            }
            return undefined;
        });
    }

    /**
     * @param {object} auth firebase.auth()
     * @returns {Promise<boolean>}
     */
    function refreshEmailVerified(auth) {
        if (!auth || !auth.currentUser) {
            return Promise.resolve(false);
        }
        return auth.currentUser.reload().then(function () {
            return auth.currentUser.emailVerified === true;
        });
    }

    global.MasterOrderStaffEmailAuthSdk = {
        VERSION: SDK_VERSION,
        passwordPolicyHint: passwordPolicyHint,
        validateSignupPassword: validateSignupPassword,
        usesPasswordProvider: usesPasswordProvider,
        needsEmailVerification: needsEmailVerification,
        parseOobCode: parseOobCode,
        formatAuthError: formatAuthError,
        isWrongPasswordError: isWrongPasswordError,
        signUpWithEmail: signUpWithEmail,
        signInWithEmail: signInWithEmail,
        sendPasswordResetEmail: sendPasswordResetEmail,
        sendVerificationEmail: sendVerificationEmail,
        applyVerificationCode: applyVerificationCode,
        refreshEmailVerified: refreshEmailVerified
    };
})(typeof window !== 'undefined' ? window : globalThis);
