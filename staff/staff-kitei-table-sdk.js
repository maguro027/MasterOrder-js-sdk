/**
 * MasterOrder Staff KITEI (固定QR) 卓席 UI SDK
 *
 * 依存: api-routes.js → core-sdk.js → order-sdk.js → staff-kitei-table-sdk.js
 * グローバル: MasterOrderStaffKiteiSdk
 */
(function (global) {
    'use strict';

    var SDK_VERSION = '1.3.1';
    var FILTER_HIDDEN_CLASS = 'table-seat-filter-hidden';
    var tableSeatElapsedTimerId = null;
    var tableSeatElapsedTimerRoot = null;
    var core = global.MasterOrderCoreSdk;

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
        var intervalMs = opts.intervalMs > 0 ? opts.intervalMs : 1000;
        if (tableSeatElapsedTimerId !== null) {
            global.clearInterval(tableSeatElapsedTimerId);
        }
        tableSeatElapsedTimerRoot = root;
        function tick() {
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
            String(seat.entryPin || ''),
            String(seat.joinToken || '')
        ].join('|');
    }

    function tableSeatLayoutKey(seat) {
        return 'k|' + String(seat.tableNo || '') + '|' + String(seat.passPhrase || '');
    }

    function tableSeatLiveKey(seat) {
        return [
            String(seat.status || '').toUpperCase(),
            String(seat.currentSessionId || ''),
            String(seat.activePeoples != null ? seat.activePeoples : ''),
            String(seat.startTime || ''),
            String(seat.staffMemo || ''),
            String(seat.totalAmount != null ? seat.totalAmount : ''),
            String(seat.startTime || ''),
            String(seat.liveDetailsState || seat.detailsEnriched === true ? 'ready' : 'loading')
        ].join('|');
    }

    function resolveTableSeatPassPhrase(seat, card, caches) {
        if (seat && seat.passPhrase) {
            return String(seat.passPhrase).trim();
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
            var isUsing = status === 'USING' && !!cached.currentSessionId;
            return Object.assign({}, cached, {
                passPhrase: passPhrase || cached.passPhrase || null,
                status: isUsing ? 'USING' : 'VACANT',
                currentSessionId: isUsing ? cached.currentSessionId : null,
                activePeoples: isUsing ? cached.activePeoples : null,
                entryPin: isUsing ? (cached.entryPin || null) : null,
                joinToken: isUsing ? (cached.joinToken || null) : null
            });
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
        var isUsing = status === 'USING'
            && (!!seat.currentSessionId || !!(card.dataset && card.dataset.sessionId));
        if (!isUsing) {
            delete card.dataset.sessionId;
            delete card.dataset.entryPin;
            delete card.dataset.seatStateKey;
            delete card.dataset.seatLiveKey;
            card.classList.remove('status-active', 'session-card-clickable', 'is-checkout-pending');
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
        if (seat.entryPin) {
            card.dataset.entryPin = String(seat.entryPin);
        } else {
            delete card.dataset.entryPin;
        }
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
     * @param {function(string, string): void} [options.onCheckout]
     * @param {function(string, object): void} [options.onOpenSessionDetail]
     * @param {function(object): void} [options.onConnectSession]
     * @param {object} options.elements
     */
    function createTableSeatUi(options) {
        var opts = options || {};
        var caches = {
            getDisplayCache: opts.getDisplayCache || function () { return []; },
            getMetadataCache: opts.getMetadataCache || function () { return []; }
        };
        var actionContext = null;

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

        function appendCardLoadingBody(body) {
            var loading = document.createElement('div');
            loading.className = 'table-seat-card-v2__loading table-seat-card-v2__loading--silent';
            var bar = document.createElement('div');
            bar.className = 'table-seat-card-v2__loading-bar';
            bar.setAttribute('role', 'progressbar');
            bar.setAttribute('aria-label', '\u4f1a\u8a08\u60c5\u5831\u3092\u8aad\u307f\u8fbc\u307f\u4e2d');
            loading.appendChild(bar);
            body.appendChild(loading);
        }

        function isSeatDetailsLoading(seat) {
            if (!seat || String(seat.status || '').toUpperCase() !== 'USING') {
                return false;
            }
            if (seat.liveDetailsState === 'loading') {
                return true;
            }
            if (seat.liveDetailsState === 'ready') {
                return false;
            }
            return seat.detailsEnriched !== true;
        }

        function populateCardBody(card, seat) {
            var body = card.querySelector('.table-seat-card-v2__body');
            if (!body) {
                return;
            }
            var isUsing = String(seat.status || '').toUpperCase() === 'USING';
            body.replaceChildren();
            if (isUsing) {
                if (isCheckoutPendingForSeat(seat, card)) {
                    appendCheckoutProcessingBody(body);
                    return;
                }
                if (isSeatDetailsLoading(seat)) {
                    appendCardLoadingBody(body);
                    return;
                }
                var amountLabel = document.createElement('div');
                amountLabel.className = 'table-seat-card-v2__label';
                amountLabel.textContent = '合計金額';

                var amount = document.createElement('div');
                amount.className = 'table-seat-card-v2__amount';
                amount.textContent = formatSeatAmount(seat.totalAmount);

                var elapsed = document.createElement('div');
                elapsed.className = 'table-seat-card-v2__elapsed';
                setElapsedNodeStartTime(elapsed, seat.startTime);
                elapsed.textContent = '経過時間 ' + formatSeatElapsedLabel(seat.startTime, opts.formatElapsed);

                body.append(amountLabel, amount, elapsed);

                var memoText = (seat.staffMemo || '').trim();
                if (memoText) {
                    var memoLabel = document.createElement('div');
                    memoLabel.className = 'table-seat-card-v2__label';
                    memoLabel.textContent = 'メモ';
                    var memo = document.createElement('div');
                    memo.className = 'table-seat-card-v2__memo';
                    memo.textContent = memoText;
                    body.append(memoLabel, memo);
                }
            } else {
                var wait = document.createElement('div');
                wait.className = 'table-seat-card-v2__wait';
                var waitLabel = document.createElement('strong');
                waitLabel.textContent = 'Wait';
                var waitHint = document.createElement('span');
                waitHint.textContent = 'タップで QR 表示';
                wait.append(waitLabel, waitHint);
                body.appendChild(wait);
            }
        }

        function buildCard(seat) {
            var tableNo = Number(seat.tableNo || 0);
            var status = String(seat.status || 'VACANT').toUpperCase();
            var isUsing = status === 'USING';
            var card = document.createElement('div');
            card.className = 'session-card table-seat-card table-seat-card-v2 '
                + (isUsing ? 'status-active' : 'status-closed');
            card.setAttribute('role', 'button');
            card.tabIndex = 0;
            card.dataset.tableNo = String(tableNo);
            if (seat.currentSessionId) {
                card.dataset.sessionId = seat.currentSessionId;
            }
            if (seat.passPhrase) {
                card.dataset.qrPassPhrase = String(seat.passPhrase);
                card.dataset.qrTableNo = String(tableNo);
            }
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
            return card;
        }

        function updateCard(card, seat) {
            if (card && isCheckoutPendingForSeat(seat, card)) {
                return;
            }
            var tableNo = Number(seat.tableNo || 0);
            var status = String(seat.status || 'VACANT').toUpperCase();
            var isUsing = status === 'USING';

            card.className = 'session-card table-seat-card table-seat-card-v2 '
                + (isUsing ? 'status-active' : 'status-closed');
            card.dataset.seatStateKey = tableSeatStateKey(seat);
            card.dataset.seatLayoutKey = tableSeatLayoutKey(seat);
            card.dataset.seatLiveKey = tableSeatLiveKey(seat);
            if (seat.passPhrase) {
                card.dataset.qrPassPhrase = String(seat.passPhrase);
                card.dataset.qrTableNo = String(tableNo);
            }
            if (seat.currentSessionId) {
                card.dataset.sessionId = seat.currentSessionId;
            } else {
                delete card.dataset.sessionId;
            }

            var title = card.querySelector('.table-seat-card-v2__title');
            if (title) {
                title.textContent = 'テーブル番号 ' + tableNo;
            }
            populateCardBody(card, seat);
        }

        function closeActionModal() {
            var els = opts.elements || {};
            if (!els.modal) {
                return;
            }
            els.modal.classList.remove('show');
            actionContext = null;
            if (els.list) {
                els.list.replaceChildren();
            }
            if (els.footer) {
                els.footer.hidden = true;
            }
            setFixedQrLoading(els, true, null);
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

        function renderFixedQrInActionModal(seat, passPhrase) {
            var els = opts.elements || {};
            if (!els.qr || !seat || !passPhrase) {
                return;
            }
            var tableNo = Number(seat.tableNo || 0);
            var isUsing = String(seat.status || '').toUpperCase() === 'USING';
            setFixedQrLoading(els, false, null);
            if (els.qrCaption) {
                els.qrCaption.textContent = isUsing ? '利用中（固定QR）' : '卓上固定QR';
            }
            if (els.passwd) {
                els.passwd.hidden = false;
                els.passwd.textContent = 'PASSWD: ' + passPhrase;
            }
            if (typeof opts.applyFixedQrToWrap === 'function') {
                opts.applyFixedQrToWrap(els.qr, els.qrImg, els.qrCaption, tableNo, passPhrase);
            }
        }

        async function loadAndShowFixedQrInActionModal(seat) {
            var els = opts.elements || {};
            if (!els.qr || !seat) {
                return;
            }
            var tableNo = Number(seat.tableNo || 0);
            var passPhrase = resolveTableSeatPassPhrase(seat, null, caches) || seat.passPhrase || null;
            setFixedQrLoading(els, true, null);
            if (els.passwd) {
                els.passwd.hidden = true;
                els.passwd.textContent = '';
            }
            if (els.qrCaption) {
                els.qrCaption.textContent = '固定QRを読み込み中...';
            }
            if (!passPhrase && typeof opts.onFetchFixedQrDisplay === 'function') {
                try {
                    var fetched = await opts.onFetchFixedQrDisplay(tableNo);
                    if (fetched && fetched.passPhrase) {
                        passPhrase = fetched.passPhrase;
                        actionContext = Object.assign({}, actionContext || seat, {
                            passPhrase: passPhrase
                        });
                        if (typeof opts.onPassPhraseResolved === 'function') {
                            opts.onPassPhraseResolved(tableNo, passPhrase);
                        }
                    }
                } catch (err) {
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
            renderFixedQrInActionModal(seat, passPhrase);
        }

        function showJoinQrInActionModal(seat) {
            var els = opts.elements || {};
            if (!els.qr || !seat || !seat.currentSessionId) {
                if (typeof opts.toast === 'function') {
                    opts.toast('アクティブなセッションがありません', 'error');
                }
                return;
            }
            els.qr.hidden = false;
            if (els.passwd) {
                els.passwd.hidden = true;
                els.passwd.textContent = '';
            }
            if (els.qrCaption) {
                els.qrCaption.textContent = 'セッションに参加できるQR';
            }
            if (typeof opts.applyJoinQrToWrap === 'function') {
                opts.applyJoinQrToWrap(els.qr, els.qrImg, els.qrCaption, seat);
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
            var tableNo = Number(seat.tableNo || 0);
            var isUsing = String(seat.status || '').toUpperCase() === 'USING';
            var passPhrase = resolveTableSeatPassPhrase(seat, null, caches);
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

                if (!isUsing) {
                    var createSessionBtn = makeActionListButton('セッションの作成');
                    createSessionBtn.addEventListener('click', function () {
                        closeActionModal();
                        if (typeof opts.onCreateSession === 'function') {
                            opts.onCreateSession(tableNo);
                        }
                    });
                    els.list.appendChild(createSessionBtn);
                }

                if (isUsing && seat.currentSessionId) {
                    var joinQrBtn = makeActionListButton(
                        '注文QRを表示',
                        'セッションに参加できるQRを表示'
                    );
                    joinQrBtn.addEventListener('click', function () {
                        showJoinQrInActionModal(actionContext);
                    });
                    els.list.appendChild(joinQrBtn);
                }

                if (isUsing && seat.currentSessionId) {
                    var checkoutBtn = document.createElement('button');
                    checkoutBtn.type = 'button';
                    checkoutBtn.className = 'btn-danger-action';
                    checkoutBtn.textContent = '会計';
                    checkoutBtn.addEventListener('click', function () {
                        closeActionModal();
                        if (typeof opts.onCheckout === 'function') {
                            opts.onCheckout(seat.currentSessionId, 'テーブル ' + tableNo);
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
                                entryPin: seat.entryPin || '',
                                startTime: seat.startTime || ''
                            });
                        }
                    });
                    els.list.appendChild(detailBtn);

                    var connectBtn = document.createElement('button');
                    connectBtn.type = 'button';
                    connectBtn.className = 'table-seat-action-connect-btn';
                    connectBtn.textContent = 'セッション接続';
                    connectBtn.addEventListener('click', function () {
                        if (typeof opts.onConnectSession === 'function') {
                            opts.onConnectSession(actionContext || seat);
                        }
                    });
                    els.list.appendChild(connectBtn);
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
            void loadAndShowFixedQrInActionModal(actionContext);
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
            var isUsing = String(seat.status || '').toUpperCase() === 'USING';
            openActionModal(seat, { showQrImmediately: !isUsing });
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
        seatFromTableCard: seatFromTableCard,
        reconcileTableSeatCardDom: reconcileTableSeatCardDom,
        applyCheckoutPendingState: applyCheckoutPendingState
    };
})(typeof window !== 'undefined' ? window : globalThis);
