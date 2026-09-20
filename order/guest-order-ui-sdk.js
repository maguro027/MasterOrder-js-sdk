/**
 * 来客 Order ページ UI — 文言・カート・履歴・言語ピッカー（HTML は薄く保つ）
 *
 * 依存: guest-ui-i18n.js, order-sdk.js（MasterOrderSdk）
 * グローバル: MasterOrderGuestOrderUiSdk
 */
(function (global) {
    'use strict';

    var SDK_VERSION = '1.0.0';

    function i18n() {
        return global.MasterOrderGuestUiI18n;
    }

    function resolveLang(orderSdk, lang) {
        if (lang) {
            return i18n() ? i18n().normalizeLang(lang) : String(lang);
        }
        if (orderSdk && typeof orderSdk.getGuestMenuLang === 'function') {
            return orderSdk.getGuestMenuLang();
        }
        return 'ja';
    }

    function t(orderSdk, key, vars, lang) {
        var ui = i18n();
        if (!ui) {
            return key;
        }
        var resolved = resolveLang(orderSdk, lang);
        return vars ? ui.format(key, resolved, vars) : ui.t(key, resolved);
    }

    function applyStaticLabels(root, orderSdk, lang) {
        var ui = i18n();
        if (!ui) {
            return;
        }
        ui.apply(root || global.document, resolveLang(orderSdk, lang));
    }

    function syncConnectControls(elements, orderSdk, manualSectionHidden) {
        if (!elements) {
            return;
        }
        if (elements.connectBtn && elements.connectBtn.dataset.loading !== '1') {
            elements.connectBtn.textContent = t(orderSdk, 'connectBtn');
        }
        if (elements.toggleManualBtn) {
            var hidden = manualSectionHidden;
            if (hidden == null && elements.manualConnectSection) {
                hidden = elements.manualConnectSection.style.display === 'none';
            }
            elements.toggleManualBtn.textContent = t(orderSdk, hidden ? 'connectManualOpen' : 'connectManualClose');
        }
    }

    function resolveMenuName(orderSdk, menuId, menus, fallbackName, lang) {
        if (orderSdk && typeof orderSdk.resolveGuestMenuDisplayName === 'function') {
            return orderSdk.resolveGuestMenuDisplayName(menuId, menus, fallbackName);
        }
        return fallbackName || t(orderSdk, 'unknownMenu', null, lang);
    }

    /**
     * @param {{
     *   cart: Array,
     *   menus: Array,
     *   orderSdk: object,
     *   lang?: string,
     *   isMenuReady?: boolean,
     *   orderSending?: boolean,
     *   elements: {
     *     cartList: Element,
     *     orderBarText?: Element,
     *     cartBadge?: Element,
     *     cartTotal?: Element,
     *     orderBar?: Element
     *   },
     *   onQtyChange?: function(number, number): void,
     *   onSendOrder?: function(): void,
     *   onAfterRender?: function(): void
     * }} options
     */
    function renderCart(options) {
        var opts = options || {};
        var cart = Array.isArray(opts.cart) ? opts.cart : [];
        var menus = Array.isArray(opts.menus) ? opts.menus : [];
        var orderSdk = opts.orderSdk;
        var sending = opts.orderSending === true;
        var el = opts.elements || {};
        var list = el.cartList;
        if (!list) {
            return;
        }

        var count = cart.reduce(function (sum, item) {
            return sum + Number(item && item.quantity ? item.quantity : 0);
        }, 0);
        var tax = global.MasterOrderConsumptionTax;
        var total = tax && typeof tax.calculateCartGrandTotal === 'function'
            ? tax.calculateCartGrandTotal(cart, opts.sessionType)
            : cart.reduce(function (sum, item) {
                var unit = Number(item && item.priceAtOrder ? item.priceAtOrder : 0)
                    + Number(item && item.toppingPrice ? item.toppingPrice : 0);
                var qty = Number(item && item.quantity ? item.quantity : 0);
                return sum + unit * qty;
            }, 0);

        if (el.orderBarText) {
            el.orderBarText.textContent = t(orderSdk, 'orderBar', { count: count }, opts.lang);
        }
        if (el.cartBadge) {
            el.cartBadge.textContent = String(count);
            el.cartBadge.style.display = count > 0 ? 'block' : 'none';
        }
        if (el.cartTotal) {
            el.cartTotal.textContent = '¥' + total.toLocaleString();
        }
        if (el.orderBar) {
            el.orderBar.style.display = count > 0 ? 'flex' : 'none';
        }

        list.replaceChildren();
        if (!cart.length) {
            var empty = global.document.createElement('p');
            empty.style.textAlign = 'center';
            empty.style.color = 'var(--text-sub)';
            empty.textContent = t(orderSdk, 'cartEmpty', null, opts.lang);
            list.appendChild(empty);
            if (typeof opts.onAfterRender === 'function') {
                opts.onAfterRender();
            }
            return;
        }

        var frag = global.document.createDocumentFragment();
        var priceNotice = String(opts.priceNotice || '').trim();
        if (priceNotice) {
            var notice = global.document.createElement('div');
            notice.className = 'cart-price-notice';
            notice.setAttribute('role', 'status');
            notice.style.margin = '0 0 12px';
            notice.style.padding = '10px 12px';
            notice.style.borderRadius = '10px';
            notice.style.background = 'rgba(240, 192, 64, 0.14)';
            notice.style.border = '1px solid rgba(240, 192, 64, 0.45)';
            notice.style.color = '#f0c040';
            notice.style.fontSize = '13px';
            notice.style.lineHeight = '1.5';
            notice.textContent = priceNotice;
            frag.appendChild(notice);
        }
        cart.forEach(function (item, index) {
            var card = global.document.createElement('div');
            card.className = 'list-card';

            var left = global.document.createElement('div');
            var name = global.document.createElement('div');
            name.style.fontWeight = 'bold';
            name.textContent = resolveMenuName(
                orderSdk,
                item.menuId,
                menus,
                item.menuName,
                opts.lang
            );
            var price = global.document.createElement('div');
            price.style.color = 'var(--primary)';
            var unitPrice = Number(item.priceAtOrder || 0) + Number(item.toppingPrice || 0);
            price.textContent = '¥' + (unitPrice * Number(item.quantity || 0)).toLocaleString();
            left.appendChild(name);
            if (item.toppingNames && item.toppingNames.length) {
                var toppingInfo = global.document.createElement('div');
                toppingInfo.style.fontSize = '12px';
                toppingInfo.style.color = 'var(--text-sub)';
                toppingInfo.textContent = item.toppingNames.join(', ');
                left.appendChild(toppingInfo);
            }
            left.appendChild(price);

            var right = global.document.createElement('div');
            right.className = 'qty-wrap';

            var minus = global.document.createElement('button');
            minus.type = 'button';
            minus.className = 'qty-btn';
            minus.textContent = '-';
            minus.disabled = sending;
            minus.addEventListener('click', function () {
                if (sending) {
                    return;
                }
                if (typeof opts.onQtyChange === 'function') {
                    opts.onQtyChange(index, -1);
                }
            });

            var qty = global.document.createElement('span');
            qty.textContent = String(item.quantity);

            var plus = global.document.createElement('button');
            plus.type = 'button';
            plus.className = 'qty-btn';
            plus.textContent = '+';
            plus.disabled = sending;
            plus.addEventListener('click', function () {
                if (sending) {
                    return;
                }
                if (typeof opts.onQtyChange === 'function') {
                    opts.onQtyChange(index, 1);
                }
            });

            right.appendChild(minus);
            right.appendChild(qty);
            right.appendChild(plus);

            card.appendChild(left);
            card.appendChild(right);
            frag.appendChild(card);
        });

        var sendBtn = global.document.createElement('button');
        sendBtn.id = 'sendOrderBtn';
        sendBtn.type = 'button';
        sendBtn.className = 'btn-primary' + (sending ? ' is-sending' : '');
        sendBtn.style.marginTop = '20px';
        sendBtn.disabled = sending || !opts.isMenuReady || !cart.length;
        sendBtn.setAttribute('aria-busy', sending ? 'true' : 'false');
        if (sending) {
            sendBtn.textContent = t(orderSdk, 'sendOrderSending', null, opts.lang);
        } else {
            sendBtn.textContent = opts.isMenuReady
                ? t(orderSdk, 'sendOrder', null, opts.lang)
                : t(orderSdk, 'sendOrderLoading', null, opts.lang);
        }
        sendBtn.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (sending || sendBtn.disabled) {
                return;
            }
            if (typeof opts.onSendOrder === 'function') {
                opts.onSendOrder();
            }
        });
        frag.appendChild(sendBtn);

        list.appendChild(frag);
        if (typeof opts.onAfterRender === 'function') {
            opts.onAfterRender();
        }
    }

    function lineCancelState(item) {
        if (!item) {
            return { fullyCancelled: false, partiallyCancelled: false };
        }
        var cancelledQty = item.cancelledQuantity != null ? Number(item.cancelledQuantity) : 0;
        var qty = item.quantity != null ? Number(item.quantity) : 0;
        var fullyCancelled = item.fullyCancelled === true || (qty > 0 && cancelledQty >= qty);
        return {
            fullyCancelled: fullyCancelled,
            partiallyCancelled: !fullyCancelled && cancelledQty > 0
        };
    }

    function splitQtyChangeSuffix(text) {
        var raw = String(text || '');
        // 「5個→1個」/「5 → 1」などを本文と分離（打ち消し線を数量変更だけ外す）
        var match = raw.match(/^(.*?)([\s\u3000]+)(\d+\s*個?\s*→\s*\d+\s*個?)\s*$/);
        if (!match) {
            return { body: raw, qtyChange: '' };
        }
        return { body: match[1], qtyChange: match[3] };
    }

    function appendHistoryLines(container, lines, items) {
        var hasLineCancel = false;
        lines.forEach(function (line, idx) {
            var text = (line && typeof line === 'object' && line.text != null)
                ? String(line.text)
                : String(line || '');
            var item = Array.isArray(items) ? (items[idx] || null) : null;
            var cancel = lineCancelState(item);
            var row = global.document.createElement('div');
            row.className = 'order-history-line';
            if (cancel.fullyCancelled) {
                row.classList.add('is-cancelled');
                hasLineCancel = true;
                row.textContent = text;
            } else if (cancel.partiallyCancelled) {
                row.classList.add('is-partially-cancelled');
                hasLineCancel = true;
                var parts = splitQtyChangeSuffix(text);
                var body = global.document.createElement('span');
                body.className = 'order-history-line-body';
                body.textContent = parts.body;
                row.appendChild(body);
                if (parts.qtyChange) {
                    var qty = global.document.createElement('span');
                    qty.className = 'order-history-line-qty-change';
                    qty.textContent = parts.qtyChange;
                    row.appendChild(qty);
                }
            } else {
                row.textContent = text;
            }
            container.appendChild(row);
        });
        return hasLineCancel;
    }

    function ensureHistoryDetailModal(orderSdk, lang) {
        var existing = global.document.getElementById('orderHistoryDetailModal');
        if (existing) {
            return existing;
        }
        var modal = global.document.createElement('div');
        modal.id = 'orderHistoryDetailModal';
        modal.className = 'modal order-history-detail-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'orderHistoryDetailTitle');
        modal.innerHTML =
            '<div class="modal-card order-history-detail-card">'
            + '<div class="modal-handle" aria-hidden="true"></div>'
            + '<div class="modal-title" id="orderHistoryDetailTitle"></div>'
            + '<div class="order-history-detail-meta" id="orderHistoryDetailMeta"></div>'
            + '<div class="order-history-detail-lines" id="orderHistoryDetailLines"></div>'
            + '<div class="order-history-detail-total" id="orderHistoryDetailTotal"></div>'
            + '<div class="modal-foot">'
            + '<button type="button" class="btn-primary" id="orderHistoryDetailCloseBtn"></button>'
            + '</div>'
            + '</div>';
        global.document.body.appendChild(modal);

        function closeModal() {
            modal.classList.remove('show');
        }
        modal.addEventListener('click', function (ev) {
            if (ev.target === modal) {
                closeModal();
            }
        });
        var closeBtn = modal.querySelector('#orderHistoryDetailCloseBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeModal);
        }
        return modal;
    }

    function openOrderHistoryDetail(order, options) {
        var opts = options || {};
        var orderSdk = opts.orderSdk;
        var lang = resolveLang(orderSdk, opts.lang);
        var menus = opts.menus || [];
        var modal = ensureHistoryDetailModal(orderSdk, lang);
        var titleEl = modal.querySelector('#orderHistoryDetailTitle');
        var metaEl = modal.querySelector('#orderHistoryDetailMeta');
        var linesEl = modal.querySelector('#orderHistoryDetailLines');
        var totalEl = modal.querySelector('#orderHistoryDetailTotal');
        var closeBtn = modal.querySelector('#orderHistoryDetailCloseBtn');

        if (titleEl) {
            titleEl.textContent = t(orderSdk, 'historyDetailTitle', null, lang);
        }
        if (closeBtn) {
            closeBtn.textContent = t(orderSdk, 'historyDetailClose', null, lang);
        }
        if (metaEl) {
            metaEl.replaceChildren();
            var time = global.document.createElement('div');
            time.className = 'order-history-detail-time';
            time.textContent = String(order && order.timestamp || '').trim();
            metaEl.appendChild(time);
            var status = String(order && order.status || '').toUpperCase();
            if (status === 'CANCELLED') {
                var cancelled = global.document.createElement('div');
                cancelled.className = 'order-history-card-cancelled';
                cancelled.textContent = t(orderSdk, 'historyCancelled', null, lang);
                metaEl.appendChild(cancelled);
            }
        }
        if (linesEl) {
            linesEl.replaceChildren();
            var items = Array.isArray(order && order.items) ? order.items : [];
            if (items.length) {
                items.forEach(function (rawItem) {
                    var item = rawItem;
                    if (orderSdk && typeof orderSdk.normalizeOrderHistoryItem === 'function') {
                        item = orderSdk.normalizeOrderHistoryItem(rawItem) || rawItem;
                    }
                    var name = resolveMenuName(
                        orderSdk,
                        item && item.menuId,
                        menus,
                        (item && item.menuName) || t(orderSdk, 'unknownMenu', null, lang),
                        lang
                    );
                    var qty = item && item.quantity != null ? Number(item.quantity) : 0;
                    var cancel = lineCancelState(item);
                    var activeQty = item && item.activeQuantity != null
                        ? Number(item.activeQuantity)
                        : Math.max(0, qty - Number((item && item.cancelledQuantity) || 0));
                    var row = global.document.createElement('div');
                    row.className = 'order-history-detail-line';
                    if (cancel.fullyCancelled) {
                        row.classList.add('is-cancelled');
                    } else if (cancel.partiallyCancelled) {
                        row.classList.add('is-partially-cancelled');
                    }
                    var main = global.document.createElement('div');
                    main.className = 'order-history-detail-line-main';
                    var left = global.document.createElement('div');
                    left.className = 'order-history-detail-line-name';
                    if (cancel.fullyCancelled) {
                        left.textContent = name + ' × ' + qty + '（' + t(orderSdk, 'historyCancelled', null, lang) + '）';
                    } else if (cancel.partiallyCancelled) {
                        var qtyChange = t(orderSdk, 'historyQtyChange', { from: qty, to: activeQty }, lang);
                        left.textContent = name + ' × ' + activeQty + ' / ' + qty
                            + '（' + t(orderSdk, 'historyPartialLine', null, lang) + '）';
                        if (qtyChange) {
                            var qtyEl = global.document.createElement('span');
                            qtyEl.className = 'order-history-detail-qty-change';
                            qtyEl.textContent = qtyChange;
                            left.appendChild(qtyEl);
                        }
                    } else {
                        left.textContent = name + ' × ' + qty;
                    }
                    var right = global.document.createElement('div');
                    right.className = 'order-history-detail-line-price';
                    var unit = Number(
                        (item && (item.unitPrice != null ? item.unitPrice : item.priceAtOrder)) || 0
                    ) + Number((item && item.toppingPrice) || 0);
                    var lineTotal = item && item.subTotal != null
                        ? Number(item.subTotal)
                        : unit * Math.max(0, (item && item.activeQuantity != null)
                            ? Number(item.activeQuantity)
                            : qty - Number((item && item.cancelledQuantity) || 0));
                    var amount = Number(lineTotal);
                    if (!Number.isFinite(amount)) {
                        amount = 0;
                    }
                    right.textContent = amount < 0
                        ? '−¥' + Math.abs(amount).toLocaleString()
                        : '¥' + amount.toLocaleString();
                    main.appendChild(left);
                    main.appendChild(right);
                    row.appendChild(main);

                    var toppings = item && Array.isArray(item.toppings) ? item.toppings : [];
                    var topWrap = global.document.createElement('div');
                    topWrap.className = 'order-history-detail-toppings';
                    var topLabel = global.document.createElement('div');
                    topLabel.className = 'order-history-detail-customs-label';
                    topLabel.textContent = t(orderSdk, 'historyCustomLabel', null, lang);
                    topWrap.appendChild(topLabel);
                    if (toppings.length) {
                        toppings.forEach(function (top) {
                            var tip = global.document.createElement('div');
                            tip.className = 'order-history-detail-topping';
                            var tipName = top && top.name ? String(top.name) : '';
                            if (!tipName && typeof top === 'string') {
                                tipName = top;
                            }
                            var tipPrice = top && top.price != null ? Number(top.price) : 0;
                            tip.textContent = tipPrice > 0
                                ? ('+ ' + tipName + '（¥' + tipPrice.toLocaleString() + '）')
                                : ('+ ' + tipName);
                            topWrap.appendChild(tip);
                        });
                    } else {
                        var none = global.document.createElement('div');
                        none.className = 'order-history-detail-topping is-empty';
                        none.textContent = t(orderSdk, 'historyNoCustom', null, lang);
                        topWrap.appendChild(none);
                    }
                    row.appendChild(topWrap);
                    linesEl.appendChild(row);
                });
            } else {
                var lines = [];
                if (orderSdk && typeof orderSdk.formatOrderHistoryLines === 'function') {
                    lines = orderSdk.formatOrderHistoryLines(order, menus, { lang: lang });
                } else if (order && Array.isArray(order.lines)) {
                    lines = order.lines;
                }
                lines.forEach(function (line) {
                    var row = global.document.createElement('div');
                    row.className = 'order-history-detail-line';
                    row.textContent = (line && typeof line === 'object' && line.text != null)
                        ? String(line.text)
                        : String(line || '');
                    linesEl.appendChild(row);
                });
            }
        }
        if (totalEl) {
            var displayTotal = order && order.total;
            if (orderSdk && typeof orderSdk.resolveOrderHistoryDisplayTotal === 'function') {
                displayTotal = orderSdk.resolveOrderHistoryDisplayTotal(order);
            }
            totalEl.textContent = t(orderSdk, 'historyDetailTotal', null, lang)
                + ' ¥' + Number(displayTotal || 0).toLocaleString();
        }
        modal.classList.add('show');
    }

    /**
     * @param {{
     *   orderHistory: Array,
     *   menus: Array,
     *   orderSdk: object,
     *   lang?: string,
     *   elements: { orderHistoryList: Element }
     * }} options
     */
    function renderOrderHistory(options) {
        var opts = options || {};
        var history = Array.isArray(opts.orderHistory) ? opts.orderHistory : [];
        var orderSdk = opts.orderSdk;
        var list = opts.elements && opts.elements.orderHistoryList;
        if (!list) {
            return;
        }

        list.replaceChildren();
        if (!history.length) {
            var empty = global.document.createElement('p');
            empty.style.textAlign = 'center';
            empty.style.color = 'var(--text-sub)';
            empty.textContent = t(orderSdk, 'historyEmpty', null, opts.lang);
            list.appendChild(empty);
            return;
        }

        var lang = resolveLang(orderSdk, opts.lang);
        var sendingStatus = orderSdk && orderSdk.ORDER_SEND_STATUS
            ? orderSdk.ORDER_SEND_STATUS.SENDING
            : 'sending';
        var frag = global.document.createDocumentFragment();
        history.slice().reverse().forEach(function (order) {
            var card = global.document.createElement('button');
            card.type = 'button';
            card.className = 'order-history-card';
            var isCancelled = String(order && order.status || '').toUpperCase() === 'CANCELLED';
            if (isCancelled) {
                card.classList.add('is-cancelled');
            }

            var body = global.document.createElement('div');
            body.className = 'order-history-card-body';

            var left = global.document.createElement('div');
            left.className = 'order-history-card-lines';
            var lines = [];
            if (orderSdk && typeof orderSdk.formatOrderHistoryLines === 'function') {
                lines = orderSdk.formatOrderHistoryLines(order, opts.menus || [], { lang: lang });
            } else if (Array.isArray(order.lines)) {
                lines = order.lines;
            }
            var time = global.document.createElement('div');
            time.className = 'order-history-card-time';
            time.textContent = String(order.timestamp || '').trim();
            left.appendChild(time);
            if (lines.length) {
                var detail = global.document.createElement('div');
                detail.className = 'order-history-card-detail';
                var items = Array.isArray(order.items) ? order.items : [];
                var hasLineCancel = appendHistoryLines(detail, lines, items);
                left.appendChild(detail);
                if (!isCancelled && hasLineCancel) {
                    var partialMsg = global.document.createElement('div');
                    partialMsg.className = 'order-history-card-cancelled';
                    partialMsg.textContent = t(orderSdk, 'historyPartiallyCancelled', null, opts.lang)
                        || '一部の商品がキャンセルされました';
                    left.appendChild(partialMsg);
                }
            }
            if (isCancelled) {
                var cancelledMsg = global.document.createElement('div');
                cancelledMsg.className = 'order-history-card-cancelled';
                cancelledMsg.textContent = t(orderSdk, 'historyCancelled', null, opts.lang);
                left.appendChild(cancelledMsg);
            }

            var right = global.document.createElement('div');
            right.className = 'order-history-card-total';
            var displayTotal = order.total;
            if (orderSdk && typeof orderSdk.resolveOrderHistoryDisplayTotal === 'function') {
                displayTotal = orderSdk.resolveOrderHistoryDisplayTotal(order);
            }
            right.textContent = '¥' + Number(displayTotal || 0).toLocaleString();

            body.appendChild(left);
            body.appendChild(right);
            card.appendChild(body);

            var isSending = !isCancelled && order.sendStatus === sendingStatus;
            if (isSending) {
                card.disabled = true;
                var overlay = global.document.createElement('div');
                overlay.className = 'order-history-sending-overlay';
                overlay.setAttribute('aria-live', 'polite');
                overlay.setAttribute('aria-busy', 'true');

                var spinner = global.document.createElement('div');
                spinner.className = 'order-history-spinner';
                spinner.setAttribute('aria-hidden', 'true');

                var label = global.document.createElement('p');
                label.className = 'order-history-sending-label';
                label.textContent = t(orderSdk, 'sendOrderSendingCard', null, opts.lang);

                overlay.appendChild(spinner);
                overlay.appendChild(label);
                card.appendChild(overlay);
            } else {
                card.addEventListener('click', function () {
                    openOrderHistoryDetail(order, {
                        orderSdk: orderSdk,
                        menus: opts.menus || [],
                        lang: lang
                    });
                });
            }

            frag.appendChild(card);
        });

        list.appendChild(frag);
    }

    /**
     * @param {{
     *   orderSdk: object,
     *   availableLanguages: Array<string>,
     *   elements: { guestLangPicker: Element },
     *   onLanguageSelected?: function(string): void|Promise<void>
     * }} options
     */
    function renderLanguagePicker(options) {
        var opts = options || {};
        var picker = opts.elements && opts.elements.guestLangPicker;
        var orderSdk = opts.orderSdk;
        if (!picker || !orderSdk) {
            return;
        }
        var langs = Array.isArray(opts.availableLanguages) ? opts.availableLanguages : ['ja'];
        var current = orderSdk.getGuestMenuLang();
        picker.replaceChildren();
        langs.forEach(function (lang) {
            var btn = global.document.createElement('button');
            btn.type = 'button';
            btn.className = 'guest-lang-option' + (lang === current ? ' is-selected' : '');
            btn.textContent = typeof orderSdk.guestMenuLanguageLabel === 'function'
                ? orderSdk.guestMenuLanguageLabel(lang)
                : lang;
            btn.addEventListener('click', function () {
                if (typeof orderSdk.setGuestMenuLang === 'function') {
                    orderSdk.setGuestMenuLang(lang);
                }
                if (typeof opts.onLanguageSelected === 'function') {
                    void opts.onLanguageSelected(lang);
                }
            });
            picker.appendChild(btn);
        });
    }

    /**
     * @param {{
     *   orderSdk: object,
     *   elements: { guestAllergyPicker: Element },
     *   onAllergiesChanged?: function(Array<string>): void|Promise<void>
     * }} options
     */
    function renderAllergyPicker(options) {
        var opts = options || {};
        var picker = opts.elements && opts.elements.guestAllergyPicker;
        var orderSdk = opts.orderSdk;
        if (!picker || !orderSdk || typeof orderSdk.getGuestHiddenAllergies !== 'function') {
            return;
        }
        var lang = opts.lang
            || (typeof orderSdk.getGuestMenuLang === 'function' ? orderSdk.getGuestMenuLang() : 'ja');
        var optionsList;
        if (typeof orderSdk.guestAllergyOptions === 'function') {
            optionsList = orderSdk.guestAllergyOptions(lang);
        } else if (Array.isArray(orderSdk.GUEST_ALLERGY_OPTIONS)) {
            optionsList = orderSdk.GUEST_ALLERGY_OPTIONS;
        } else {
            optionsList = [];
        }
        var selected = typeof orderSdk.getGuestHiddenAllergies === 'function'
            ? orderSdk.getGuestHiddenAllergies()
            : [];
        var selectedSet = {};
        selected.forEach(function (code) {
            selectedSet[code] = true;
        });
        picker.replaceChildren();
        var catalog = global.MasterOrderAllergens;
        optionsList.forEach(function (pair) {
            var code = pair[0];
            var label = pair[1];
            var emoji = '';
            if (catalog && catalog.BY_CODE && catalog.BY_CODE[code]) {
                emoji = catalog.BY_CODE[code].emoji || '';
            }
            var row = global.document.createElement('label');
            row.className = 'guest-allergy-option' + (selectedSet[code] ? ' is-selected' : '');
            var input = global.document.createElement('input');
            input.type = 'checkbox';
            input.value = code;
            input.checked = !!selectedSet[code];
            input.addEventListener('change', function () {
                var next = [];
                picker.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
                    if (cb.checked) {
                        next.push(cb.value);
                    }
                });
                if (typeof orderSdk.setGuestHiddenAllergies === 'function') {
                    orderSdk.setGuestHiddenAllergies(next);
                }
                row.classList.toggle('is-selected', !!input.checked);
                if (typeof opts.onAllergiesChanged === 'function') {
                    void opts.onAllergiesChanged(next);
                }
            });
            var emojiEl = global.document.createElement('span');
            emojiEl.className = 'guest-allergy-emoji';
            emojiEl.setAttribute('aria-hidden', 'true');
            emojiEl.textContent = emoji;
            var text = global.document.createElement('span');
            text.className = 'guest-allergy-label';
            text.textContent = typeof orderSdk.guestAllergyLabel === 'function'
                ? (function () {
                    var full = orderSdk.guestAllergyLabel(code, lang);
                    if (emoji && full.indexOf(emoji) === 0) {
                        return full.slice(emoji.length).trim();
                    }
                    return full || label;
                })()
                : label;
            row.appendChild(input);
            row.appendChild(emojiEl);
            row.appendChild(text);
            picker.appendChild(row);
        });
    }

    /**
     * @param {{
     *   orderSdk: object,
     *   root?: Document|Element,
     *   elements?: object,
     *   manualSectionHidden?: boolean,
     *   onAfterApply?: function(): void
     * }} options
     */
    function applyLanguage(options) {
        var opts = options || {};
        applyStaticLabels(opts.root, opts.orderSdk, opts.lang);
        syncConnectControls(opts.elements, opts.orderSdk, opts.manualSectionHidden);
        if (typeof opts.onAfterApply === 'function') {
            opts.onAfterApply();
        }
    }

    /**
     * @param {{ orderSdk: object }} options
     */
    function createGuestOrderPageUi(options) {
        var orderSdk = options && options.orderSdk;
        if (!orderSdk) {
            throw new Error('createGuestOrderPageUi: orderSdk is required');
        }
        return {
            t: function (key, vars, lang) {
                return t(orderSdk, key, vars, lang);
            },
            applyLanguage: function (applyOpts) {
                applyLanguage(Object.assign({ orderSdk: orderSdk }, applyOpts || {}));
            },
            renderCart: function (renderOpts) {
                renderCart(Object.assign({ orderSdk: orderSdk }, renderOpts || {}));
            },
            renderOrderHistory: function (renderOpts) {
                renderOrderHistory(Object.assign({ orderSdk: orderSdk }, renderOpts || {}));
            },
            openOrderHistoryDetail: function (order, openOpts) {
                openOrderHistoryDetail(order, Object.assign({ orderSdk: orderSdk }, openOpts || {}));
            },
            renderLanguagePicker: function (renderOpts) {
                renderLanguagePicker(Object.assign({ orderSdk: orderSdk }, renderOpts || {}));
            },
            renderAllergyPicker: function (renderOpts) {
                renderAllergyPicker(Object.assign({ orderSdk: orderSdk }, renderOpts || {}));
            },
            formatCartAddedMessage: function (menuName, lang) {
                return t(orderSdk, 'cartAdded', { name: menuName || t(orderSdk, 'unnamed', null, lang) }, lang);
            }
        };
    }

    global.MasterOrderGuestOrderUiSdk = {
        version: SDK_VERSION,
        t: t,
        applyStaticLabels: applyStaticLabels,
        syncConnectControls: syncConnectControls,
        applyLanguage: applyLanguage,
        renderCart: renderCart,
        renderOrderHistory: renderOrderHistory,
        openOrderHistoryDetail: openOrderHistoryDetail,
        renderLanguagePicker: renderLanguagePicker,
        renderAllergyPicker: renderAllergyPicker,
        createGuestOrderPageUi: createGuestOrderPageUi
    };
})(typeof window !== 'undefined' ? window : globalThis);
