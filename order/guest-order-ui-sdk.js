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
        var frag = global.document.createDocumentFragment();
        history.slice().reverse().forEach(function (order) {
            var row = global.document.createElement('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.marginBottom = '8px';
            row.style.fontSize = '14px';
            row.style.borderBottom = '1px solid #333';
            row.style.paddingBottom = '8px';

            var left = global.document.createElement('span');
            var lines = [];
            if (orderSdk && typeof orderSdk.formatOrderHistoryLines === 'function') {
                lines = orderSdk.formatOrderHistoryLines(order, opts.menus || [], { lang: lang });
            } else if (Array.isArray(order.lines)) {
                lines = order.lines;
            }
            left.textContent = ((order.timestamp || '') + ' ' + lines.join(' / ')).trim();

            var right = global.document.createElement('span');
            right.textContent = '¥' + Number(order.total || 0).toLocaleString();

            row.appendChild(left);
            row.appendChild(right);
            frag.appendChild(row);
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
            renderLanguagePicker: function (renderOpts) {
                renderLanguagePicker(Object.assign({ orderSdk: orderSdk }, renderOpts || {}));
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
        renderLanguagePicker: renderLanguagePicker,
        createGuestOrderPageUi: createGuestOrderPageUi
    };
})(typeof window !== 'undefined' ? window : globalThis);
