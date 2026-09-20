/**
 * MasterOrder Staff KITEI (固定QR) 卓席 UI SDK
 *
 * 依存: api-routes.js → core-sdk.js → order-sdk.js → staff-kitei-table-sdk.js
 * グローバル: MasterOrderStaffKiteiSdk
 */
(function (global) {
    'use strict';

    var SDK_VERSION = '1.3.7';
    var FILTER_HIDDEN_CLASS = 'table-seat-filter-hidden';
    var tableSeatElapsedTimerId = null;
    var tableSeatElapsedTimerRoot = null;
    var core = global.MasterOrderCoreSdk;
    /** XSS: PIN / 固定QR passphrase を data-* に載せない */
    var seatCardSecrets = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

    function secretHint(value) {
        var s = String(value || '');
        if (!s) {
            return '';
        }
        var h = 5381;
        for (var i = 0; i < s.length; i++) {
            h = ((h << 5) + h + s.charCodeAt(i)) | 0;
        }
        return String(h);
    }

    function getSeatCardSecrets(card) {
        if (!card || !seatCardSecrets) {
            return {};
        }
        return seatCardSecrets.get(card) || {};
    }

    function patchSeatCardSecrets(card, patch) {
        if (!card || !seatCardSecrets) {
            return;
        }
        var prev = seatCardSecrets.get(card) || {};
        var next = {
            entryPin: patch.entryPin !== undefined ? (patch.entryPin || '') : (prev.entryPin || ''),
            passPhrase: patch.passPhrase !== undefined ? (patch.passPhrase || '') : (prev.passPhrase || '')
        };
        if (!next.entryPin && !next.passPhrase) {
            seatCardSecrets.delete(card);
            return;
        }
        if (!next.entryPin) {
            delete next.entryPin;
        } else {
            next.entryPin = String(next.entryPin);
        }
        if (!next.passPhrase) {
            delete next.passPhrase;
        } else {
            next.passPhrase = String(next.passPhrase);
        }
        seatCardSecrets.set(card, next);
    }

    function setSeatCardEntryPin(card, entryPin) {
        patchSeatCardSecrets(card, { entryPin: entryPin || '' });
    }

    function getSeatCardEntryPin(card) {
        var s = getSeatCardSecrets(card);
        return s.entryPin ? String(s.entryPin) : '';
    }

    function setSeatCardPassPhrase(card, passPhrase) {
        patchSeatCardSecrets(card, { passPhrase: passPhrase || '' });
    }

    function getSeatCardPassPhrase(card) {
        var s = getSeatCardSecrets(card);
        if (s.passPhrase) {
            return String(s.passPhrase);
        }
        if (card && card.dataset && card.dataset.qrPassPhrase) {
            return String(card.dataset.qrPassPhrase);
        }
        return '';
    }

    function formatSeatAmount(amount) {
        var value = Number(amount || 0);
        return value.toLocaleString('ja-JP') + ' 円';
    }

    /** サーバー startTime（ISO / Firestore）を epoch ms に正規化。経過時間はローカルで Date.now() との差分。 */
    function parseSessionStartMillis(value) {
        if (value == null || value === '') {
            return null;
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value > 1e12 ? Math.floor(value) : Math.floor(value * 1000);
        }
        if (core && typeof core.parseApiDateTime === 'function') {
            var parsed = core.parseApiDateTime(value);
            if (parsed && !Number.isNaN(parsed.getTime())) {
                return parsed.getTime();
            }
        }
        var raw = String(value).trim().replace(' ', 'T');
        if (!raw) {
            return null;
        }
        var hasOffset = /(?:Z|[+\-]\d{2}:\d{2})$/i.test(raw);
        var suffix = '+09:00';
        if (core && typeof core.apiLocalDateTimeOffsetSuffix === 'function') {
            suffix = core.apiLocalDateTimeOffsetSuffix();
        }
        var d = new Date(hasOffset ? raw : raw + suffix);
        return Number.isNaN(d.getTime()) ? null : d.getTime();
    }

    function formatElapsedSinceStart(startTimeOrMs) {
        var ms = typeof startTimeOrMs === 'number'
            ? startTimeOrMs
            : parseSessionStartMillis(startTimeOrMs);
        if (ms == null) {
            return '—';
        }
        var sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
        var h = Math.floor(sec / 3600);
        var m = Math.floor((sec % 3600) / 60);
        var s = sec % 60;
        if (h > 0) {
            return h + 'h ' + String(m).padStart(2, '0') + 'm';
        }
        return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }

    function formatSeatElapsedLabel(startTime, formatElapsed) {
        if (!startTime) {
            return '—';
        }
        if (typeof formatElapsed === 'function') {
            var legacy = formatElapsed(startTime);
            if (legacy && legacy !== '-') {
                return legacy;
            }
        }
        return formatElapsedSinceStart(startTime);
    }

    function setElapsedNodeStartTime(node, startTime) {
        if (!node) {
            return;
        }
        var ms = parseSessionStartMillis(startTime);
        if (ms == null) {
            delete node.dataset.sessionStart;
            delete node.dataset.sessionStartMs;
            return;
        }
        node.dataset.sessionStartMs = String(ms);
        node.dataset.sessionStart = startTime != null ? String(startTime).trim() : new Date(ms).toISOString();
    }

    function syncTableSeatCardElapsed(card, seat) {
        if (!card || !seat) {
            return;
        }
        var elapsed = card.querySelector('.table-seat-card-v2__elapsed');
        if (!elapsed) {
            return;
        }
        var isUsing = String(seat.status || '').toUpperCase() === 'USING';
        if (!isUsing || !seat.startTime) {
            delete elapsed.dataset.sessionStartMs;
            elapsed.dataset.sessionStart = '';
            elapsed.textContent = '経過時間 —';
            return;
        }
        setElapsedNodeStartTime(elapsed, seat.startTime);
        elapsed.textContent = '経過時間 ' + formatElapsedSinceStart(seat.startTime);
    }

    function refreshTableSeatElapsedLabels(root) {
        var scope = root && typeof root.querySelectorAll === 'function' ? root : document;
        var nodes = scope.querySelectorAll('.table-seat-card-v2__elapsed');
        for (var i = 0; i < nodes.length; i += 1) {
            var node = nodes[i];
            var ms = node.dataset.sessionStartMs;
            var label = ms
                ? formatElapsedSinceStart(Number(ms))
                : formatElapsedSinceStart(node.dataset.sessionStart);
            node.textContent = '経過時間 ' + label;
        }
    }

    function startTableSeatElapsedTimer(options) {
        var opts = options || {};
        var root = opts.root || null;
        var intervalMs = opts.intervalMs > 0 ? opts.intervalMs : 5000;
        if (tableSeatElapsedTimerId !== null) {
            global.clearInterval(tableSeatElapsedTimerId);
        }
        tableSeatElapsedTimerRoot = root;
        function tick() {
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
                return;
            }
            refreshTableSeatElapsedLabels(root);
        }
        tick();
        tableSeatElapsedTimerId = global.setInterval(tick, intervalMs);
    }

    function ensureTableSeatElapsedTimer(options) {
        var opts = options || {};
        var root = opts.root || null;
        if (tableSeatElapsedTimerId !== null) {
            refreshTableSeatElapsedLabels(root || tableSeatElapsedTimerRoot);
            return;
        }
        startTableSeatElapsedTimer(opts);
    }

    function stopTableSeatElapsedTimer() {
        if (tableSeatElapsedTimerId !== null) {
            global.clearInterval(tableSeatElapsedTimerId);
            tableSeatElapsedTimerId = null;
        }
        tableSeatElapsedTimerRoot = null;
    }

    function tableSeatStateKey(seat) {
        return [
            String(seat.tableNo || ''),
            String(seat.status || '').toUpperCase(),
            String(seat.currentSessionId || ''),
            String(seat.activePeoples != null ? seat.activePeoples : ''),
            String(seat.peoplesConfirmed === false ? '0' : '1'),
            secretHint(seat.entryPin),
            secretHint(seat.joinToken),
            String((seat.partyFlags && seat.partyFlags.family) ? '1' : '0'),
            String((seat.partyFlags && seat.partyFlags.couple) ? '1' : '0'),
            String((seat.partyFlags && seat.partyFlags.companions) ? '1' : '0')
        ].join('|');
    }

    function tableSeatLayoutKey(seat) {
        return 'k|' + String(seat.tableNo || '') + '|' + secretHint(seat.passPhrase);
    }

    function tableSeatLiveKey(seat) {
        return [
            String(seat.status || '').toUpperCase(),
            String(seat.currentSessionId || ''),
            String(seat.activePeoples != null ? seat.activePeoples : ''),
            String(seat.peoplesConfirmed === false ? '0' : '1'),
            secretHint(seat.entryPin),
            secretHint(seat.joinToken),
            String(seat.startTime || ''),
            String(seat.staffMemo || ''),
            String(seat.staffRequestType || ''),
            String(seat.staffRequestAt || ''),
            String(seat.totalAmount != null ? seat.totalAmount : ''),
            String(seat.startTime || ''),
            String((seat.partyFlags && seat.partyFlags.family) ? '1' : '0'),
            String((seat.partyFlags && seat.partyFlags.couple) ? '1' : '0'),
            String((seat.partyFlags && seat.partyFlags.companions) ? '1' : '0'),
            String(
                seat.liveDetailsState === 'ready' || seat.detailsEnriched === true
                    ? 'ready'
                    : 'loading'
            )
        ].join('|');
    }

    function resolveTableSeatPassPhrase(seat, card, caches) {
        if (seat && seat.passPhrase) {
            return String(seat.passPhrase).trim();
        }
        if (card && getSeatCardPassPhrase(card)) {
            return String(getSeatCardPassPhrase(card)).trim();
        }
        if (card && card.dataset && card.dataset.qrPassPhrase) {
            return String(card.dataset.qrPassPhrase).trim();
        }
        var tableNo = Number((seat && seat.tableNo) || (card && card.dataset && card.dataset.tableNo) || 0);
        var display = caches && caches.getDisplayCache ? caches.getDisplayCache() : [];
        var meta = caches && caches.getMetadataCache ? caches.getMetadataCache() : [];
        var cached = display.find(function (row) { return Number(row.tableNo || 0) === tableNo; })
            || meta.find(function (row) { return Number(row.tableNo || 0) === tableNo; });
        return cached && cached.passPhrase ? String(cached.passPhrase).trim() : '';
    }

    function seatFromTableCard(card, caches) {
        if (!card) {
            return null;
        }
        var tableNo = Number(card.dataset.tableNo || 0);
        var display = caches && caches.getDisplayCache ? caches.getDisplayCache() : [];
        var meta = caches && caches.getMetadataCache ? caches.getMetadataCache() : [];
        var cached = display.find(function (row) { return Number(row.tableNo || 0) === tableNo; })
            || meta.find(function (row) { return Number(row.tableNo || 0) === tableNo; });
        var passPhrase = resolveTableSeatPassPhrase(cached, card, caches);
        if (cached) {
            var status = String(cached.status || 'VACANT').toUpperCase();
            var forceVacant = cached._forceVacant === true;
            // キャッシュの VACANT / _forceVacant を優先。dataset.sessionId の残滓で USING に戻さない
            var sessionId = (!forceVacant && status === 'USING')
                ? (cached.currentSessionId || null)
                : null;
            var isUsing = !forceVacant && status === 'USING' && !!sessionId;
            return Object.assign({}, cached, {
                passPhrase: passPhrase || cached.passPhrase || null,
                status: isUsing ? 'USING' : 'VACANT',
                currentSessionId: isUsing ? sessionId : null,
                activePeoples: isUsing ? cached.activePeoples : null,
                peoplesConfirmed: isUsing ? cached.peoplesConfirmed !== false : true,
                entryPin: isUsing
                    ? (cached.entryPin || (card.dataset && card.dataset.entryPin) || null)
                    : null,
                joinToken: isUsing ? (cached.joinToken || null) : null,
                startTime: isUsing ? (cached.startTime || null) : null,
                totalAmount: isUsing ? cached.totalAmount : null,
                staffRequestType: isUsing ? (cached.staffRequestType || null) : null,
                staffRequestAt: isUsing ? (cached.staffRequestAt || null) : null
            });
        }
        var fallbackSessionId = card.dataset && card.dataset.sessionId
            ? String(card.dataset.sessionId)
            : null;
        if (fallbackSessionId) {
            return {
                tableNo: tableNo,
                passPhrase: passPhrase || null,
                status: 'USING',
                currentSessionId: fallbackSessionId,
                entryPin: card.dataset.entryPin || null,
                activePeoples: null,
                peoplesConfirmed: true
            };
        }
        return {
            tableNo: tableNo,
            passPhrase: passPhrase || null,
            status: 'VACANT',
            currentSessionId: null
        };
    }

    /** Firestore マージ結果を DOM に反映し、終了済みセッションの dataset を除去する。 */
    function reconcileTableSeatCardDom(card, seat) {
        if (!card || !seat) {
            return;
        }
        var status = String(seat.status || 'VACANT').toUpperCase();
        var forceVacant = seat._forceVacant === true;
        var isUsing = !forceVacant
            && status === 'USING'
            && !!seat.currentSessionId;
        if (!isUsing) {
            // Active カードの誤 VACANT reconcile で Wait に落とさない。
            // ただし会計（_forceVacant）や currentSessionId 無し VACANT は dataset を必ず消す。
            if (!forceVacant
                    && status !== 'VACANT'
                    && card.classList.contains('status-active')
                    && card.dataset
                    && card.dataset.sessionId) {
                return;
            }
            delete card.dataset.sessionId;
            delete card.dataset.entryPin;
            setSeatCardEntryPin(card, null);
            delete card.dataset.seatStateKey;
            delete card.dataset.seatLiveKey;
            card.classList.remove('status-active', 'session-card-clickable', 'is-checkout-pending',
                'is-staff-call', 'is-staff-checkout');
            if (!card.classList.contains('status-closed')) {
                card.classList.add('status-closed');
            }
            return;
        }
        card.classList.add('status-active');
        card.classList.remove('status-closed');
        if (card.classList.contains('is-checkout-pending')) {
            card.classList.remove('session-card-clickable');
        } else {
            card.classList.add('session-card-clickable');
        }
        if (seat.currentSessionId) {
            card.dataset.sessionId = String(seat.currentSessionId);
        }
        delete card.dataset.entryPin;
        setSeatCardEntryPin(card, seat.entryPin || null);
        syncTableSeatCardElapsed(card, seat);
    }

    /**
     * @param {object} options
     * @param {function(): Array} options.getDisplayCache
     * @param {function(): Array} [options.getMetadataCache]
     * @param {function(number, string): string} [options.buildFixedQrConnectUrl]
     * @param {function} [options.formatElapsed]
     * @param {function(string, string): void} [options.toast]
     * @param {function} [options.applyFixedQrToWrap]
     * @param {function(number): void} [options.onRefreshPassphrase]
     * @param {function(string, string, object=): void} [options.onCheckout]
     * @param {function(string, object): void} [options.onOpenSessionDetail]
     * @param {function(object): void} [options.onConnectSession]
     * @param {function(): boolean} [options.isFixedQrMode] true=固定QR / false=都度発行
     * @param {object} options.elements
     */
    function createTableSeatUi(options) {
        var opts = options || {};
        var caches = {
            getDisplayCache: opts.getDisplayCache || function () { return []; },
            getMetadataCache: opts.getMetadataCache || function () { return []; }
        };
        var actionContext = null;
        var fixedQrModalLoadSeq = 0;

        function isFixedQrMode() {
            if (typeof opts.isFixedQrMode === 'function') {
                return !!opts.isFixedQrMode();
            }
            return true;
        }

        function clearActionModalQrImage(els) {
            if (!els || !els.qrImg) {
                return;
            }
            els.qrImg.style.display = 'none';
            els.qrImg.style.visibility = 'hidden';
            els.qrImg.removeAttribute('src');
        }

        function appendCheckoutProcessingBody(body) {
            var wrap = document.createElement('div');
            wrap.className = 'table-seat-card-v2__checkout-processing';
            var ring = document.createElement('div');
            ring.className = 'table-seat-card-v2__checkout-ring';
            ring.setAttribute('role', 'progressbar');
            ring.setAttribute('aria-label', '\u4f1a\u8a08\u51e6\u7406\u4e2d');
            var label = document.createElement('div');
            label.className = 'table-seat-card-v2__checkout-label';
            label.textContent = '\u51e6\u7406\u4e2d...';
            wrap.append(ring, label);
            body.replaceChildren(wrap);
        }

        function isCheckoutPendingForSeat(seat, card) {
            if (card && card.classList && card.classList.contains('is-checkout-pending')) {
                return true;
            }
            var sessionId = seat && seat.currentSessionId;
            return typeof opts.isCheckoutPending === 'function'
                && sessionId
                && opts.isCheckoutPending(sessionId);
        }

        function resolveDisplayTotalAmount(seat, card) {
            var next = seat && seat.totalAmount != null ? Number(seat.totalAmount) : NaN;
            var sticky = card && card.dataset
                ? Number(card.dataset.lastPositiveAmount || '')
                : NaN;
            if (Number.isFinite(next) && next > 0) {
                if (card && card.dataset) {
                    card.dataset.lastPositiveAmount = String(next);
                }
                return next;
            }
            var orders = seat && seat.orderCount != null ? Number(seat.orderCount) : NaN;
            if (Number.isFinite(next) && next === 0 && seat && seat.orderCount != null && orders === 0) {
                if (card && card.dataset) {
                    delete card.dataset.lastPositiveAmount;
                }
                return 0;
            }
            if (Number.isFinite(sticky) && sticky > 0) {
                return sticky;
            }
            if (Number.isFinite(next)) {
                return next;
            }
            // 新規セッション等: 合計未取得でも 0 円を出す（「—」非表示）
            return 0;
        }

        function formatPartyFlagsCompact(flags) {
            var core = global.MasterOrderCoreSdk;
            if (core && typeof core.formatPartyFlagsLabel === 'function') {
                return core.formatPartyFlagsLabel(flags);
            }
            var pf = flags || {};
            var parts = [];
            if (pf.family) {
                parts.push('家族');
            }
            if (pf.couple) {
                parts.push('カップル');
            }
            if (pf.companions) {
                parts.push('同伴');
            }
            return parts.join('・');
        }

        function formatSeatPeoplesCompact(seat) {
            if (!seat || seat.peoplesConfirmed === false) {
                return '人数未設定';
            }
            var people = seat.activePeoples != null ? Number(seat.activePeoples) : null;
            if (people != null && Number.isFinite(people) && people > 0) {
                return people + '\u4eba';
            }
            return '人数未設定';
        }

        function formatSeatSummaryLine(seat, loading, card) {
            if (loading) {
                return '—';
            }
            var people = formatSeatPeoplesCompact(seat);
            var flags = formatPartyFlagsCompact(seat && seat.partyFlags);
            if (flags) {
                people += '・' + flags;
            }
            var displayTotal = resolveDisplayTotalAmount(seat, card);
            return people
                + ' / '
                + formatSeatAmount(displayTotal != null ? displayTotal : 0);
        }

        function appendUsingAmountBody(body, seat, loading) {
            var card = body && body.parentElement;
            var summary = document.createElement('div');
            summary.className = 'table-seat-card-v2__summary'
                + (loading ? ' table-seat-card-v2__summary--pending' : '');
            summary.textContent = formatSeatSummaryLine(seat, loading, card);
            if (loading) {
                summary.setAttribute('aria-busy', 'true');
            }

            var meta = document.createElement('div');
            meta.className = 'table-seat-card-v2__elapsed';
            if (loading) {
                meta.textContent = '読込中…';
            } else {
                setElapsedNodeStartTime(meta, seat.startTime);
                meta.textContent = formatSeatElapsedLabel(seat.startTime, opts.formatElapsed);
            }

            body.append(summary, meta);
        }

        function isSeatDetailsLoading(seat, card) {
            if (!seat || String(seat.status || '').toUpperCase() !== 'USING') {
                return false;
            }
            var total = seat.totalAmount != null ? Number(seat.totalAmount) : NaN;
            var orders = seat.orderCount != null ? Number(seat.orderCount) : NaN;
            var sticky = card && card.dataset
                ? Number(card.dataset.lastPositiveAmount || '')
                : NaN;
            // 誤 ¥0 のときは amountLayout 済みでも loading に戻す（高さより正しさ優先）
            var suspiciousZero = (!Number.isFinite(total) || total === 0)
                && !(seat.orderCount != null && orders === 0)
                && seat.liveDetailsState === 'loading';
            if (suspiciousZero) {
                return true;
            }
            // 一度金額レイアウトを出したらバーに戻さない（高さジャンプ防止）
            if (card && card.dataset && card.dataset.amountLayout === '1'
                && (Number.isFinite(total) && total > 0
                    || (seat.orderCount != null && orders === 0)
                    || (Number.isFinite(sticky) && sticky > 0))) {
                return false;
            }
            if (seat.liveDetailsState === 'ready'
                && (Number.isFinite(total) && total > 0
                    || (seat.orderCount != null && orders === 0))) {
                return false;
            }
            if (seat.detailsEnriched === true
                && (Number.isFinite(total) && total > 0
                    || (seat.orderCount != null && orders === 0))) {
                return false;
            }
            if (seat.liveDetailsState === 'loading') {
                return true;
            }
            if (Number.isFinite(total) && total > 0) {
                return false;
            }
            if (seat.orderCount != null && orders === 0) {
                return false;
            }
            return true;
        }

        function patchUsingAmountBody(card, body, seat) {
            var summary = body.querySelector('.table-seat-card-v2__summary');
            var meta = body.querySelector('.table-seat-card-v2__elapsed');
            if (!summary || !meta) {
                return false;
            }
            summary.classList.remove('table-seat-card-v2__summary--pending');
            summary.removeAttribute('aria-busy');
            summary.textContent = formatSeatSummaryLine(seat, false, card);
            setElapsedNodeStartTime(meta, seat.startTime);
            meta.textContent = formatSeatElapsedLabel(seat.startTime, opts.formatElapsed);
            card.dataset.amountLayout = '1';
            return true;
        }

        function populateCardBody(card, seat) {
            var body = card.querySelector('.table-seat-card-v2__body');
            if (!body) {
                return;
            }
            var isUsing = String(seat.status || '').toUpperCase() === 'USING';
            if (isUsing) {
                if (isCheckoutPendingForSeat(seat, card)) {
                    body.replaceChildren();
                    delete card.dataset.amountLayout;
                    delete card.dataset.lastPositiveAmount;
                    appendCheckoutProcessingBody(body);
                    return;
                }
                var loading = isSeatDetailsLoading(seat, card);
                if (!loading && card.dataset.amountLayout === '1'
                    && patchUsingAmountBody(card, body, seat)) {
                    return;
                }
                body.replaceChildren();
                appendUsingAmountBody(body, seat, loading);
                var summaryEl = body.querySelector('.table-seat-card-v2__summary');
                var stillPending = !summaryEl
                    || summaryEl.classList.contains('table-seat-card-v2__summary--pending');
                if (!loading && !stillPending) {
                    card.dataset.amountLayout = '1';
                } else if (stillPending) {
                    delete card.dataset.amountLayout;
                }
                return;
            }
            delete card.dataset.amountLayout;
            delete card.dataset.lastPositiveAmount;
            body.replaceChildren();
            var wait = document.createElement('div');
            wait.className = 'table-seat-card-v2__wait';
            var waitLabel = document.createElement('strong');
            waitLabel.textContent = 'Wait';
            var waitHint = document.createElement('span');
            waitHint.textContent = isFixedQrMode()
                ? 'タップで操作'
                : 'タップで QR 発行';
            wait.append(waitLabel, waitHint);
            body.appendChild(wait);
        }

        function syncQrShowButton(card, seat) {
            // QR / 接続はカードタップ後のセッション詳細（会計の上）へ移したため、カード上のフッターは出さない
            var footer = card && card.querySelector('.table-seat-card-v2__actions');
            if (footer) {
                footer.remove();
            }
        }

        function buildCard(seat) {
            var tableNo = Number(seat.tableNo || 0);
            var status = String(seat.status || 'VACANT').toUpperCase();
            var isUsing = status === 'USING';
            var card = document.createElement('div');
            card.className = 'session-card table-seat-card table-seat-card-v2 session-card-clickable '
                + (isUsing ? 'status-active' : 'status-closed');
            card.setAttribute('role', 'button');
            card.tabIndex = 0;
            card.dataset.tableNo = String(tableNo);
            if (seat.currentSessionId) {
                card.dataset.sessionId = seat.currentSessionId;
            }
            if (seat.passPhrase) {
                setSeatCardPassPhrase(card, seat.passPhrase);
                card.dataset.qrTableNo = String(tableNo);
            }
            delete card.dataset.qrPassPhrase;
            setSeatCardEntryPin(card, isUsing ? (seat.entryPin || null) : null);
            card.dataset.seatStateKey = tableSeatStateKey(seat);
            card.dataset.seatLayoutKey = tableSeatLayoutKey(seat);
            card.dataset.seatLiveKey = tableSeatLiveKey(seat);

            var bar = document.createElement('div');
            bar.className = 'table-seat-card-v2__bar';

            var head = document.createElement('div');
            head.className = 'table-seat-card-v2__head';
            var dot = document.createElement('span');
            dot.className = 'table-seat-card-v2__dot';
            dot.setAttribute('aria-hidden', 'true');
            var title = document.createElement('div');
            title.className = 'table-seat-card-v2__title';
            title.textContent = 'テーブル番号 ' + tableNo;
            head.append(dot, title);

            var body = document.createElement('div');
            body.className = 'table-seat-card-v2__body';
            card.append(bar, head, body);
            populateCardBody(card, seat);
            syncQrShowButton(card, seat);
            if (typeof opts.applyStaffRequestCardState === 'function') {
                opts.applyStaffRequestCardState(card, seat);
            }
            return card;
        }

        function updateCard(card, seat) {
            if (card && isCheckoutPendingForSeat(seat, card)) {
                syncQrShowButton(card, seat);
                return;
            }
            var tableNo = Number(seat.tableNo || 0);
            var status = String(seat.status || 'VACANT').toUpperCase();
            var isUsing = status === 'USING';

            card.className = 'session-card table-seat-card table-seat-card-v2 session-card-clickable '
                + (isUsing ? 'status-active' : 'status-closed');
            card.dataset.seatStateKey = tableSeatStateKey(seat);
            card.dataset.seatLayoutKey = tableSeatLayoutKey(seat);
            card.dataset.seatLiveKey = tableSeatLiveKey(seat);
            if (seat.passPhrase) {
                setSeatCardPassPhrase(card, seat.passPhrase);
                card.dataset.qrTableNo = String(tableNo);
            }
            delete card.dataset.qrPassPhrase;
            if (seat.currentSessionId) {
                card.dataset.sessionId = seat.currentSessionId;
            } else {
                delete card.dataset.sessionId;
            }
            setSeatCardEntryPin(card, isUsing ? (seat.entryPin || null) : null);

            var title = card.querySelector('.table-seat-card-v2__title');
            if (title) {
                title.textContent = 'テーブル番号 ' + tableNo;
            }
            populateCardBody(card, seat);
            syncQrShowButton(card, seat);
            if (typeof opts.applyStaffRequestCardState === 'function') {
                opts.applyStaffRequestCardState(card, seat);
            }
        }

        function closeActionModal() {
            var els = opts.elements || {};
            if (!els.modal) {
                return;
            }
            fixedQrModalLoadSeq += 1;
            els.modal.classList.remove('show');
            actionContext = null;
            if (els.list) {
                els.list.replaceChildren();
            }
            if (els.footer) {
                els.footer.hidden = true;
            }
            clearActionModalQrImage(els);
            setFixedQrLoading(els, false, null);
            if (els.qr) {
                els.qr.hidden = true;
            }
            if (els.qrCaption) {
                els.qrCaption.textContent = '';
            }
            if (els.passwd) {
                els.passwd.hidden = true;
                els.passwd.textContent = '';
            }
        }

        function makeActionListButton(mainLabel, subLabel) {
            var btn = document.createElement('button');
            btn.type = 'button';
            if (subLabel) {
                btn.className = 'table-seat-action-btn-stacked';
                var main = document.createElement('span');
                main.className = 'table-seat-action-btn-main';
                main.textContent = mainLabel;
                var sub = document.createElement('span');
                sub.className = 'table-seat-action-btn-sub';
                sub.textContent = subLabel;
                btn.append(main, sub);
            } else {
                btn.textContent = mainLabel;
            }
            return btn;
        }

        function showQrInActionModal(seat) {
            void loadAndShowFixedQrInActionModal(seat);
        }

        function setFixedQrLoading(els, loading, hint) {
            if (!els || !els.qr) {
                return;
            }
            els.qr.classList.toggle('table-seat-action-qr--loading', !!loading);
            if (els.qrHint) {
                if (hint) {
                    els.qrHint.hidden = false;
                    els.qrHint.textContent = hint;
                } else {
                    els.qrHint.hidden = true;
                    els.qrHint.textContent = '';
                }
            }
        }

        function renderFixedQrInActionModal(seat, passPhrase, connectUrl) {
            var els = opts.elements || {};
            if (!els.qr || !seat || !passPhrase) {
                return;
            }
            var tableNo = Number(seat.tableNo || 0);
            var isUsing = String(seat.status || '').toUpperCase() === 'USING';
            els.qr.hidden = false;
            setFixedQrLoading(els, false, null);
            if (els.qrCaption) {
                els.qrCaption.textContent = isUsing ? '利用中（固定QR）' : '卓上固定QR';
            }
            if (els.passwd) {
                els.passwd.hidden = false;
                els.passwd.textContent = 'PASSWD: ' + passPhrase;
            }
            if (typeof opts.applyFixedQrToWrap === 'function') {
                var applied = opts.applyFixedQrToWrap(
                    els.qr, els.qrImg, els.qrCaption, tableNo, passPhrase, connectUrl);
                if (!applied && els.qrCaption && !els.qrCaption.textContent) {
                    els.qrCaption.textContent = '固定QRを生成できません';
                }
            }
        }

        async function loadAndShowFixedQrInActionModal(seat) {
            var els = opts.elements || {};
            if (!els.qr || !seat) {
                return;
            }
            var tableNo = Number(seat.tableNo || 0);
            var loadSeq = ++fixedQrModalLoadSeq;
            clearActionModalQrImage(els);
            els.qr.hidden = false;

            var passPhrase = resolveTableSeatPassPhrase(seat, null, caches) || seat.passPhrase || null;
            var connectUrl = seat.connectUrl ? String(seat.connectUrl).trim() : '';

            if (passPhrase) {
                renderFixedQrInActionModal(seat, passPhrase, connectUrl);
                return;
            }

            setFixedQrLoading(els, true, null);
            if (els.passwd) {
                els.passwd.hidden = true;
                els.passwd.textContent = '';
            }
            if (els.qrCaption) {
                els.qrCaption.textContent = '固定QRを読み込み中...';
            }
            if (typeof opts.onFetchFixedQrDisplay === 'function') {
                try {
                    var fetched = await opts.onFetchFixedQrDisplay(tableNo);
                    if (loadSeq !== fixedQrModalLoadSeq) {
                        return;
                    }
                    if (fetched && fetched.passPhrase) {
                        passPhrase = fetched.passPhrase;
                    }
                    if (fetched && fetched.connectUrl) {
                        connectUrl = String(fetched.connectUrl).trim();
                    }
                    if (fetched && fetched.passPhrase) {
                        actionContext = Object.assign({}, actionContext || seat, {
                            passPhrase: passPhrase,
                            connectUrl: connectUrl || null
                        });
                        if (typeof opts.onPassPhraseResolved === 'function') {
                            opts.onPassPhraseResolved(tableNo, passPhrase, connectUrl || null);
                        }
                    }
                } catch (err) {
                    if (loadSeq !== fixedQrModalLoadSeq) {
                        return;
                    }
                    var hint = (err && err.message)
                        ? String(err.message)
                        : 'QRを表示できません';
                    setFixedQrLoading(els, true, hint);
                    if (els.qrCaption) {
                        els.qrCaption.textContent = '固定QRを表示できません';
                    }
                    return;
                }
            }
            if (!passPhrase) {
                setFixedQrLoading(els, true, '「パスワードを更新」を実行するとQRが表示されます');
                if (els.qrCaption) {
                    els.qrCaption.textContent = 'パスワード未設定';
                }
                return;
            }
            renderFixedQrInActionModal(seat, passPhrase, connectUrl);
        }

        function showJoinQrInActionModal(seat) {
            var els = opts.elements || {};
            if (!els.qr || !seat || !seat.currentSessionId) {
                if (typeof opts.toast === 'function') {
                    opts.toast('アクティブなセッションがありません', 'error');
                }
                return;
            }
            var loadSeq = ++fixedQrModalLoadSeq;
            clearActionModalQrImage(els);
            setFixedQrLoading(els, true, null);
            els.qr.hidden = false;
            if (els.passwd) {
                els.passwd.hidden = true;
                els.passwd.textContent = '';
            }
            if (els.qrCaption) {
                els.qrCaption.textContent = 'セッションQRを読み込み中...';
            }
            if (typeof opts.applyJoinQrToWrap === 'function') {
                Promise.resolve(opts.applyJoinQrToWrap(els.qr, els.qrImg, els.qrCaption, seat))
                    .then(function () {
                        if (loadSeq !== fixedQrModalLoadSeq) {
                            return;
                        }
                        setFixedQrLoading(els, false, null);
                        if (els.qrCaption) {
                            els.qrCaption.textContent = 'セッションに参加できるQR';
                        }
                    })
                    .catch(function () {
                        if (loadSeq !== fixedQrModalLoadSeq) {
                            return;
                        }
                        setFixedQrLoading(els, true, 'QRを表示できません');
                        if (typeof opts.toast === 'function') {
                            opts.toast('注文QRの表示に失敗しました', 'error');
                        }
                    });
            }
        }

        function showVacantTsudoHintInActionModal() {
            var els = opts.elements || {};
            if (!els.qr) {
                return;
            }
            clearActionModalQrImage(els);
            setFixedQrLoading(els, false, null);
            els.qr.hidden = false;
            if (els.passwd) {
                els.passwd.hidden = true;
                els.passwd.textContent = '';
            }
            if (els.qrCaption) {
                els.qrCaption.textContent = 'セッション開始後にQR表示';
            }
            if (els.qrHint) {
                els.qrHint.hidden = false;
                els.qrHint.textContent = '「QRを発行」からお客様用QRを作成します';
            }
        }

        function openActionModal(seatOrCard, openOptions) {
            var openOpts = openOptions || {};
            var els = opts.elements || {};
            var seat = seatOrCard instanceof HTMLElement
                ? seatFromTableCard(seatOrCard, caches)
                : seatOrCard;
            if (!els.modal || !seat) {
                return;
            }
            fixedQrModalLoadSeq += 1;
            clearActionModalQrImage(els);
            setFixedQrLoading(els, false, null);
            var tableNo = Number(seat.tableNo || 0);
            var isUsing = String(seat.status || '').toUpperCase() === 'USING';
            var fixedQr = isFixedQrMode();
            var passPhrase = fixedQr ? resolveTableSeatPassPhrase(seat, null, caches) : null;
            actionContext = Object.assign({}, seat, {
                passPhrase: passPhrase || seat.passPhrase || null
            });
            if (els.title) {
                els.title.textContent = 'テーブル番号 ' + tableNo;
            }
            if (els.sub) {
                els.sub.textContent = isUsing ? 'Active' : 'Wait';
            }
            if (els.list) {
                els.list.replaceChildren();
                if (fixedQr) {
                    var passwdBtn = makeActionListButton('パスワードを更新');
                    passwdBtn.addEventListener('click', function () {
                        var message = '本当に更新しますか？この変更は戻せません、卓上QRを更新する必要があります';
                        if (typeof window !== 'undefined'
                            && typeof window.confirm === 'function'
                            && !window.confirm(message)) {
                            return;
                        }
                        if (typeof opts.onRefreshPassphrase === 'function') {
                            opts.onRefreshPassphrase(tableNo, { keepModalOpen: true });
                        }
                    });
                    els.list.appendChild(passwdBtn);
                }

                if (!isUsing) {
                    var createSessionBtn = makeActionListButton(
                        fixedQr ? 'セッションの作成' : 'QRを発行'
                    );
                    createSessionBtn.addEventListener('click', function () {
                        closeActionModal();
                        if (typeof opts.onCreateSession === 'function') {
                            opts.onCreateSession(tableNo);
                        }
                    });
                    els.list.appendChild(createSessionBtn);
                }

                if (isUsing && seat.currentSessionId) {
                    var checkoutBtn = document.createElement('button');
                    checkoutBtn.type = 'button';
                    checkoutBtn.className = 'btn-danger-action';
                    checkoutBtn.textContent = '会計';
                    checkoutBtn.addEventListener('click', function () {
                        closeActionModal();
                        if (typeof opts.onCheckout === 'function') {
                            opts.onCheckout(seat.currentSessionId, 'テーブル ' + tableNo, {
                                totalAmount: seat.totalAmount,
                                tableNumber: tableNo
                            });
                        }
                    });
                    els.list.appendChild(checkoutBtn);

                    var detailBtn = document.createElement('button');
                    detailBtn.type = 'button';
                    detailBtn.textContent = '注文詳細を見る';
                    detailBtn.addEventListener('click', function () {
                        closeActionModal();
                        if (typeof opts.onOpenSessionDetail === 'function') {
                            opts.onOpenSessionDetail(seat.currentSessionId, {
                                sessionId: seat.currentSessionId,
                                tableNumber: tableNo,
                                peoples: Number(seat.activePeoples || 0),
                                guestCounts: seat.guestCounts || null,
                                partyFlags: seat.partyFlags || null,
                                entryPin: seat.entryPin || '',
                                startTime: seat.startTime || ''
                            });
                        }
                    });
                    els.list.appendChild(detailBtn);

                    if (typeof opts.buildGuestCountsPanel === 'function') {
                        var guestBtn = document.createElement('button');
                        guestBtn.type = 'button';
                        guestBtn.className = 'btn-secondary';
                        guestBtn.textContent = '人数を設定';
                        var guestHost = document.createElement('div');
                        guestHost.className = 'session-guest-counts-host';
                        guestHost.hidden = true;
                        guestBtn.addEventListener('click', function () {
                            var willOpen = guestHost.hidden;
                            if (willOpen) {
                                guestHost.replaceChildren();
                                var guestPanel = opts.buildGuestCountsPanel(seat.currentSessionId, {
                                    peoples: seat.activePeoples,
                                    guestCounts: seat.guestCounts,
                                    partyFlags: seat.partyFlags
                                }, {
                                    onSaved: function (result) {
                                        seat.activePeoples = result.peoples;
                                        seat.guestCounts = result.guestCounts;
                                        if (result.partyFlags != null) {
                                            seat.partyFlags = result.partyFlags;
                                        }
                                        guestBtn.textContent = '人数を設定（' + result.peoples + '名）';
                                        if (typeof opts.onGuestCountsSaved === 'function') {
                                            opts.onGuestCountsSaved(result, seat);
                                        }
                                    }
                                });
                                if (guestPanel) {
                                    guestHost.appendChild(guestPanel);
                                }
                            }
                            guestHost.hidden = !willOpen;
                            guestBtn.classList.toggle('is-open', willOpen);
                            guestBtn.textContent = willOpen
                                ? '人数設定を閉じる'
                                : ('人数を設定'
                                    + (seat.activePeoples != null ? '（' + seat.activePeoples + '名）' : ''));
                        });
                        if (seat.activePeoples != null) {
                            guestBtn.textContent = '人数を設定（' + seat.activePeoples + '名）';
                        }
                        els.list.appendChild(guestBtn);
                        els.list.appendChild(guestHost);
                    }
                }
            }
            if (els.footer && els.connectBtn) {
                if (isUsing && seat.currentSessionId) {
                    els.footer.hidden = false;
                    els.connectBtn.onclick = function () {
                        if (typeof opts.onConnectSession === 'function') {
                            opts.onConnectSession(actionContext || seat);
                        }
                    };
                } else {
                    els.footer.hidden = true;
                    els.connectBtn.onclick = null;
                }
            }
            els.modal.classList.add('show');
            if (isUsing && seat.currentSessionId) {
                showJoinQrInActionModal(actionContext);
            } else if (fixedQr) {
                void loadAndShowFixedQrInActionModal(actionContext);
            } else {
                showVacantTsudoHintInActionModal();
            }
        }

        function handleCardActivate(card) {
            if (!card || !card.classList.contains('table-seat-card-v2')) {
                return;
            }
            if (card.classList.contains('is-checkout-pending')) {
                return;
            }
            var seat = seatFromTableCard(card, caches);
            if (!seat) {
                return;
            }
            var isUsing = String(seat.status || '').toUpperCase() === 'USING' && !!seat.currentSessionId;
            if (isUsing && typeof opts.onOpenSessionDetail === 'function') {
                opts.onOpenSessionDetail(seat.currentSessionId, {
                    sessionId: seat.currentSessionId,
                    tableNumber: Number(seat.tableNo || 0),
                    peoples: Number(seat.activePeoples || 0),
                    peoplesConfirmed: seat.peoplesConfirmed !== false,
                    guestCounts: seat.guestCounts || null,
                    partyFlags: seat.partyFlags || null,
                    entryPin: seat.entryPin || '',
                    startTime: seat.startTime || '',
                    totalAmount: seat.totalAmount
                });
                return;
            }
            openActionModal(seat, { showQrImmediately: true });
        }

        return {
            buildCard: buildCard,
            updateCard: updateCard,
            handleCardActivate: handleCardActivate,
            openActionModal: openActionModal,
            closeActionModal: closeActionModal,
            showQrInActionModal: showQrInActionModal,
            showJoinQrInActionModal: showJoinQrInActionModal,
            seatFromTableCard: function (card) { return seatFromTableCard(card, caches); },
            resolvePassPhrase: function (seat, card) { return resolveTableSeatPassPhrase(seat, card, caches); }
        };
    }

    /**
     * Active / Wait / 全席フィルター（DOM 上の status-active クラスで判定）。
     * @returns {{ getFilter: function, setFilter: function, apply: function, renderSummary: function }}
     */
    function createTableSeatStatusFilter(options) {
        var opts = options || {};
        var current = 'all';

        function normalize(filter) {
            return filter === 'active' || filter === 'wait' ? filter : 'all';
        }

        function isCardActive(card) {
            return card && card.classList && card.classList.contains('status-active');
        }

        function setCardVisible(card, visible) {
            if (!card) {
                return;
            }
            card.classList.toggle(FILTER_HIDDEN_CLASS, !visible);
            card.hidden = !visible;
            card.setAttribute('aria-hidden', visible ? 'false' : 'true');
        }

        function apply(grid) {
            if (!grid) {
                return;
            }
            grid.querySelectorAll('.table-seat-card').forEach(function (card) {
                var visible = true;
                if (current === 'active') {
                    visible = isCardActive(card);
                } else if (current === 'wait') {
                    visible = !isCardActive(card);
                }
                setCardVisible(card, visible);
            });
        }

        function setFilter(next, context) {
            current = normalize(next);
            var ctx = context || {};
            if (ctx.wrap) {
                ctx.wrap.querySelectorAll('.table-seat-filter').forEach(function (chip) {
                    chip.classList.toggle('active', chip.dataset.filter === current);
                });
            }
            if (ctx.grid) {
                apply(ctx.grid);
            }
        }

        function renderSummary(tables, labels, onFilterClick) {
            var list = Array.isArray(tables) ? tables : [];
            var active = list.filter(function (seat) {
                return String(seat.status || '').toUpperCase() === 'USING';
            }).length;
            var closed = list.length - active;
            var summary = document.createElement('div');
            summary.className = 'table-seat-summary';
            var labelSet = labels || {};

            function makeChip(text, filterKey) {
                var chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'table-seat-filter' + (current === filterKey ? ' active' : '');
                chip.dataset.filter = filterKey;
                chip.textContent = text;
                chip.addEventListener('click', function () {
                    if (typeof onFilterClick === 'function') {
                        onFilterClick(filterKey);
                    }
                });
                return chip;
            }

            summary.append(
                makeChip(labelSet.active || ('Active ' + active), 'active'),
                makeChip(labelSet.wait || ('Wait ' + closed), 'wait'),
                makeChip(labelSet.all || ('全 ' + list.length + ' 席'), 'all')
            );
            return summary;
        }

        return {
            FILTER_HIDDEN_CLASS: FILTER_HIDDEN_CLASS,
            getFilter: function () { return current; },
            setFilter: setFilter,
            apply: apply,
            renderSummary: renderSummary,
            setCardVisible: setCardVisible
        };
    }

    function applyCheckoutPendingState(card, pending) {
        if (!card) {
            return;
        }
        card.classList.toggle('is-checkout-pending', !!pending);
        card.setAttribute('aria-busy', pending ? 'true' : 'false');
        if (pending) {
            card.tabIndex = -1;
            card.classList.remove('session-card-clickable');
            var body = card.querySelector('.table-seat-card-v2__body');
            if (body) {
                var wrap = document.createElement('div');
                wrap.className = 'table-seat-card-v2__checkout-processing';
                var ring = document.createElement('div');
                ring.className = 'table-seat-card-v2__checkout-ring';
                ring.setAttribute('role', 'progressbar');
                ring.setAttribute('aria-label', '\u4f1a\u8a08\u51e6\u7406\u4e2d');
                var label = document.createElement('div');
                label.className = 'table-seat-card-v2__checkout-label';
                label.textContent = '\u51e6\u7406\u4e2d...';
                wrap.append(ring, label);
                body.replaceChildren(wrap);
            }
            return;
        }
        if (card.classList.contains('status-active')) {
            card.tabIndex = 0;
            card.classList.add('session-card-clickable');
        }
    }

    global.MasterOrderStaffKiteiSdk = {
        version: SDK_VERSION,
        createTableSeatUi: createTableSeatUi,
        createTableSeatStatusFilter: createTableSeatStatusFilter,
        FILTER_HIDDEN_CLASS: FILTER_HIDDEN_CLASS,
        tableSeatStateKey: tableSeatStateKey,
        tableSeatLayoutKey: tableSeatLayoutKey,
        tableSeatLiveKey: tableSeatLiveKey,
        formatSeatAmount: formatSeatAmount,
        parseSessionStartMillis: parseSessionStartMillis,
        formatElapsedSinceStart: formatElapsedSinceStart,
        formatSeatElapsedLabel: formatSeatElapsedLabel,
        syncTableSeatCardElapsed: syncTableSeatCardElapsed,
        refreshTableSeatElapsedLabels: refreshTableSeatElapsedLabels,
        startTableSeatElapsedTimer: startTableSeatElapsedTimer,
        ensureTableSeatElapsedTimer: ensureTableSeatElapsedTimer,
        stopTableSeatElapsedTimer: stopTableSeatElapsedTimer,
        resolveTableSeatPassPhrase: resolveTableSeatPassPhrase,
        setSeatCardPassPhrase: setSeatCardPassPhrase,
        getSeatCardPassPhrase: getSeatCardPassPhrase,
        seatFromTableCard: seatFromTableCard,
        reconcileTableSeatCardDom: reconcileTableSeatCardDom,
        applyCheckoutPendingState: applyCheckoutPendingState
    };
})(typeof window !== 'undefined' ? window : globalThis);
