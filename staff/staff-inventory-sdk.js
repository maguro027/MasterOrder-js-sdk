/**
 * スタッフ商品詳細 — 手動在庫編集（1分クールダウンは SDK + サーバー双方で防御）。
 *
 * 依存: api-routes.js
 * グローバル: MasterOrderStaffInventorySdk
 */
(function (global) {
    'use strict';

    var COOLDOWN_MS = 60 * 1000;
    var LIST_RESET_COOLDOWN_MS = 5 * 60 * 1000;
    var STORAGE_PREFIX = 'masterorder.staffInventoryCooldown.';
    var LIST_RESET_STORAGE_PREFIX = 'masterorder.staffInventoryListResetCooldown.';

    function clampStock(value) {
        var n = Number(value);
        if (!Number.isFinite(n) || n < 0) {
            return 0;
        }
        return Math.floor(n);
    }

    function menuIdOf(menu) {
        if (!menu) {
            return '';
        }
        return String(menu.id || menu.menuId || '').trim();
    }

    function readCooldownUntil(menuId) {
        if (!menuId) {
            return 0;
        }
        try {
            var raw = global.localStorage.getItem(STORAGE_PREFIX + menuId);
            var ts = Number(raw);
            return Number.isFinite(ts) ? ts : 0;
        } catch (_ignored) {
            return 0;
        }
    }

    function writeCooldownUntil(menuId, untilMs) {
        if (!menuId) {
            return;
        }
        try {
            global.localStorage.setItem(STORAGE_PREFIX + menuId, String(untilMs));
        } catch (_ignored) {
            /* ignore */
        }
    }

    function cooldownRemainingMs(menuId) {
        var until = readCooldownUntil(menuId);
        var remain = until - Date.now();
        return remain > 0 ? remain : 0;
    }

    function markCooldown(menuId) {
        writeCooldownUntil(menuId, Date.now() + COOLDOWN_MS);
    }

    function listResetCooldownKey(shopId) {
        return LIST_RESET_STORAGE_PREFIX + String(shopId || '').trim();
    }

    function listResetCooldownRemainingMs(shopId) {
        if (!shopId) {
            return 0;
        }
        try {
            var raw = global.localStorage.getItem(listResetCooldownKey(shopId));
            var until = Number(raw);
            if (!Number.isFinite(until)) {
                return 0;
            }
            var remain = until - Date.now();
            return remain > 0 ? remain : 0;
        } catch (_ignored) {
            return 0;
        }
    }

    function markListResetCooldown(shopId) {
        if (!shopId) {
            return;
        }
        try {
            global.localStorage.setItem(
                listResetCooldownKey(shopId),
                String(Date.now() + LIST_RESET_COOLDOWN_MS)
            );
        } catch (_ignored) {
            /* ignore */
        }
    }

    function formatListResetCooldownLabel(remainMs) {
        var sec = Math.max(1, Math.ceil(remainMs / 1000));
        var min = Math.floor(sec / 60);
        var rest = sec % 60;
        if (min > 0) {
            return '在庫リセット (' + min + ':' + String(rest).padStart(2, '0') + ')';
        }
        return '在庫リセット (' + sec + '秒)';
    }

    function buildStockResetConfirmCopy(menus) {
        var list = Array.isArray(menus) ? menus.filter(Boolean) : [];
        if (!list.length) {
            return { title: '', body: '' };
        }
        if (list.length === 1) {
            var single = list[0];
            var singleName = String(single.name || '(無題)').trim();
            var current = clampStock(single.stockQuantity);
            var target = clampStock(single.initialQuantity);
            return {
                title: singleName + 'の在庫を初期値へ戻しますか？',
                body: '在庫 ' + current + '個 → 在庫 ' + target + '個'
            };
        }
        var lines = [];
        var showCount = Math.min(3, list.length);
        for (var i = 0; i < showCount; i++) {
            lines.push(String(list[i].name || '(無題)').trim());
        }
        var restCount = list.length - showCount;
        if (restCount > 0) {
            lines.push('その他' + restCount + '品');
        }
        return {
            title: '選択アイテムの在庫を初期値へ戻しますか？',
            body: lines.join('\n')
        };
    }

    /**
     * @param {{
     *   elements: {
     *     panel: HTMLElement|null,
     *     initialDec: HTMLElement|null,
     *     initialInc: HTMLElement|null,
     *     initialValue: HTMLElement|null,
     *     stockDec: HTMLElement|null,
     *     stockInc: HTMLElement|null,
     *     stockValue: HTMLElement|null,
     *     applyBtn: HTMLElement|null,
     *     cooldownNote: HTMLElement|null
     *   },
     *   applyUpdate: function(menuId: string, payload: {initialQuantity:number, stockQuantity:number}): Promise<*>,
     *   onApplied?: function(result: *, menu: object): void,
     *   onError?: function(error: *): void
     * }} options
     */
    function createStaffInventoryEditor(options) {
        var opts = options || {};
        var els = opts.elements || {};
        var draft = {
            menu: null,
            initialQuantity: 0,
            stockQuantity: 0,
            applying: false
        };
        var cooldownTimer = null;

        function clearCooldownTimer() {
            if (cooldownTimer != null) {
                global.clearInterval(cooldownTimer);
                cooldownTimer = null;
            }
        }

        function formatCooldownLabel(remainMs) {
            var sec = Math.max(1, Math.ceil(remainMs / 1000));
            return '在庫を更新できるまであと ' + sec + ' 秒';
        }

        function isDirty() {
            if (!draft.menu) {
                return false;
            }
            var baseInitial = clampStock(draft.menu.initialQuantity);
            var baseStock = clampStock(draft.menu.stockQuantity);
            return draft.initialQuantity !== baseInitial || draft.stockQuantity !== baseStock;
        }

        function setQuantityDisplay(el, quantity) {
            if (!el) {
                return;
            }
            var text = String(quantity);
            // 詳細パネルは <input type="number">。textContent では表示が更新されない。
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
                el.value = text;
            } else {
                el.textContent = text;
            }
        }

        function refreshUi() {
            var menu = draft.menu;
            var menuId = menuIdOf(menu);
            var onCooldown = cooldownRemainingMs(menuId) > 0;
            var disabled = !menu || !!menu.isDraft || draft.applying || onCooldown || !isDirty();

            if (els.panel) {
                if (!menu || menu.isDraft) {
                    els.panel.setAttribute('hidden', '');
                } else {
                    els.panel.removeAttribute('hidden');
                }
            }
            setQuantityDisplay(els.initialValue, draft.initialQuantity);
            setQuantityDisplay(els.stockValue, draft.stockQuantity);
            var stepperDisabled = !menu || !!menu.isDraft || draft.applying;
            [els.initialDec, els.initialInc, els.stockDec, els.stockInc].forEach(function (btn) {
                if (btn) {
                    btn.disabled = stepperDisabled;
                }
            });
            if (els.applyBtn) {
                els.applyBtn.disabled = disabled;
                els.applyBtn.classList.toggle('is-cooldown', onCooldown);
            }
            if (els.cooldownNote) {
                if (onCooldown) {
                    els.cooldownNote.removeAttribute('hidden');
                    els.cooldownNote.textContent = formatCooldownLabel(cooldownRemainingMs(menuId));
                } else {
                    els.cooldownNote.setAttribute('hidden', '');
                    els.cooldownNote.textContent = '';
                }
            }
        }

        function ensureCooldownTicker() {
            clearCooldownTimer();
            if (!draft.menu || cooldownRemainingMs(menuIdOf(draft.menu)) <= 0) {
                return;
            }
            cooldownTimer = global.setInterval(function () {
                refreshUi();
                if (!draft.menu || cooldownRemainingMs(menuIdOf(draft.menu)) <= 0) {
                    clearCooldownTimer();
                }
            }, 1000);
        }

        function resetDraft(menu) {
            draft.menu = menu || null;
            draft.applying = false;
            if (!menu) {
                draft.initialQuantity = 0;
                draft.stockQuantity = 0;
            } else {
                draft.initialQuantity = clampStock(menu.initialQuantity);
                draft.stockQuantity = clampStock(menu.stockQuantity);
            }
            refreshUi();
            ensureCooldownTicker();
        }

        function bumpInitial(delta) {
            if (!draft.menu || draft.menu.isDraft || draft.applying) {
                return;
            }
            draft.initialQuantity = clampStock(draft.initialQuantity + delta);
            refreshUi();
        }

        function bumpStock(delta) {
            if (!draft.menu || draft.menu.isDraft || draft.applying) {
                return;
            }
            draft.stockQuantity = clampStock(draft.stockQuantity + delta);
            refreshUi();
        }

        function applyUpdate() {
            if (!draft.menu || draft.menu.isDraft || draft.applying) {
                return Promise.resolve(null);
            }
            var menuId = menuIdOf(draft.menu);
            if (!menuId) {
                return Promise.resolve(null);
            }
            if (cooldownRemainingMs(menuId) > 0) {
                refreshUi();
                return Promise.resolve(null);
            }
            if (!isDirty()) {
                return Promise.resolve(null);
            }
            if (typeof opts.applyUpdate !== 'function') {
                return Promise.reject(new Error('applyUpdate is not configured'));
            }

            draft.applying = true;
            refreshUi();
            var payload = {
                initialQuantity: draft.initialQuantity,
                stockQuantity: draft.stockQuantity
            };
            return Promise.resolve(opts.applyUpdate(menuId, payload))
                .then(function (result) {
                    markCooldown(menuId);
                    draft.menu.initialQuantity = draft.initialQuantity;
                    draft.menu.stockQuantity = draft.stockQuantity;
                    if (result && result.stockQuantity != null) {
                        draft.menu.stockQuantity = clampStock(result.stockQuantity);
                        draft.stockQuantity = draft.menu.stockQuantity;
                    }
                    if (result && result.initialQuantity != null) {
                        draft.menu.initialQuantity = clampStock(result.initialQuantity);
                        draft.initialQuantity = draft.menu.initialQuantity;
                    }
                    if (typeof result.soldOut === 'boolean') {
                        draft.menu.soldOut = result.soldOut;
                    }
                    if (result.stockStatusLabel) {
                        draft.menu.stockStatusLabel = result.stockStatusLabel;
                    }
                    if (typeof opts.onApplied === 'function') {
                        opts.onApplied(result, draft.menu);
                    }
                    return result;
                })
                .catch(function (err) {
                    if (typeof opts.onError === 'function') {
                        opts.onError(err);
                    }
                    throw err;
                })
                .finally(function () {
                    draft.applying = false;
                    refreshUi();
                    ensureCooldownTicker();
                });
        }

        function bindClick(el, handler) {
            if (!el) {
                return;
            }
            el.addEventListener('click', handler);
        }

        bindClick(els.initialDec, function () { bumpInitial(-1); });
        bindClick(els.initialInc, function () { bumpInitial(1); });
        bindClick(els.stockDec, function () { bumpStock(-1); });
        bindClick(els.stockInc, function () { bumpStock(1); });
        bindClick(els.applyBtn, function () { void applyUpdate(); });

        return {
            COOLDOWN_MS: COOLDOWN_MS,
            resetDraft: resetDraft,
            bumpInitial: bumpInitial,
            bumpStock: bumpStock,
            applyUpdate: applyUpdate,
            refreshUi: refreshUi,
            cooldownRemainingMs: function () {
                return cooldownRemainingMs(menuIdOf(draft.menu));
            },
            dispose: function () {
                clearCooldownTimer();
                draft.menu = null;
            }
        };
    }

    global.MasterOrderStaffInventorySdk = {
        COOLDOWN_MS: COOLDOWN_MS,
        LIST_RESET_COOLDOWN_MS: LIST_RESET_COOLDOWN_MS,
        clampStock: clampStock,
        cooldownRemainingMs: cooldownRemainingMs,
        markCooldown: markCooldown,
        listResetCooldownRemainingMs: listResetCooldownRemainingMs,
        markListResetCooldown: markListResetCooldown,
        formatListResetCooldownLabel: formatListResetCooldownLabel,
        buildStockResetConfirmCopy: buildStockResetConfirmCopy,
        createStaffInventoryEditor: createStaffInventoryEditor
    };
})(typeof window !== 'undefined' ? window : globalThis);
