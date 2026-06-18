/**
 * 来客 Order UI 文言（メニュー言語と同期）
 * @global MasterOrderGuestUiI18n
 */
(function (global) {
    'use strict';

    var STRINGS = {
        ja: {
            navMenu: 'メニュー',
            navCart: 'カート',
            navHistory: '履歴',
            navShare: 'QR共有',
            orderBar: 'カートを見る ({count}点)',
            settings: '設定',
            settingsClose: '閉じる',
            settingsLang: '言語 / Language',
            bootConnecting: '接続中...',
            connectScanLead: 'テーブルのQRをスキャン',
            connectScanBtn: 'QRコードを読み取る',
            connectImageBtn: '画像からQRを読み取る',
            connectStopScan: '読み取りを停止',
            connectManualOpen: '手動入力を開く',
            connectManualClose: '手動入力を閉じる',
            connectSessionId: 'Session ID',
            connectPin: 'Access PIN',
            connectBtn: '接続を開始する',
            connectBtnLoading: '接続中...',
            menuSearchPlaceholder: 'メニューを検索...',
            categoryScrollPrev: 'カテゴリーを左へ',
            categoryScrollNext: 'カテゴリーを右へ',
            categoriesAria: 'カテゴリー',
            categoryAll: 'すべて',
            cartTitle: '現在のカート',
            cartEmpty: 'カートは空です',
            sendOrder: '注文を確定する',
            sendOrderLoading: 'メニュー読み込み中...',
            sendOrderSending: '送信中...',
            sendOrderSendingCard: '注文を送信中…',
            sendOrderSendingHint: 'しばらくお待ちください',
            sendOrderFailed: '注文の送信に失敗しました',
            historyTitle: '注文履歴',
            historyEmpty: '注文履歴はありません',
            checkoutBtn: '会計を依頼する',
            shareTitle: 'QRを共有',
            shareLead: '同行者にこのQRを読み取ってもらうと、同じテーブルの注文に参加できます。',
            shareCaption: 'セッションに参加できるQR',
            shareCaptionError: 'QRを生成できませんでした',
            shareNote: '代表者以外の方は、このQRから接続してください。',
            modalCancel: 'キャンセル',
            modalAddToCart: 'カートに追加',
            menuEmpty: 'メニューがありません',
            soldOut: '在庫切れ',
            unnamed: '名称未設定',
            unknownMenu: '不明',
            loading: '読み込み中...',
            noToppings: 'トッピング設定なし（そのまま追加できます）',
            toppingFree: '無料',
            selectOne: '1つ選択',
            selectUpTo: '最大{max}つまで選択',
            cartAdded: '{name} をカートに追加しました',
            waitMenuLoad: 'メニューの読み込みが完了するまでお待ちください'
        },
        en: {
            navMenu: 'Menu',
            navCart: 'Cart',
            navHistory: 'History',
            navShare: 'Share QR',
            orderBar: 'View cart ({count} items)',
            settings: 'Settings',
            settingsClose: 'Close',
            settingsLang: 'Language',
            bootConnecting: 'Connecting...',
            connectScanLead: 'Scan the table QR code',
            connectScanBtn: 'Scan QR code',
            connectImageBtn: 'Scan QR from image',
            connectStopScan: 'Stop scanning',
            connectManualOpen: 'Enter manually',
            connectManualClose: 'Hide manual entry',
            connectSessionId: 'Session ID',
            connectPin: 'Access PIN',
            connectBtn: 'Connect',
            connectBtnLoading: 'Connecting...',
            menuSearchPlaceholder: 'Search menu...',
            categoryScrollPrev: 'Scroll categories left',
            categoryScrollNext: 'Scroll categories right',
            categoriesAria: 'Categories',
            categoryAll: 'All',
            cartTitle: 'Your cart',
            cartEmpty: 'Your cart is empty',
            sendOrder: 'Place order',
            sendOrderLoading: 'Loading menu...',
            sendOrderSending: 'Sending...',
            sendOrderSendingCard: 'Sending your order…',
            sendOrderSendingHint: 'Please wait a moment',
            sendOrderFailed: 'Failed to send your order',
            historyTitle: 'Order history',
            historyEmpty: 'No orders yet',
            checkoutBtn: 'Request bill',
            shareTitle: 'Share QR',
            shareLead: 'Others can scan this QR to join the same table order.',
            shareCaption: 'QR to join this session',
            shareCaptionError: 'Could not generate QR',
            shareNote: 'Non-host guests should connect via this QR.',
            modalCancel: 'Cancel',
            modalAddToCart: 'Add to cart',
            menuEmpty: 'No menu items',
            soldOut: 'Sold out',
            unnamed: 'Unnamed',
            unknownMenu: 'Unknown',
            loading: 'Loading...',
            noToppings: 'No toppings (add as-is)',
            toppingFree: 'Free',
            selectOne: 'Choose one',
            selectUpTo: 'Choose up to {max}',
            cartAdded: 'Added {name} to cart',
            waitMenuLoad: 'Please wait until the menu has finished loading'
        },
        zh: {
            navMenu: '菜单',
            navCart: '购物车',
            navHistory: '历史',
            navShare: '分享二维码',
            orderBar: '查看购物车（{count}件）',
            settings: '设置',
            settingsClose: '关闭',
            settingsLang: '语言',
            bootConnecting: '连接中...',
            connectScanLead: '扫描餐桌二维码',
            connectScanBtn: '扫描二维码',
            connectImageBtn: '从图片扫描二维码',
            connectStopScan: '停止扫描',
            connectManualOpen: '手动输入',
            connectManualClose: '关闭手动输入',
            connectSessionId: 'Session ID',
            connectPin: 'Access PIN',
            connectBtn: '开始连接',
            connectBtnLoading: '连接中...',
            menuSearchPlaceholder: '搜索菜单...',
            categoryScrollPrev: '向左滚动分类',
            categoryScrollNext: '向右滚动分类',
            categoriesAria: '分类',
            categoryAll: '全部',
            cartTitle: '当前购物车',
            cartEmpty: '购物车为空',
            sendOrder: '确认下单',
            sendOrderLoading: '菜单加载中...',
            sendOrderSending: '发送中...',
            sendOrderSendingCard: '正在发送订单…',
            sendOrderSendingHint: '请稍候',
            sendOrderFailed: '订单发送失败',
            historyTitle: '订单历史',
            historyEmpty: '暂无订单',
            checkoutBtn: '请求结账',
            shareTitle: '分享二维码',
            shareLead: '同行者可扫描此二维码加入同一桌订单。',
            shareCaption: '加入会话的二维码',
            shareCaptionError: '无法生成二维码',
            shareNote: '非代表者请通过此二维码连接。',
            modalCancel: '取消',
            modalAddToCart: '加入购物车',
            menuEmpty: '暂无菜单',
            soldOut: '售罄',
            unnamed: '未命名',
            unknownMenu: '未知',
            loading: '加载中...',
            noToppings: '无配料（可直接添加）',
            toppingFree: '免费',
            selectOne: '请选择1项',
            selectUpTo: '最多选择{max}项',
            cartAdded: '已将{name}加入购物车',
            waitMenuLoad: '请等待菜单加载完成'
        },
        ko: {
            navMenu: '메뉴',
            navCart: '장바구니',
            navHistory: '내역',
            navShare: 'QR 공유',
            orderBar: '장바구니 보기 ({count}개)',
            settings: '설정',
            settingsClose: '닫기',
            settingsLang: '언어',
            bootConnecting: '연결 중...',
            connectScanLead: '테이블 QR 코드를 스캔하세요',
            connectScanBtn: 'QR 코드 스캔',
            connectImageBtn: '이미지에서 QR 스캔',
            connectStopScan: '스캔 중지',
            connectManualOpen: '수동 입력',
            connectManualClose: '수동 입력 닫기',
            connectSessionId: 'Session ID',
            connectPin: 'Access PIN',
            connectBtn: '연결 시작',
            connectBtnLoading: '연결 중...',
            menuSearchPlaceholder: '메뉴 검색...',
            categoryScrollPrev: '카테고리 왼쪽',
            categoryScrollNext: '카테고리 오른쪽',
            categoriesAria: '카테고리',
            categoryAll: '전체',
            cartTitle: '현재 장바구니',
            cartEmpty: '장바구니가 비어 있습니다',
            sendOrder: '주문 확정',
            sendOrderLoading: '메뉴 불러오는 중...',
            sendOrderSending: '전송 중...',
            sendOrderSendingCard: '주문 전송 중…',
            sendOrderSendingHint: '잠시만 기다려 주세요',
            sendOrderFailed: '주문 전송에 실패했습니다',
            historyTitle: '주문 내역',
            historyEmpty: '주문 내역이 없습니다',
            checkoutBtn: '계산 요청',
            shareTitle: 'QR 공유',
            shareLead: '동행자가 이 QR을 스캔하면 같은 테이블 주문에 참여할 수 있습니다.',
            shareCaption: '세션 참여 QR',
            shareCaptionError: 'QR을 생성할 수 없습니다',
            shareNote: '대표자 외에는 이 QR로 연결하세요.',
            modalCancel: '취소',
            modalAddToCart: '장바구니에 추가',
            menuEmpty: '메뉴가 없습니다',
            soldOut: '품절',
            unnamed: '이름 없음',
            unknownMenu: '알 수 없음',
            loading: '불러오는 중...',
            noToppings: '토핑 없음 (그대로 추가)',
            toppingFree: '무료',
            selectOne: '1개 선택',
            selectUpTo: '최대 {max}개 선택',
            cartAdded: '{name}을(를) 장바구니에 추가했습니다',
            waitMenuLoad: '메뉴 로딩이 끝날 때까지 기다려 주세요'
        }
    };

    function normalizeLang(lang) {
        if (global.MasterOrderSdk && typeof global.MasterOrderSdk.normalizeGuestMenuLang === 'function') {
            return global.MasterOrderSdk.normalizeGuestMenuLang(lang);
        }
        var raw = String(lang || 'ja').trim().toLowerCase().slice(0, 2);
        return STRINGS[raw] ? raw : 'ja';
    }

    function t(key, lang) {
        var code = normalizeLang(lang);
        var table = STRINGS[code] || STRINGS.ja;
        if (table[key] != null) {
            return table[key];
        }
        return (STRINGS.ja[key] != null ? STRINGS.ja[key] : key);
    }

    function format(key, lang, vars) {
        var text = t(key, lang);
        if (!vars) {
            return text;
        }
        return String(text).replace(/\{(\w+)\}/g, function (_m, name) {
            return vars[name] != null ? String(vars[name]) : '';
        });
    }

    function apply(root, lang) {
        var scope = root || global.document;
        if (!scope || !scope.querySelectorAll) {
            return;
        }
        var resolved = normalizeLang(lang);
        scope.querySelectorAll('[data-guest-i18n]').forEach(function (node) {
            var key = node.getAttribute('data-guest-i18n');
            if (key) {
                node.textContent = t(key, resolved);
            }
        });
        scope.querySelectorAll('[data-guest-i18n-placeholder]').forEach(function (node) {
            var key = node.getAttribute('data-guest-i18n-placeholder');
            if (key) {
                node.setAttribute('placeholder', t(key, resolved));
            }
        });
        scope.querySelectorAll('[data-guest-i18n-aria]').forEach(function (node) {
            var key = node.getAttribute('data-guest-i18n-aria');
            if (key) {
                node.setAttribute('aria-label', t(key, resolved));
            }
        });
    }

    global.MasterOrderGuestUiI18n = {
        STRINGS: STRINGS,
        normalizeLang: normalizeLang,
        t: t,
        format: format,
        apply: apply
    };
})(typeof window !== 'undefined' ? window : globalThis);
