/**
 * MasterOrder Staff QR SDK — セッション / 固定 QR の生成・遅延読込。
 *
 * 依存: qrcode.js（グローバル QRCode）
 * グローバル: MasterOrderStaffQrSdk
 */
(function (global) {
    'use strict';

    var SDK_VERSION = '1.1.1';
    var DEFAULT_QR_PX = 184;

    function resolveCardPassPhrase(card) {
        var kitei = global.MasterOrderStaffKiteiSdk;
        if (kitei && typeof kitei.getSeatCardPassPhrase === 'function') {
            var fromMap = kitei.getSeatCardPassPhrase(card);
            if (fromMap) {
                return String(fromMap);
            }
        }
        return card && card.dataset ? String(card.dataset.qrPassPhrase || '') : '';
    }

    function rememberCardPassPhrase(card, passPhrase) {
        var kitei = global.MasterOrderStaffKiteiSdk;
        if (kitei && typeof kitei.setSeatCardPassPhrase === 'function') {
            kitei.setSeatCardPassPhrase(card, passPhrase);
            if (card && card.dataset) {
                delete card.dataset.qrPassPhrase;
            }
            return;
        }
        if (card && card.dataset) {
            card.dataset.qrPassPhrase = String(passPhrase);
        }
    }

    function displayPathSlug(value) {
        var raw = String(value || '').trim();
        if (!raw) {
            return '';
        }
        var cleaned = raw.replace(/[/\\?#%\u0000-\u001F\u007F]/g, '');
        cleaned = cleaned.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        return cleaned;
    }

    function normalizeGuestRouteSlugSegment(segment) {
        var raw = String(segment || '').trim();
        if (!raw) {
            return '';
        }
        try {
            return decodeURIComponent(raw);
        } catch (_) {
            return raw;
        }
    }

    function parseShopSlugFromGuestPath(pathname) {
        var parts = String(pathname || '/').split('/').filter(Boolean);
        if (parts.length >= 2 && String(parts[0]).toLowerCase() === 'shop') {
            return displayPathSlug(normalizeGuestRouteSlugSegment(parts[1]));
        }
        return '';
    }

    function staffQrShopMatches(scannedSlug, currentSlug) {
        var scanned = displayPathSlug(scannedSlug);
        var current = displayPathSlug(currentSlug);
        if (!scanned || !current) {
            return false;
        }
        return scanned.toLowerCase() === current.toLowerCase();
    }

    /**
     * スタッフがカメラで読んだ QR を分類する。来客 open には使わない。
     * @returns {null|{kind:string,shopSlug?:string,tableNo?:number,passPhrase?:string,sessionId?:string,pin?:string,joinToken?:string}}
     */
    function parseStaffQrScanText(raw) {
        var text = String(raw || '').trim();
        if (!text) {
            return null;
        }
        var parsed = null;
        try {
            parsed = new URL(text, 'https://order.local');
        } catch (_) {
            parsed = null;
        }
        var shopSlug = parsed ? parseShopSlugFromGuestPath(parsed.pathname) : '';
        var params = parsed ? parsed.searchParams : null;
        var hashBody = parsed ? String(parsed.hash || '').replace(/^#/, '') : '';
        var hashParams = new URLSearchParams(hashBody.charAt(0) === '?' ? hashBody : (hashBody ? '?' + hashBody : ''));

        function param(name) {
            var fromSearch = params ? String(params.get(name) || '').trim() : '';
            if (fromSearch) {
                return fromSearch;
            }
            return String(hashParams.get(name) || '').trim();
        }

        var tableNo = Number(param('tableNo') || param('table') || 0);
        if (!(tableNo > 0) && parsed) {
            var pathParts = String(parsed.pathname || '').split('/').filter(Boolean);
            if (pathParts.length >= 3
                    && String(pathParts[0]).toLowerCase() === 'shop'
                    && /^\d+$/.test(pathParts[2])) {
                tableNo = Number(pathParts[2]);
            }
        }
        var passPhrase = param('passPhrase');
        if (tableNo > 0 && passPhrase) {
            return {
                kind: 'fixed',
                tableNo: tableNo,
                passPhrase: passPhrase,
                shopSlug: shopSlug
            };
        }
        var joinToken = param('join');
        if (joinToken) {
            return { kind: 'join', joinToken: joinToken, shopSlug: shopSlug };
        }
        var sessionId = param('id') || param('sessionId') || param('session');
        var pin = param('pass') || param('pin');
        if (sessionId && pin) {
            return {
                kind: 'credentials',
                sessionId: sessionId,
                pin: pin,
                shopSlug: shopSlug
            };
        }
        if (sessionId) {
            return { kind: 'session', sessionId: sessionId, shopSlug: shopSlug };
        }
        if (parsed) {
            var parts = String(parsed.pathname || '').split('/').filter(Boolean);
            var i;
            for (i = parts.length - 1; i >= 0; i -= 1) {
                var part = parts[i];
                if (/^[0-9a-fA-F-]{8,}$/.test(part) && part.indexOf('-') >= 0) {
                    return { kind: 'session', sessionId: part, shopSlug: shopSlug };
                }
            }
        }
        if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(text)) {
            return { kind: 'session', sessionId: text, shopSlug: '' };
        }
        return null;
    }

    function tableQrToDataUrl(tableEl, width, height) {
        if (!tableEl || !tableEl.rows || !tableEl.rows.length) {
            return '';
        }
        var rows = tableEl.rows;
        var nRow = rows.length;
        var nCol = rows[0].cells.length;
        var canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext('2d');
        var cw = width / nCol;
        var ch = height / nRow;
        var r;
        var c;
        for (r = 0; r < nRow; r++) {
            for (c = 0; c < nCol; c++) {
                var td = rows[r].cells[c];
                var bg = td && td.style && td.style.backgroundColor
                    ? td.style.backgroundColor
                    : '#ffffff';
                ctx.fillStyle = bg;
                ctx.fillRect(Math.floor(c * cw), Math.floor(r * ch), Math.ceil(cw), Math.ceil(ch));
            }
        }
        try {
            return canvas.toDataURL('image/png');
        } catch (e) {
            return '';
        }
    }

    function createSimpleSet() {
        var keys = {};
        return {
            has: function (key) {
                return Object.prototype.hasOwnProperty.call(keys, key);
            },
            add: function (key) {
                keys[key] = true;
            },
            delete: function (key) {
                delete keys[key];
            },
            clear: function () {
                keys = {};
            }
        };
    }

    function createSimpleMap() {
        var store = {};
        return {
            has: function (key) {
                return Object.prototype.hasOwnProperty.call(store, key);
            },
            get: function (key) {
                return store[key];
            },
            set: function (key, value) {
                store[key] = value;
            }
        };
    }

    /**
     * @param {{ getShopId: function(): *, getShopSlug?: function(): string, getOrderPublicBase: function(): string, isSessionsTabActive?: function(): boolean, qrPx?: number }} options
     */
    function createStaffQrService(options) {
        options = options || {};
        var getShopId = options.getShopId;
        var getShopSlug = options.getShopSlug;
        var getOrderPublicBase = options.getOrderPublicBase;
        var isSessionsTabActive = typeof options.isSessionsTabActive === 'function'
            ? options.isSessionsTabActive
            : function () {
                return true;
            };
        var qrPx = options.qrPx > 0 ? options.qrPx : DEFAULT_QR_PX;

        var sessionQrCache = createSimpleMap();

        var sessionCardQrLoadQueue = [];
        var sessionCardQrQueuedKeys = createSimpleSet();
        var sessionCardQrPumpScheduled = false;

        var fixedQrLoadQueue = [];
        var fixedQrLoadQueuedKeys = createSimpleSet();
        var fixedQrLoadPumpScheduled = false;
        var fixedQrIntersectionObserver = null;
        var tableSeatQrFinalizeTimer = null;

        var GUEST_SHOP_PATH_PREFIX = '/Shop';

        function normalizeGuestOrderOrigin(base) {
            var raw = String(base || '').trim();
            if (!raw) {
                return '';
            }
            try {
                var url = new URL(raw.indexOf('://') >= 0 ? raw : 'https://' + raw);
                var path = url.pathname.replace(/\/+$/, '');
                if (/^\/(index2|index2\.html|index|index\.html|connect|scan)$/i.test(path)) {
                    path = '';
                }
                return url.origin + (path || '');
            } catch (_ignored) {
                return raw.replace(/\/(index2|index2\.html|index|connect|scan)\/?$/i, '');
            }
        }

        function buildShopScopedGuestPath(shopSlug) {
            var slug = displayPathSlug(shopSlug) || String(shopSlug || '').trim();
            if (!slug) {
                return '';
            }
            return GUEST_SHOP_PATH_PREFIX + '/' + encodeURIComponent(slug) + '/';
        }

        function buildShopScopedGuestUrl(shopSlug, sessionId, entryPin) {
            var path = buildShopScopedGuestPath(shopSlug);
            if (!path || !sessionId || !entryPin) {
                return path;
            }
            var params = new URLSearchParams();
            params.set('id', String(sessionId).trim());
            params.set('pass', String(entryPin).trim().toUpperCase());
            return path + '?' + params.toString();
        }

        function buildShopScopedScanPath(shopSlug) {
            return buildShopScopedGuestPath(shopSlug);
        }

        function buildShopScopedScanUrl(shopSlug, sessionId, entryPin) {
            return buildShopScopedGuestUrl(shopSlug, sessionId, entryPin);
        }

        function buildOrderJoinUrl(sessionId, entryPin, joinToken) {
            var base = normalizeGuestOrderOrigin(
                typeof getOrderPublicBase === 'function' ? getOrderPublicBase() : ''
            );
            if (!base) {
                return '';
            }
            var shopSlug = typeof getShopSlug === 'function' ? String(getShopSlug() || '').trim() : '';
            if (!shopSlug) {
                return '';
            }
            var sid = String(sessionId || '').trim();
            var pin = String(entryPin || '').trim().toUpperCase();
            if (sid && pin) {
                return base.replace(/\/$/, '') + buildShopScopedGuestUrl(shopSlug, sid, pin);
            }
            var token = String(joinToken || '').trim();
            if (token) {
                var joinParams = new URLSearchParams();
                joinParams.set('join', token);
                return base.replace(/\/$/, '') + buildShopScopedGuestPath(shopSlug) + '?' + joinParams.toString();
            }
            return base.replace(/\/$/, '') + buildShopScopedGuestPath(shopSlug);
        }

        function buildFixedQrConnectUrl(tableNo, passPhrase) {
            var base = normalizeGuestOrderOrigin(
                typeof getOrderPublicBase === 'function' ? getOrderPublicBase() : ''
            );
            var shopSlug = typeof getShopSlug === 'function' ? String(getShopSlug() || '').trim() : '';
            if (!base || !shopSlug || !tableNo || !passPhrase) {
                return '';
            }
            var path = buildShopScopedGuestPath(shopSlug);
            var params = new URLSearchParams();
            params.set('tableNo', String(tableNo));
            params.set('passPhrase', String(passPhrase).trim());
            return base.replace(/\/$/, '') + path + '?' + params.toString();
        }

        function sessionQrCacheKey(sessionId, entryPin) {
            return String(sessionId || '') + '|' + String(entryPin || '').trim().toUpperCase();
        }

        function fixedQrCacheKey(tableNo, passPhrase, connectUrl) {
            var url = String(connectUrl || '').trim();
            if (url) {
                return 'u|' + url;
            }
            var shopId = typeof getShopId === 'function' ? getShopId() : '';
            return String(shopId || '') + '|' + String(tableNo || '') + '|' + String(passPhrase || '');
        }

        function createSessionQrLoadingEl() {
            var loading = document.createElement('div');
            loading.className = 'session-qr-loading';
            loading.setAttribute('aria-live', 'polite');
            var label = document.createElement('div');
            label.className = 'session-qr-loading-label';
            label.textContent = '読み込み中...';
            var track = document.createElement('div');
            track.className = 'session-qr-loading-track';
            var bar = document.createElement('div');
            bar.className = 'session-qr-loading-bar';
            track.appendChild(bar);
            loading.appendChild(label);
            loading.appendChild(track);
            return loading;
        }

        function hideQrLoadingOverlay(qrWrap) {
            if (!qrWrap) {
                return;
            }
            qrWrap.classList.remove('session-qr-wrap--loading');
            qrWrap.classList.remove('table-seat-action-qr--loading');
            var nodes = qrWrap.querySelectorAll('.session-qr-loading');
            var i;
            for (i = 0; i < nodes.length; i++) {
                nodes[i].remove();
            }
        }

        function showQrLoadingOverlay(qrWrap) {
            if (!qrWrap) {
                return;
            }
            hideQrLoadingOverlay(qrWrap);
            qrWrap.classList.add('session-qr-wrap--loading');
            qrWrap.appendChild(createSessionQrLoadingEl());
        }

        function resolveQrCorrectLevel(QRCodeLib) {
            if (QRCodeLib && QRCodeLib.CorrectLevel && typeof QRCodeLib.CorrectLevel.M !== 'undefined') {
                return QRCodeLib.CorrectLevel.M;
            }
            return 0;
        }

        function extractQrDataUrlFromHolder(holder) {
            if (!holder) {
                return '';
            }
            var canvas = holder.querySelector('canvas');
            if (canvas && canvas.width > 0 && canvas.height > 0) {
                try {
                    var fromCanvas = canvas.toDataURL('image/png');
                    if (fromCanvas && fromCanvas.length > 64) {
                        return fromCanvas;
                    }
                } catch (_canvasErr) {
                    /* fall through */
                }
            }
            var tableEl = holder.querySelector('table');
            if (tableEl) {
                var fromTable = tableQrToDataUrl(tableEl, qrPx, qrPx);
                if (fromTable && fromTable.length > 64) {
                    return fromTable;
                }
            }
            var innerImg = holder.querySelector('img');
            if (innerImg && innerImg.src && innerImg.src.indexOf('data:image') === 0 && innerImg.src.length > 64) {
                return innerImg.src;
            }
            return '';
        }

        function createQrRenderHolder() {
            var holder = document.createElement('div');
            holder.setAttribute('aria-hidden', 'true');
            holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + qrPx + 'px;height:'
                + qrPx + 'px;overflow:hidden;opacity:0;pointer-events:none;';
            return holder;
        }

        function renderQrIntoHolder(holder, QRCodeLib, qrOptions, forceTableMode) {
            var savedCtx = global.CanvasRenderingContext2D;
            if (forceTableMode && savedCtx) {
                try {
                    delete global.CanvasRenderingContext2D;
                } catch (_deleteErr) {
                    global.CanvasRenderingContext2D = undefined;
                }
            }
            try {
                new QRCodeLib(holder, qrOptions);
                return extractQrDataUrlFromHolder(holder);
            } finally {
                if (forceTableMode && savedCtx) {
                    global.CanvasRenderingContext2D = savedCtx;
                }
            }
        }

        function generateQrDataUrlFromText(text) {
            var QRCodeLib = global.QRCode;
            var payload = String(text || '').trim();
            if (!payload || typeof QRCodeLib !== 'function') {
                return '';
            }
            var qrOptions = {
                text: payload,
                width: qrPx,
                height: qrPx,
                colorDark: '#000000',
                colorLight: '#ffffff',
                correctLevel: resolveQrCorrectLevel(QRCodeLib)
            };
            var holder = createQrRenderHolder();
            document.body.appendChild(holder);
            var dataUrl = '';
            try {
                dataUrl = renderQrIntoHolder(holder, QRCodeLib, qrOptions, true);
                if (!dataUrl) {
                    holder.replaceChildren();
                    dataUrl = renderQrIntoHolder(holder, QRCodeLib, qrOptions, false);
                }
            } catch (_qrErr) {
                dataUrl = '';
            } finally {
                holder.remove();
            }
            return dataUrl;
        }

        function generateSessionQrDataUrl(url) {
            return generateQrDataUrlFromText(url);
        }

        function applySessionQrToElements(imgEl, captionEl, dataUrl) {
            if (!imgEl || !dataUrl) {
                return false;
            }
            imgEl.src = dataUrl;
            imgEl.style.display = '';
            imgEl.style.visibility = '';
            if (captionEl) {
                captionEl.style.display = '';
                captionEl.style.visibility = '';
            }
            var qrWrap = imgEl.closest ? imgEl.closest('.session-qr-wrap') : null;
            if (qrWrap) {
                hideQrLoadingOverlay(qrWrap);
            }
            return true;
        }

        function enqueueSessionCardQrLoad(job) {
            if (!job || !job.imgEl) {
                return;
            }
            var cacheKey = job.cacheKey || sessionQrCacheKey(job.sessionId, job.entryPin);
            if (sessionQrCache.has(cacheKey)) {
                applySessionQrToElements(job.imgEl, job.captionEl, sessionQrCache.get(cacheKey));
                return;
            }
            if (sessionCardQrQueuedKeys.has(cacheKey)) {
                if (sessionQrCache.has(cacheKey)) {
                    applySessionQrToElements(job.imgEl, job.captionEl, sessionQrCache.get(cacheKey));
                }
                return;
            }
            sessionCardQrQueuedKeys.add(cacheKey);
            var queuedJob = Object.assign({}, job, { cacheKey: cacheKey });
            var tableNo = Number(queuedJob.tableNo || 0);
            if (Number.isFinite(tableNo) && tableNo > 0) {
                queuedJob.tableNo = tableNo;
            } else {
                queuedJob.tableNo = 0;
            }
            var insertAt = sessionCardQrLoadQueue.length;
            if (queuedJob.tableNo > 0) {
                for (var i = 0; i < sessionCardQrLoadQueue.length; i += 1) {
                    var existingTableNo = Number(sessionCardQrLoadQueue[i] && sessionCardQrLoadQueue[i].tableNo || 0);
                    if ((existingTableNo <= 0) || existingTableNo > queuedJob.tableNo) {
                        insertAt = i;
                        break;
                    }
                }
            }
            sessionCardQrLoadQueue.splice(insertAt, 0, queuedJob);
            if (sessionCardQrPumpScheduled) {
                return;
            }
            sessionCardQrPumpScheduled = true;
            var staleQrSkips = 0;

            function pump() {
                sessionCardQrPumpScheduled = false;
                var next = sessionCardQrLoadQueue.shift();
                if (!next) {
                    staleQrSkips = 0;
                    return;
                }
                sessionCardQrQueuedKeys.delete(next.cacheKey);
                if (!next.imgEl || !next.imgEl.isConnected) {
                    staleQrSkips += 1;
                    if (staleQrSkips > 64 || !sessionCardQrLoadQueue.length) {
                        staleQrSkips = 0;
                        return;
                    }
                    sessionCardQrPumpScheduled = true;
                    global.setTimeout(pump, 0);
                    return;
                }
                staleQrSkips = 0;
                var qrWrap = next.imgEl.closest ? next.imgEl.closest('.session-qr-wrap') : null;
                if (qrWrap) {
                    showQrLoadingOverlay(qrWrap);
                }

                function runGenerate() {
                    if (!next.imgEl || !next.imgEl.isConnected) {
                        if (qrWrap) {
                            hideQrLoadingOverlay(qrWrap);
                        }
                        return;
                    }
                    var dataUrl = sessionQrCache.get(next.cacheKey);
                    if (!dataUrl) {
                        dataUrl = generateSessionQrDataUrl(next.url);
                        if (dataUrl) {
                            sessionQrCache.set(next.cacheKey, dataUrl);
                        }
                    }
                    if (!dataUrl) {
                        next.imgEl.style.display = 'none';
                        next.imgEl.removeAttribute('src');
                        if (next.captionEl) {
                            next.captionEl.style.display = 'none';
                        }
                        if (qrWrap) {
                            hideQrLoadingOverlay(qrWrap);
                        }
                        return;
                    }
                    applySessionQrToElements(next.imgEl, next.captionEl, dataUrl);
                }

                if (typeof global.requestIdleCallback === 'function') {
                    global.requestIdleCallback(runGenerate, { timeout: 800 });
                } else {
                    global.setTimeout(runGenerate, 0);
                }
                global.setTimeout(pump, 220);
            }

            global.setTimeout(pump, 0);
        }

        function stopSessionCardQrLoads() {
            sessionCardQrLoadQueue.length = 0;
            sessionCardQrQueuedKeys.clear();
            sessionCardQrPumpScheduled = false;
        }

        function generateFixedQrDataUrl(tableNo, passPhrase, connectUrl) {
            var url = String(connectUrl || '').trim();
            if (!url) {
                url = buildFixedQrConnectUrl(tableNo, passPhrase);
            }
            return generateQrDataUrlFromText(url);
        }

        function applyFixedQrToWrap(qrWrap, qrImg, qrCaption, tableNo, passPhrase, connectUrl) {
            var cacheKey = fixedQrCacheKey(tableNo, passPhrase, connectUrl);
            var dataUrl = sessionQrCache.get(cacheKey);
            if (!dataUrl) {
                dataUrl = generateFixedQrDataUrl(tableNo, passPhrase, connectUrl);
                if (dataUrl) {
                    sessionQrCache.set(cacheKey, dataUrl);
                }
            }
            hideQrLoadingOverlay(qrWrap);
            if (!dataUrl) {
                qrImg.style.display = 'none';
                qrImg.removeAttribute('src');
                if (qrCaption) {
                    qrCaption.style.display = '';
                    qrCaption.style.visibility = '';
                    var fixedUrl = String(connectUrl || '').trim() || buildFixedQrConnectUrl(tableNo, passPhrase);
                    if (!fixedUrl) {
                        qrCaption.textContent = '来客URLを組み立てできません';
                    } else if (typeof global.QRCode === 'undefined') {
                        qrCaption.textContent = 'QRライブラリを読み込めません';
                    } else {
                        qrCaption.textContent = 'QRを生成できません';
                    }
                }
                return false;
            }
            qrImg.src = dataUrl;
            qrImg.style.display = '';
            qrImg.style.visibility = '';
            if (qrCaption) {
                qrCaption.style.display = '';
                qrCaption.style.visibility = '';
            }
            var card = qrWrap.closest ? qrWrap.closest('.table-seat-card') : null;
            if (card) {
                card.removeAttribute('data-qr-pending');
            }
            return true;
        }

        function enqueueFixedQrLoad(job) {
            if (!isSessionsTabActive()) {
                return;
            }
            var connectUrl = job.connectUrl || '';
            var cacheKey = fixedQrCacheKey(job.tableNo, job.passPhrase, connectUrl);
            if (sessionQrCache.has(cacheKey) || fixedQrLoadQueuedKeys.has(cacheKey)) {
                if (job.qrWrap && job.qrWrap.isConnected && sessionQrCache.has(cacheKey)) {
                    applyFixedQrToWrap(job.qrWrap, job.qrImg, job.qrCaption, job.tableNo, job.passPhrase, connectUrl);
                }
                return;
            }
            fixedQrLoadQueuedKeys.add(cacheKey);
            fixedQrLoadQueue.push(job);
            if (fixedQrLoadPumpScheduled) {
                return;
            }
            fixedQrLoadPumpScheduled = true;

            function pump() {
                fixedQrLoadPumpScheduled = false;
                if (!isSessionsTabActive()) {
                    fixedQrLoadQueue.length = 0;
                    fixedQrLoadQueuedKeys.clear();
                    return;
                }
                var next = fixedQrLoadQueue.shift();
                if (!next) {
                    return;
                }
                var nextKey = fixedQrCacheKey(next.tableNo, next.passPhrase, next.connectUrl);
                fixedQrLoadQueuedKeys.delete(nextKey);
                var qrWrap = next.qrWrap;
                var qrImg = next.qrImg;
                var qrCaption = next.qrCaption;
                var tableNo = next.tableNo;
                var passPhrase = next.passPhrase;
                var nextConnectUrl = next.connectUrl || '';
                if (!qrWrap || !qrWrap.isConnected) {
                    pump();
                    return;
                }
                if (sessionQrCache.has(nextKey)) {
                    applyFixedQrToWrap(qrWrap, qrImg, qrCaption, tableNo, passPhrase, nextConnectUrl);
                    global.setTimeout(pump, 0);
                    return;
                }
                showQrLoadingOverlay(qrWrap);

                function runGenerate() {
                    if (!isSessionsTabActive()) {
                        hideQrLoadingOverlay(qrWrap);
                        return;
                    }
                    applyFixedQrToWrap(qrWrap, qrImg, qrCaption, tableNo, passPhrase, nextConnectUrl);
                }

                if (typeof global.requestIdleCallback === 'function') {
                    global.requestIdleCallback(runGenerate, { timeout: 900 });
                } else {
                    global.setTimeout(runGenerate, 0);
                }
                global.setTimeout(pump, 280);
            }

            global.setTimeout(pump, 0);
        }

        function initFixedQrIntersectionObserver() {
            if (fixedQrIntersectionObserver || typeof global.IntersectionObserver === 'undefined') {
                return;
            }
            fixedQrIntersectionObserver = new global.IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (!entry.isIntersecting) {
                        return;
                    }
                    var card = entry.target;
                    fixedQrIntersectionObserver.unobserve(card);
                    if (card.dataset.qrPending !== '1') {
                        return;
                    }
                    var tableNo = Number(card.dataset.qrTableNo || card.dataset.tableNo || 0);
                    var passPhrase = resolveCardPassPhrase(card);
                    var connectUrl = card.dataset.qrConnectUrl || '';
                    var qrWrap = card.querySelector('.session-qr-wrap');
                    var qrImg = card.querySelector('.session-qr-img');
                    var qrCaption = card.querySelector('.session-qr-caption');
                    if (!qrWrap || !qrImg || !passPhrase) {
                        card.removeAttribute('data-qr-pending');
                        return;
                    }
                    enqueueFixedQrLoad({
                        qrWrap: qrWrap,
                        qrImg: qrImg,
                        qrCaption: qrCaption,
                        tableNo: tableNo,
                        passPhrase: passPhrase,
                        connectUrl: connectUrl
                    });
                });
            }, { root: null, rootMargin: '120px 0px', threshold: 0.05 });
        }

        function scheduleLazyFixedQrForCard(card, tableNo, passPhrase, connectUrl) {
            if (!card || !passPhrase || !isSessionsTabActive()) {
                return;
            }
            var qrWrap = card.querySelector('.session-qr-wrap');
            var qrImg = card.querySelector('.session-qr-img');
            var qrCaption = card.querySelector('.session-qr-caption');
            if (!qrWrap || !qrImg) {
                return;
            }
            card.dataset.qrTableNo = String(tableNo || '');
            rememberCardPassPhrase(card, passPhrase);
            if (connectUrl) {
                card.dataset.qrConnectUrl = String(connectUrl);
            } else {
                delete card.dataset.qrConnectUrl;
            }
            var cacheKey = fixedQrCacheKey(tableNo, passPhrase, connectUrl);
            if (sessionQrCache.has(cacheKey)) {
                applyFixedQrToWrap(qrWrap, qrImg, qrCaption, tableNo, passPhrase, connectUrl);
                return;
            }
            if (card.dataset.qrObserved === '1') {
                return;
            }
            card.dataset.qrPending = '1';
            qrImg.style.visibility = 'hidden';
            if (qrCaption) {
                qrCaption.style.visibility = 'hidden';
            }
            initFixedQrIntersectionObserver();
            if (fixedQrIntersectionObserver) {
                card.dataset.qrObserved = '1';
                fixedQrIntersectionObserver.observe(card);
                return;
            }
            enqueueFixedQrLoad({
                qrWrap: qrWrap,
                qrImg: qrImg,
                qrCaption: qrCaption,
                tableNo: tableNo,
                passPhrase: passPhrase,
                connectUrl: connectUrl
            });
        }

        function finalizeTableSeatQrLoads(wrap) {
            if (!wrap || !isSessionsTabActive()) {
                return;
            }
            if (tableSeatQrFinalizeTimer) {
                global.clearTimeout(tableSeatQrFinalizeTimer);
            }
            tableSeatQrFinalizeTimer = global.setTimeout(function () {
                tableSeatQrFinalizeTimer = null;
                if (!wrap.isConnected || !isSessionsTabActive()) {
                    return;
                }
                initFixedQrIntersectionObserver();
                var cards = wrap.querySelectorAll('.table-seat-card[data-qr-pending="1"]:not([data-qr-observed="1"])');
                cards.forEach(function (card) {
                    if (fixedQrIntersectionObserver) {
                        card.dataset.qrObserved = '1';
                        fixedQrIntersectionObserver.observe(card);
                    } else {
                        var tableNo = Number(card.dataset.qrTableNo || card.dataset.tableNo || 0);
                        var passPhrase = resolveCardPassPhrase(card);
                        var connectUrl = card.dataset.qrConnectUrl || '';
                        scheduleLazyFixedQrForCard(card, tableNo, passPhrase, connectUrl);
                    }
                });
            }, 220);
        }

        function stopLazyFixedQrLoads() {
            fixedQrLoadQueue.length = 0;
            fixedQrLoadQueuedKeys.clear();
            fixedQrLoadPumpScheduled = false;
            if (tableSeatQrFinalizeTimer) {
                global.clearTimeout(tableSeatQrFinalizeTimer);
                tableSeatQrFinalizeTimer = null;
            }
            if (fixedQrIntersectionObserver) {
                fixedQrIntersectionObserver.disconnect();
                fixedQrIntersectionObserver = null;
            }
            document.querySelectorAll('.table-seat-card[data-qr-observed]').forEach(function (card) {
                card.removeAttribute('data-qr-observed');
            });
        }

        function renderSessionQrInto(imgEl, sessionId, entryPin, captionEl, joinToken, tableNo, options) {
            if (!imgEl) {
                return false;
            }
            options = options || {};
            var url = (options.url && String(options.url).trim())
                ? String(options.url).trim()
                : buildOrderJoinUrl(sessionId, entryPin, joinToken);
            if (!url) {
                imgEl.style.display = 'none';
                imgEl.removeAttribute('src');
                if (captionEl) {
                    captionEl.style.display = '';
                    captionEl.style.visibility = '';
                    captionEl.textContent = '来客URLを組み立てできません';
                }
                return false;
            }
            var cacheKey = sessionQrCacheKey(sessionId, entryPin);
            var cachedDataUrl = sessionQrCache.get(cacheKey);
            if (cachedDataUrl) {
                return applySessionQrToElements(imgEl, captionEl, cachedDataUrl);
            }
            if (options.immediate === true) {
                var immediateDataUrl = generateSessionQrDataUrl(url);
                if (!immediateDataUrl) {
                    imgEl.style.display = 'none';
                    imgEl.removeAttribute('src');
                    if (captionEl) {
                        captionEl.style.display = '';
                        captionEl.style.visibility = '';
                        captionEl.textContent = typeof global.QRCode === 'undefined'
                            ? 'QRライブラリを読み込めません'
                            : 'QRを生成できません';
                    }
                    return false;
                }
                sessionQrCache.set(cacheKey, immediateDataUrl);
                return applySessionQrToElements(imgEl, captionEl, immediateDataUrl);
            }
            imgEl.style.visibility = 'hidden';
            if (captionEl) {
                captionEl.style.visibility = 'hidden';
            }
            enqueueSessionCardQrLoad({
                imgEl: imgEl,
                captionEl: captionEl,
                sessionId: sessionId,
                entryPin: entryPin,
                cacheKey: cacheKey,
                url: url,
                tableNo: Number(tableNo || 0)
            });
            return true;
        }

        function renderFixedQrInto(imgEl, tableNo, passPhrase, captionEl, connectUrl) {
            if (!imgEl) {
                return;
            }
            var qrWrap = imgEl.closest ? imgEl.closest('.session-qr-wrap') : null;
            if (qrWrap) {
                applyFixedQrToWrap(qrWrap, imgEl, captionEl, tableNo, passPhrase, connectUrl);
                return;
            }
            var cacheKey = fixedQrCacheKey(tableNo, passPhrase, connectUrl);
            var cachedDataUrl = sessionQrCache.get(cacheKey);
            if (cachedDataUrl) {
                imgEl.src = cachedDataUrl;
                imgEl.style.display = '';
                imgEl.style.visibility = '';
                if (captionEl) {
                    captionEl.style.visibility = '';
                }
                return;
            }
            var dataUrl = generateFixedQrDataUrl(tableNo, passPhrase, connectUrl);
            if (dataUrl) {
                sessionQrCache.set(cacheKey, dataUrl);
                imgEl.src = dataUrl;
                imgEl.style.display = '';
                imgEl.style.visibility = '';
                if (captionEl) {
                    captionEl.style.visibility = '';
                }
            }
        }

        return {
            buildOrderJoinUrl: buildOrderJoinUrl,
            buildFixedQrConnectUrl: buildFixedQrConnectUrl,
            sessionQrCacheKey: sessionQrCacheKey,
            fixedQrCacheKey: fixedQrCacheKey,
            renderSessionQrInto: renderSessionQrInto,
            renderSessionQrIntoImmediate: function (imgEl, sessionId, entryPin, captionEl, joinToken, tableNo, urlOverride) {
                var opts = { immediate: true };
                if (urlOverride && String(urlOverride).trim()) {
                    opts.url = String(urlOverride).trim();
                }
                return renderSessionQrInto(imgEl, sessionId, entryPin, captionEl, joinToken, tableNo, opts);
            },
            renderFixedQrInto: renderFixedQrInto,
            applyFixedQrToWrap: applyFixedQrToWrap,
            scheduleLazyFixedQrForCard: scheduleLazyFixedQrForCard,
            finalizeTableSeatQrLoads: finalizeTableSeatQrLoads,
            stopSessionCardQrLoads: stopSessionCardQrLoads,
            stopLazyFixedQrLoads: stopLazyFixedQrLoads,
            hideQrLoadingOverlay: hideQrLoadingOverlay
        };
    }

    global.MasterOrderStaffQrSdk = {
        VERSION: SDK_VERSION,
        DEFAULT_QR_PX: DEFAULT_QR_PX,
        createStaffQrService: createStaffQrService,
        tableQrToDataUrl: tableQrToDataUrl,
        parseStaffQrScanText: parseStaffQrScanText,
        parseShopSlugFromGuestPath: parseShopSlugFromGuestPath,
        staffQrShopMatches: staffQrShopMatches
    };
})(typeof window !== 'undefined' ? window : globalThis);
