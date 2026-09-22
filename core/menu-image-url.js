/**
 * メニュー画像 URL（R2 カスタムドメイン）。
 * 正本キーのみ: menu/converted/{shopPublicId}/{file}
 * MenuIcon/ は発行しない（旧 URL は shopPublicId があるとき converted へ書き換え）。
 */
(function (global) {
    'use strict';

    var DEFAULT_IMAGE_PUBLIC_BASE = 'https://masterorder-assets.mcservers-wp.com';
    var MENU_CONVERTED_PREFIX = 'menu/converted';

    function imagePublicBase() {
        var fromConfig = global.window && global.window._imageBaseUrl;
        if (typeof fromConfig === 'string' && fromConfig.trim()) {
            return fromConfig.trim().replace(/\/$/, '');
        }
        return DEFAULT_IMAGE_PUBLIC_BASE;
    }

    function shopPublicId() {
        var fromConfig = global.window && global.window._shopPublicId;
        if (typeof fromConfig === 'string' && fromConfig.trim()) {
            return fromConfig.trim().toLowerCase();
        }
        return '';
    }

    function extractFileName(imageUrl) {
        if (!imageUrl) {
            return '';
        }
        var key = String(imageUrl).trim();
        if (key.indexOf('?') >= 0) {
            key = key.split('?', 2)[0];
        }
        if (key.startsWith('http://') || key.startsWith('https://')) {
            try {
                key = new URL(key).pathname.replace(/^\/+/, '');
            } catch (_e) {
                return '';
            }
        } else {
            key = key.replace(/^\/+/, '');
        }
        var slash = key.lastIndexOf('/');
        return slash >= 0 ? key.substring(slash + 1) : key;
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
        if (key.indexOf('?') >= 0) {
            key = key.split('?', 2)[0];
        }
        if (key.indexOf(MENU_CONVERTED_PREFIX + '/') === 0) {
            return key;
        }
        // 旧 MenuIcon / large|medium|small → ファイル名だけ残し、組み立ては shopPublicId 必須
        if (key.indexOf('MenuIcon/') === 0) {
            return key.substring('MenuIcon/'.length).replace(/^(large|medium|small)\//, '');
        }
        if (key.indexOf('large/') === 0 || key.indexOf('medium/') === 0 || key.indexOf('small/') === 0) {
            return key.replace(/^(large|medium|small)\//, '');
        }
        return key;
    }

    /** 公開キー候補（menu/converted のみ） */
    function menuImageCandidateKeys(imageUrl) {
        var normalized = normalizeImageKey(imageUrl);
        if (!normalized) {
            return [];
        }
        if (normalized.indexOf(MENU_CONVERTED_PREFIX + '/') === 0) {
            return [normalized];
        }
        if (normalized.indexOf('/') >= 0) {
            // 未知のパスは出さない（MenuIcon 等）
            var fileFromPath = extractFileName(normalized);
            var sidPath = shopPublicId();
            if (sidPath && fileFromPath) {
                return [MENU_CONVERTED_PREFIX + '/' + sidPath + '/' + fileFromPath];
            }
            return [];
        }
        var file = extractFileName(normalized) || normalized;
        var sid = shopPublicId();
        if (!sid || !file) {
            return [];
        }
        return [MENU_CONVERTED_PREFIX + '/' + sid + '/' + file];
    }

    function toThumbFileName(file) {
        if (!file || /\.thumb\.[a-z0-9]+$/i.test(file)) {
            return file;
        }
        return file.replace(/(\.[a-z0-9]+)$/i, '.thumb$1');
    }

    function toDetailFileName(file) {
        if (!file) {
            return file;
        }
        return file.replace(/\.thumb(\.[a-z0-9]+)$/i, '$1');
    }

    function wantsThumb(sizePrefix) {
        var size = String(sizePrefix || '').toLowerCase();
        return size === 'small' || size === 'thumb' || size === '256';
    }

    function wantsDetail(sizePrefix) {
        var size = String(sizePrefix || '').toLowerCase();
        return size === 'large' || size === 'detail' || size === '800';
    }

    /** パスだけ。版はファイル名の -v に置く。 */
    function applyMenuImageSize(url, sizePrefix) {
        if (!url) {
            return '';
        }
        var path = String(url).split('?')[0].split('#')[0];
        var slash = path.lastIndexOf('/');
        var file = slash >= 0 ? path.substring(slash + 1) : path;
        var prefix = slash >= 0 ? path.substring(0, slash + 1) : '';
        if (wantsThumb(sizePrefix)) {
            file = toThumbFileName(file);
        } else if (wantsDetail(sizePrefix)) {
            file = toDetailFileName(file);
        }
        return prefix + file;
    }

    function buildMenuImageUrl(imageUrl, sizePrefix) {
        var candidates = menuImageCandidateKeys(imageUrl);
        if (!candidates.length) {
            return '';
        }
        return applyMenuImageSize(imagePublicBase() + '/' + candidates[0], sizePrefix);
    }

    function getIcon(uuid) {
        return buildMenuImageUrl(uuid, 'thumb');
    }

    function getMenuImageUrl(uuid, size) {
        return buildMenuImageUrl(uuid, size);
    }

    function buildMenuImageFallbackUrl(imageUrl, imageFallbackUrl, fallbackBase) {
        if (imageFallbackUrl) {
            return imageFallbackUrl;
        }
        void imageUrl;
        void fallbackBase;
        // レガシー MenuIcon fallback は廃止
        return '';
    }

    function applyMenuImage(img, imageUrl) {
        if (!img) {
            return;
        }
        var url = buildMenuImageUrl(imageUrl);
        if (!url) {
            img.removeAttribute('src');
            return;
        }
        img.onerror = null;
        img.src = url;
    }

    global.MasterOrderMenuImage = {
        DEFAULT_IMAGE_PUBLIC_BASE: DEFAULT_IMAGE_PUBLIC_BASE,
        MENU_CONVERTED_PREFIX: MENU_CONVERTED_PREFIX,
        imagePublicBase: imagePublicBase,
        applyMenuImageSize: applyMenuImageSize,
        normalizeImageKey: normalizeImageKey,
        menuImageCandidateKeys: menuImageCandidateKeys,
        buildMenuImageUrl: buildMenuImageUrl,
        getIcon: getIcon,
        getMenuImageUrl: getMenuImageUrl,
        buildMenuImageFallbackUrl: buildMenuImageFallbackUrl,
        applyMenuImage: applyMenuImage
    };
})(typeof window !== 'undefined' ? window : globalThis);
