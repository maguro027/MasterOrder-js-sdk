# Core

全レイヤ共通の基盤モジュールです。

| ファイル | グローバル | 説明 |
|----------|------------|------|
| `api-routes.js` | `MasterOrderApiRoutes` | HTTP ルート定義・パスビルダー |
| `core-sdk.js` | `MasterOrderCoreSdk` | HTTP / SSE / 日時 / 正規化 |
| `allergens.js` | `MasterOrderAllergens` | アレルゲン定義（食品表示法順・emoji・ja/en/zh/ko） |
| `consumption-tax.js` | — | 消費税計算 |
| `menu-image-url.js` | `MasterOrderMenuImage` | メニュー画像 URL（R2） |
| `menu-customer-text.js` | — | 来客向けテキストポリシー |
| `text-input-ui.js` | — | テキスト入力 UI ヘルパー |

**読み込み順（先頭）:** `api-routes.js` → `core-sdk.js` → `allergens.js`（Order/Staff のアレルギー UI より前）

Staff / Order で共有すべきドメイン定数（アレルゲン、税、画像 URL）は Core に置く。UI 描画は各レイヤの `*-ui-sdk` に寄せる。
