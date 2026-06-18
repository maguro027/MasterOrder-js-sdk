/**
 * メニュー画像 URL（R2 カスタムドメイン）。order-config / client-config の _imageBaseUrl を使用。
 */
(function (global) {
    'use strict';

    var DEFAULT_IMAGE_PUBLIC_BASE = 'https://masterorder-assets.mcservers-wp.com';
    var MENU_ICON_PREFIX = 'MenuIcon';
    var LEGACY_SIZE_PREFIXES = ['large/', 'medium/', 'small/'];

    function imagePublicBase() {
        var fromConfig = global.window && global.window._imageBaseUrl;
        if (typeof fromConfig === 'string' && fromConfig.trim()) {
            return fromConfig.trim().replace(/\/$/, '');
        }
        return DEFAULT_IMAGE_PUBLIC_BASE;
    }

    function normalizeImageKey(imageUrl) {
        if (!imageUrl) {
            return '';
        }
        var key = String(imageUrl).trim();
        if (key.startsWith('http://') || key.startsWith('https://')) {
            try {
                key = new URL(key).pathname.replace(/^\/+/, '');
            } catch (_e) {
                return '';
            }
        } else {
            key = key.replace(/^\/+/, '');
        }
        return rewriteLegacyMenuImageKey(key);
    }

    function rewriteLegacyMenuImageKey(key) {
        if (!key || key.indexOf(MENU_ICON_PREFIX + '/') === 0) {
            return key;
        }
        for (var i = 0; i < LEGACY_SIZE_PREFIXES.length; i++) {
            var prefix = LEGACY_SIZE_PREFIXES[i];
            if (key.indexOf(prefix) === 0) {
                return MENU_ICON_PREFIX + '/' + key.substring(prefix.length);
            }
        }
        return key;
    }

    function buildMenuImageUrl(imageUrl, sizePrefix) {
        var key = normalizeImageKey(imageUrl);
        if (!key) {
            return '';
        }
        var base = imagePublicBase();
        if (key.indexOf('/') >= 0) {
            return base + '/' + key;
        }
        return base + '/' + MENU_ICON_PREFIX + '/' + key;
    }

    /** メニュー UUID / 画像キーから表示 URL */
    function getIcon(uuid) {
        return buildMenuImageUrl(uuid);
    }

    /** メニュー UUID / 画像キーから表示 URL（サイズ廃止・MenuIcon 統一） */
    function getMenuImageUrl(uuid, size) {
        return buildMenuImageUrl(uuid, size);
    }

    function buildMenuImageFallbackUrl(imageUrl, imageFallbackUrl, fallbackBase) {
        if (imageFallbackUrl) {
            return imageFallbackUrl;
        }
        var base = (fallbackBase || '').replace(/\/$/, '');
        if (!base) {
            var fromWindow = global.window && global.window._imageFallbackBaseUrl;
            if (typeof fromWindow === 'string' && fromWindow.trim()) {
                base = fromWindow.trim().replace(/\/$/, '');
            }
        }
        if (!base) {
            return '';
        }
        var key = normalizeImageKey(imageUrl);
        if (!key) {
            return '';
        }
        if (key.indexOf('/') >= 0) {
            return base + '/' + key;
        }
        return base + '/' + MENU_ICON_PREFIX + '/' + key;
    }

    global.MasterOrderMenuImage = {
        DEFAULT_IMAGE_PUBLIC_BASE: DEFAULT_IMAGE_PUBLIC_BASE,
        MENU_ICON_PREFIX: MENU_ICON_PREFIX,
        imagePublicBase: imagePublicBase,
        normalizeImageKey: normalizeImageKey,
        buildMenuImageUrl: buildMenuImageUrl,
        getIcon: getIcon,
        getMenuImageUrl: getMenuImageUrl,
        buildMenuImageFallbackUrl: buildMenuImageFallbackUrl
    };
})(typeof window !== 'undefined' ? window : globalThis);
