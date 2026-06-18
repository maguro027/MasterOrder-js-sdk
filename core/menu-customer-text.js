/**

 * 来客向けメニュー名・説明の文字ポリシー（Staff / Order SDK 共通）。

 * XSS は出力エスケープで防御。入力は制御文字と長さのみチェック。

 * @global MasterOrderMenuCustomerText

 */

(function (global) {

    'use strict';



    var NAME_MAX_LENGTH = 35;

    var DESCRIPTION_MAX_LENGTH = 100;
    var STAFF_MEMO_MAX_LENGTH = 300;



    function isForbiddenControl(codePoint, allowNewlines) {

        if (codePoint === 0xFEFF) {

            return true;

        }

        if (codePoint < 0x20) {

            if (allowNewlines && (codePoint === 0x09 || codePoint === 0x0A || codePoint === 0x0D)) {

                return false;

            }

            return true;

        }

        if (codePoint === 0x7F) {

            return true;

        }

        return false;

    }



    function countChars(value) {

        return Array.from(String(value ?? '')).length;

    }



    function validate(value, maxLength, allowNewlines) {

        var text = String(value ?? '');

        var max = maxLength != null ? maxLength : NAME_MAX_LENGTH;

        var multiline = allowNewlines === true;

        if (!text) {

            return { ok: true, reason: null };

        }

        if (countChars(text) > max) {

            return { ok: false, reason: 'length' };

        }

        var chars = Array.from(text);

        for (var i = 0; i < chars.length; i++) {

            var cp = chars[i].codePointAt(0);

            if (isForbiddenControl(cp, multiline)) {

                return { ok: false, reason: 'char', char: chars[i] };

            }

        }

        return { ok: true, reason: null };

    }



    function validateName(value) {

        return validate(value, NAME_MAX_LENGTH, false);

    }



    function validateDescription(value) {

        return validate(value, DESCRIPTION_MAX_LENGTH, false);

    }



    function validateStaffMemo(value) {

        return validate(value, STAFF_MEMO_MAX_LENGTH, true);

    }



    function isInvalidName(value) {

        return !validateName(value).ok;

    }



    function isInvalidDescription(value) {

        return !validateDescription(value).ok;

    }



    function isInvalidStaffMemo(value) {

        return !validateStaffMemo(value).ok;

    }



    function invalidReasonFor(result) {

        if (result.ok) {

            return null;

        }

        return result.reason === 'length' ? 'length' : 'char';

    }



    function invalidNameReason(value) {

        return invalidReasonFor(validateName(value));

    }



    function invalidDescriptionReason(value) {

        return invalidReasonFor(validateDescription(value));

    }



    function invalidStaffMemoReason(value) {

        return invalidReasonFor(validateStaffMemo(value));

    }



    var api = {

        MAX_LENGTH: NAME_MAX_LENGTH,

        NAME_MAX_LENGTH: NAME_MAX_LENGTH,

        DESCRIPTION_MAX_LENGTH: DESCRIPTION_MAX_LENGTH,
        STAFF_MEMO_MAX_LENGTH: STAFF_MEMO_MAX_LENGTH,

        isForbiddenControl: isForbiddenControl,

        countChars: countChars,

        validate: validateName,

        validateName: validateName,

        validateDescription: validateDescription,

        validateStaffMemo: validateStaffMemo,

        validatePlain: function (value, maxLength) {

            return validate(value, maxLength, true);

        },

        isInvalid: isInvalidName,

        isInvalidName: isInvalidName,

        isInvalidDescription: isInvalidDescription,
        isInvalidStaffMemo: isInvalidStaffMemo,

        invalidReason: invalidNameReason,

        invalidNameReason: invalidNameReason,

        invalidDescriptionReason: invalidDescriptionReason,
        invalidStaffMemoReason: invalidStaffMemoReason

    };



    global.MasterOrderMenuCustomerText = api;

    var textPolicy = {

        displayText: validateName,

        menuDescription: validateDescription,

        validateSingleLine: function (value, maxLength) {

            return validate(value, maxLength, false);

        },

        plainText: function (value, maxLength) {

            return validate(value, maxLength, true);

        },

        shortLabel: function (value) {

            return validate(value, 64, false);

        },

        shopName: function (value) {

            return validate(value, 120, false);

        },

        isForbiddenControl: isForbiddenControl,

        countChars: countChars

    };



    global.MasterOrderTextPolicy = global.MasterOrderTextPolicy || textPolicy;

    Object.keys(textPolicy).forEach(function (key) {

        if (global.MasterOrderTextPolicy[key] == null) {

            global.MasterOrderTextPolicy[key] = textPolicy[key];

        }

    });

})(typeof window !== 'undefined' ? window : globalThis);

