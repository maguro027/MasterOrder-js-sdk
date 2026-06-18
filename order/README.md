# Order（来客）

来客注文 UI 向けモジュールです。PIN + REST のみ（Firestore 直読なし）。

| ファイル | グローバル | 説明 |
|----------|------------|------|
| `order-sdk.js` | `MasterOrderOrderSdk` / `MasterOrderSdk` | セッション・注文・メニュー・QR |
| `guest-ui-i18n.js` | `MasterOrderGuestUiI18n` | 来客 UI 文言（ja/en/zh/ko） |
| `guest-order-ui-sdk.js` | `MasterOrderGuestOrderUiSdk` | カート・履歴・言語ピッカー |
| `guest-firestore-sdk.js` | — | 将来/補助用 Firestore ヘルパー |

**読み込み順:** Core の後に `guest-ui-i18n.js` → `order-sdk.js` → `guest-order-ui-sdk.js`

詳細 API は [ルート README](../README.md) を参照してください。
