# Core

全レイヤ共通の基盤モジュールです。

| ファイル | グローバル | 説明 |
|----------|------------|------|
| `api-routes.js` | `MasterOrderApiRoutes` | HTTP ルート定義・パスビルダー |
| `core-sdk.js` | `MasterOrderCoreSdk` | HTTP / SSE / 日時 / 正規化 |
| `consumption-tax.js` | — | 消費税計算 |
| `menu-image-url.js` | `MasterOrderMenuImage` | メニュー画像 URL（R2） |
| `menu-customer-text.js` | — | 来客向けテキストポリシー |
| `text-input-ui.js` | — | テキスト入力 UI ヘルパー |

**読み込み順（先頭）:** `api-routes.js` → `core-sdk.js`
