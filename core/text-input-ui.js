/**
 * テキスト入力のリアルタイム検証 UI（Staff 共通）。
 * @global MasterOrderTextInputUi
 */
(function (global) {
    'use strict';

    var LIMITS = {
        displayText: 35,
        shortLabel: 64,
        shopName: 120,
        plainMemo: 1000,
        sessionMemo: 500
    };

    function policyApi() {
        return global.MasterOrderTextPolicy || global.MasterOrderMenuCustomerText || null;
    }

    function validateValue(value, options) {
        var opts = options || {};
        var maxLength = opts.maxLength != null ? opts.maxLength : LIMITS.displayText;
        var multiline = opts.multiline === true;
        var api = policyApi();
        if (!api) {
            return { ok: true, reason: null };
        }
        if (typeof api.validateSingleLine === 'function' && !multiline) {
            return api.validateSingleLine(value, maxLength);
        }
        if (multiline && typeof api.plainText === 'function') {
            return api.plainText(value, maxLength);
        }
        if (typeof api.validate === 'function') {
            return api.validate(value);
        }
        return { ok: true, reason: null };
    }

    function syncInputState(input, options) {
        if (!input) {
            return { ok: true, reason: null };
        }
        var result = validateValue(input.value, options);
        var invalid = !result.ok;
        input.classList.toggle('is-invalid', invalid);
        if (options && options.counterEl) {
            var count = policyApi() && policyApi().countChars
                ? policyApi().countChars(input.value)
                : String(input.value || '').length;
            var maxLength = options.maxLength != null ? options.maxLength : LIMITS.displayText;
            options.counterEl.textContent = count + ' / ' + maxLength;
            options.counterEl.classList.toggle('is-invalid', invalid);
        }
        return result;
    }

    function bindInput(input, options) {
        if (!input) {
            return function () { return { ok: true, reason: null }; };
        }
        var handler = function () {
            return syncInputState(input, options);
        };
        input.addEventListener('input', handler);
        handler();
        return handler;
    }

    function toastMessage(fieldLabel, result, maxLength) {
        if (!result || result.ok) {
            return null;
        }
        if (result.reason === 'length') {
            return fieldLabel + 'は' + maxLength + '文字以内で入力してください';
        }
        return fieldLabel + 'に使用できない制御文字が含まれています';
    }

    function requireValid(input, fieldLabel, options) {
        var result = syncInputState(input, options);
        if (result.ok) {
            return true;
        }
        return toastMessage(fieldLabel, result, (options && options.maxLength) || LIMITS.displayText);
    }

    var api = {
        LIMITS: LIMITS,
        validateValue: validateValue,
        syncInputState: syncInputState,
        bindInput: bindInput,
        requireValid: requireValid,
        toastMessage: toastMessage,
        bindStaffProfileInputs: function (elements) {
            bindInput(elements.familyName, { maxLength: LIMITS.shortLabel });
            bindInput(elements.givenName, { maxLength: LIMITS.shortLabel });
        },
        bindStaffShopCreateInput: function (input) {
            bindInput(input, { maxLength: LIMITS.shopName });
        }
    };

    global.MasterOrderTextInputUi = api;
})(typeof window !== 'undefined' ? window : globalThis);
