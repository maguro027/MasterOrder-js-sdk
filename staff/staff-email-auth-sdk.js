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
        return !!(user && usesPasswordProvider(user) && user.emailVerified !== true);
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

    function formatAuthError(err) {
        var code = err && (err.code || err.errorCode || '');
        var msg = (err && err.message) ? String(err.message) : String(err || '不明なエラー');
        if (code === 'auth/email-already-in-use') {
            return 'このメールアドレスは既に登録されています。ログインしてください。';
        }
        if (code === 'auth/invalid-email') {
            return 'メールアドレスの形式が正しくありません。';
        }
        if (code === 'auth/weak-password') {
            return 'パスワードは6文字以上にしてください。';
        }
        if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
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
        return msg;
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
        usesPasswordProvider: usesPasswordProvider,
        needsEmailVerification: needsEmailVerification,
        parseOobCode: parseOobCode,
        formatAuthError: formatAuthError,
        signUpWithEmail: signUpWithEmail,
        signInWithEmail: signInWithEmail,
        sendVerificationEmail: sendVerificationEmail,
        applyVerificationCode: applyVerificationCode,
        refreshEmailVerified: refreshEmailVerified
    };
})(typeof window !== 'undefined' ? window : globalThis);
