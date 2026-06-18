# Staff（店舗スタッフ）

スタッフダッシュボード向けモジュールです。REST + SSE が主、Firestore は Auth / KITEI 補助のみ。

| ファイル | グローバル | 説明 |
|----------|------------|------|
| `staff-sdk.js` | `MasterOrderStaffSdk` | 店舗 API クライアント（推奨エントリ） |
| `client-sdk.js` | `MasterOrderClientSdk` | 互換シム（`staff-sdk.js` で十分） |
| `staff-ui-sdk.js` | `MasterOrderStaffUiSdk` | UI 共通（エラー整形・日時） |
| `staff-claims-sdk.js` | `MasterOrderStaffClaimsSdk` | Firebase claims 同期 |
| `staff-session-mode-sdk.js` | `MasterOrderStaffSessionModeSdk` | 都度QR / 固定QR モード |
| `staff-qr-sdk.js` | `MasterOrderStaffQrSdk` | セッション QR 生成 |
| `staff-firestore-sdk.js` | `MasterOrderStaffFirestoreSdk` | active_sessions 購読 |
| `staff-firestore-runtime-sdk.js` | `MasterOrderStaffFirestoreRuntimeSdk` | リスナー起動・フォールバック |
| `staff-session-list-sdk.js` | — | セッション一覧 UI |
| `staff-kitei-table-sdk.js` | `MasterOrderStaffKiteiSdk` | 固定 QR 卓カード |
| `staff-dashboard-sdk.js` | `MasterOrderStaffDashboardSdk` | Chart.js ダッシュボード |
| `staff-notifications-sdk.js` | — | 通知 |
| `staff-email-auth-sdk.js` | — | メール認証 |
| `staff-user-sdk.js` | — | プロフィール・トップバー |
| `staff-inventory-sdk.js` | — | 在庫入力 |
| `staff-app-wiring.js` | `MasterOrderStaffAppWiring` | **最後に読み込む** — 依存束ね |

**読み込み順:** Core の後、`staff-sdk.js` から。`staff-app-wiring.js` は Staff モジュールの末尾。

詳細 API は [ルート README](../README.md) を参照してください。
