# MasterOrder JS SDK

ブラウザ向け SDK の **正本** は monorepo 直下の [`js-sdk/`](./) です。  
**すべての Server 通信は SDK 経由** — UI から `fetch('/sessions/...')` 等を直接書かず、各レイヤのファクトリを使ってください。

---

## 設計原則

### データプレーン

| レイヤ | 接続先 | Firebase |
|--------|--------|----------|
| **Staff**（店舗スタッフ） | Server `apiBaseUrl`（REST + SSE） | **Auth のみ**（ID トークン） |
| **Order**（来客） | 同上 | **なし**（PIN + REST） |
| **Server** | Firestore / D1 / KV | Admin SDK |

- ブラウザは **Firestore に直接接続しない**（`api-routes.js` が URL を検証）。
- リアルタイムは Server が Firestore を購読し **SSE** で fan-out。
- 詳細: [docs/architecture/NODE_API_FIRESTORE_BOUNDARY.md](../docs/architecture/NODE_API_FIRESTORE_BOUNDARY.md)

### 3 レイヤ構成

```
api-routes.js     ルート定義（HTTP 正本・パスビルダー）
core-sdk.js       Core — 共通 HTTP / SSE / 正規化 / 日時
├── staff-sdk.js  Staff — 店舗スタッフ API + SSE ヘルパー
└── order-sdk.js  Order — 来客 API + セッション / QR / ブランディング
menu-image-url.js 画像 URL ユーティリティ（R2、SDK 外だが同梱）
```

| ファイル | グローバル | 用途 |
|----------|------------|------|
| `api-routes.js` | `MasterOrderApiRoutes` | ルートメタデータ + `paths.staff` / `paths.guest` |
| `core-sdk.js` | `MasterOrderCoreSdk` | 共通基盤 |
| `staff-sdk.js` | `MasterOrderStaffSdk` | 店舗スタッフ（**推奨**） |
| `client-sdk.js` | — | 互換シム（`staff-sdk.js` 単体で `MasterOrderClientSdk` も設定済み） |
| `order-sdk.js` | `MasterOrderOrderSdk` / `MasterOrderSdk` | 来客 |
| `menu-image-url.js` | `MasterOrderMenuImage` | メニュー画像 URL |

---

## スクリプト読み込み順

### Staff（店舗 UI）

```html
<script src="/js/sdk/api-routes.js"></script>
<script src="/js/sdk/core-sdk.js"></script>
<script src="/js/sdk/menu-image-url.js"></script>
<script src="/js/sdk/staff-sdk.js"></script>
<script src="/js/sdk/staff-ui-sdk.js"></script>
<script src="/js/sdk/staff-claims-sdk.js"></script>
<script src="/js/sdk/staff-session-mode-sdk.js"></script>
<script src="/js/sdk/staff-qr-sdk.js"></script>
<script src="/js/sdk/staff-firestore-sdk.js"></script>
<script src="/js/sdk/staff-firestore-runtime-sdk.js"></script>
<script src="/js/sdk/staff-kitei-table-sdk.js"></script>
<script src="/js/sdk/staff-dashboard-sdk.js"></script>
<script src="/js/sdk/staff-notifications-sdk.js"></script>
<script src="/js/sdk/staff-user-sdk.js"></script>
<script src="/js/sdk/staff-app-wiring.js"></script>
```

`client-sdk.js` は **読み込まなくてよい**（`staff-sdk.js` が `MasterOrderClientSdk` もエクスポート）。  
`staff-user-sdk.js` は `staff-notifications-sdk.js` の直後（プロフィール・トップバー chrome）。  
`staff-app-wiring.js` は Staff 専用モジュールの **最後** に置く（`createStaffAppServices` が他 SDK を束ねる）。

### Order（来客 UI）

```html
<script src="/js/sdk/guest-ui-i18n.js"></script>
<script src="/js/sdk/api-routes.js"></script>
<script src="/js/sdk/core-sdk.js"></script>
<script src="/js/sdk/order-sdk.js"></script>
<script src="/js/sdk/guest-order-ui-sdk.js"></script>
<script src="/js/sdk/menu-image-url.js"></script>
```

| ファイル | グローバル | 用途 |
|----------|------------|------|
| `guest-ui-i18n.js` | `MasterOrderGuestUiI18n` | 来客 UI 文言（ja/en/zh/ko） |
| `guest-order-ui-sdk.js` | `MasterOrderGuestOrderUiSdk` | カート・履歴・言語ピッカー描画 |

---

## クイックスタート

### Staff — 初期化

```javascript
const API_BASE = window._serverBase || MasterOrderCoreSdk.inferPublicApiBaseFromLocation();

const staffSdk = MasterOrderStaffSdk.createStaffSdk({
  apiBaseUrl: API_BASE,
  getIdToken: () => firebase.auth().currentUser.getIdToken(),
  onUnauthorized: () => { /* ログイン画面へ */ }
});

// 店舗一覧
const shops = await staffSdk.getMyShops();

// アクティブセッション
const sessions = await staffSdk.getActiveSessions(shopId, { includeTotals: true });

// 未提供注文 + SSE
const pendingLoader = MasterOrderStaffSdk.createPendingOrdersLoader({
  staffSdk,
  getShopId: () => shopId,
  onOrders: (orders) => renderKitchen(orders)
});

const realtime = MasterOrderStaffSdk.createShopRealtimeHandler({
  getShopId: () => shopId,
  pendingLoader,
  onRefreshAll: () => reloadSessions()
});

await staffSdk.connectShopOrderEvents(shopId, realtime);
pendingLoader.load();
```

### Order — 初期化

```javascript
const API_BASE = MasterOrderCoreSdk.inferPublicApiBaseFromLocation()
  || window._serverBase
  || 'http://localhost:8080';

const orderSdk = MasterOrderOrderSdk.createOrderSdk({ apiBaseUrl: API_BASE });

// 将来: Firebase 認証付きゲスト登録（getAccessToken を渡すとプロフィール API が有効）
const orderSdkAuth = MasterOrderOrderSdk.createOrderSdk({
  apiBaseUrl: API_BASE,
  getAccessToken: () => firebase.auth().currentUser.getIdToken()
});
await orderSdkAuth.saveProfile({ familyName: '山田', givenName: '花子' });

const sessionController = MasterOrderOrderSdk.createOrderSessionController({
  orderSdk,
  onSessionUpdate: (detail) => renderSession(detail)
});

// URL から sessionId + PIN
const { sessionId, pin } = MasterOrderOrderSdk.parseJoinCredentialsFromLocation();
if (sessionId && pin) {
  await sessionController.connect(sessionId, pin, shopId);
}

// 注文送信
await orderSdk.submitOrder(sessionId, pin, items, {
  clientId: MasterOrderOrderSdk.ensureGuestClientId(),
  idempotencyKey: MasterOrderOrderSdk.generateOrderIdempotencyKey()
});
```

### Order — メニュー読み込み（テンプレ共通）

来客 UI の HTML は描画専用とし、メニュー取得・競合防止・オフラインキャッシュは SDK に集約します。

```javascript
const menuLoader = MasterOrderOrderSdk.createGuestMenuLoader({
  orderSdk,
  getShopId: () => shopId,
  saveMenuCache: (id, menus) => MasterOrderOffline.saveMenuCache(id, menus),
  loadMenuCache: (id) => MasterOrderOffline.loadMenuCache(id)
});

const result = await menuLoader.load({
  shopId,
  keyword: '',
  allMenus,
  menus,
  activeCategory
});
if (!result.stale) {
  menus = result.menus;
  allMenus = result.allMenus;
  activeCategory = result.activeCategory;
  if (result.toppings) applyToppingCatalog(result.toppings);
}
```

| API | 説明 |
|-----|------|
| `createGuestMenuLoader({ orderSdk, getShopId, saveMenuCache, loadMenuCache })` | 競合安全なメニュー取得 |
| `loadOrderBundle(shopId, name)` | メニュー + トッピング一括（`?_=timestamp` でキャッシュ回避） |
| `loadShopMenus({ shopId, name })` | キーワード検索 |
| `normalizeGuestMenu` / `isGuestMenuSoldOut` | 在庫表示の正規化 |
| `filterGuestMenusByKeyword` / `extractGuestMenuCategories` / `filterGuestMenusByCategory` | UI フィルタ用 |
| `isGuestMenuReadyForOrder(loadState, menus)` | 注文ボタン有効判定 |

**注意:** ゲスト向け GET に `Cache-Control` 等のカスタムヘッダーを付けないこと（CORS プリフライトでブロックされる）。

---

## Core API（`MasterOrderCoreSdk`）

| カテゴリ | 主な API |
|----------|----------|
| HTTP | `createHttpClient({ baseUrl, getAccessToken, onUnauthorized })` |
| SSE | `createSseClient({ reconnectDelayMs })` → `connectAsync({ url, fetchTicket, eventName })` |
| ルート | `getApiRoutes()` → `MasterOrderApiRoutes` |
| URL 推論 | `inferPublicApiBaseFromLocation()`, `inferPublicOrderBaseFromLocation()` |
| 日時 | `parseApiDateTime`, `formatDateTime`, `formatElapsed` |
| 正規化 | `normalizeSessionDetailResponse`, `normalizePendingOrdersResponse`, `normalizeOrderLineItem` |
| プロフィール | `createProfileApi(http, paths)`, `buildProfileFullName`, `resolveDisplayFamilyName`, `normalizeUserProfile` |
| リアルタイム | `SHOP_REALTIME_TYPE`, `parseShopRealtimeEvent`, `buildPendingOrdersSignature` |
| セキュリティ | `escapeHtml`, `escapeHtmlDeep` |
| エラー | `ApiError`（`status`, `payload`） |

---

## Staff API（`MasterOrderStaffSdk`）

`createStaffSdk()` が返すクライアント。すべて `api-routes.js` の `paths.staff` 経由。

### 店舗・セッション

| メソッド | 説明 |
|----------|------|
| `getMyShops()` | 担当店舗一覧 |
| `getShopDashboard(shopId, period)` | ダッシュボード |
| `getShopTables(shopId)` | 卓一覧（KITEI_QR） |
| `refreshTablePassphrase(shopId, tableNo)` | 卓パスフレーズ再発行 |
| `updateSessionMode(shopId, mode)` | TSUDO_HAKKO / KITEI_QR 切替 |
| `getActiveSessions(shopId, { includeTotals })` | アクティブセッション |
| `createSession(shopId, payload)` | セッション作成 |
| `checkoutSession(sessionId)` | 会計 |
| `getSessionDetail(sessionId, { includeOrders })` | 詳細 |
| `updateSessionMemo(sessionId, memo)` | メモ更新 |
| `getArchivedSessions` / `getArchivedSessionDetail` | アーカイブ |

### 注文・リアルタイム

| メソッド | 説明 |
|----------|------|
| `getPendingOrders(shopId)` | 未提供注文 |
| `markOrderServed(orderId)` | 提供済み |
| `connectShopOrderEvents(shopId, handler, handlers)` | SSE 接続 |
| `closeOrderEvents()` | SSE 切断 |

### メニュー・在庫・メンバー

| メソッド | 説明 |
|----------|------|
| `getManageMenus` / `createMenu` / `updateMenu` / `deleteMenu` | メニュー CRUD |
| `getToppingGroupsByShop` / CRUD / `updateToppingInventory` | トッピング |
| `getShopInventorySummary` | 在庫サマリ |
| `getRecommendMenus` / `replaceRecommendMenus` / バナー upload/remove | おすすめ |
| `getMyProfile` / `updateMyProfile` / `setMyPublicId` / `saveProfile` | プロフィール（Core `createProfileApi` 経由） |
| `getMyPermissions` / `listShopMembers` / invite / role / remove | メンバー |

### ヘルパー

| 関数 | 説明 |
|------|------|
| `createPendingOrdersLoader({ staffSdk, getShopId, onOrders })` | 未提供注文ポーリング（デバウンス・差分検知） |
| `createShopRealtimeHandler({ pendingLoader, onRefreshAll, ... })` | SSE イベント → UI 更新 |
| `createStaffRealtimeRuntime({ clientSdk, pendingOrders, realtime })` | ローダー + SSE ハンドラを一括生成 |
| `createKiteiFirestoreRealtimeHooks({ sessionCache, onSessionsChanged })` | 固定QR: 注文 SSE 後の合計差分更新 |

**後方互換:** `createClientSdk` = `createStaffSdk`、`MasterOrderClientSdk` = `MasterOrderStaffSdk`

### Staff Firestore SDK（`MasterOrderStaffFirestoreSdk`）

固定QR（KITEI_QR）の `active_sessions` 直読。`staff-firestore-sdk.js` を Staff スクリプト群の後に読み込む。

| 関数 | 説明 |
|------|------|
| `init(firebaseApp)` | Firestore クライアント初期化 |
| `listenActiveSessions(shopId, { onSessions, onError })` | アクティブセッション購読 |
| `mergeTableSeatsWithSessions(tableSeats, sessions)` | 卓メタ + セッションをマージ |
| `createActiveSessionCache({ getShopId, onSnapshotSaved })` | セッションキャッシュ（署名付き apply / API 差分 patch） |
| `sessionsSignature(sessions)` | 変更検知用署名 |
| `stopAll()` | 全リスナー解除 |

---

## Order API（`MasterOrderOrderSdk`）

### HTTP クライアント（`createOrderSdk`）

| メソッド | 説明 |
|----------|------|
| `getMyProfile` / `updateMyProfile` / `setMyPublicId` / `saveProfile` | プロフィール（`getAccessToken` 指定時のみ — Core 共通） |
| `connectSessionDetail(sessionId, pin, shopId?)` | 接続 + 履歴 |
| `getGuestConnectOrderHistory(sessionId, pin, shopId?, limit?)` | 履歴のみ |
| `connectSessionViaJoinToken(joinToken, pin, shopId?)` | 合流トークン + PIN |
| `openFixedQrSession({ shopId, tableNo, passPhrase })` | 固定 QR セッション開始 |
| `submitOrder(sessionId, pin, items, guestMeta)` | 注文 POST（Idempotency-Key, Client-Id） |
| `searchMenus(query)` | メニュー検索 |
| `getToppingGroupsForMenu(menuId)` | トッピング取得 |
| `getRecommendMenus(shopId)` | おすすめ |
| `createSessionResyncMonitor(...)` | 定期 resync |

### セッションコントローラ

`createOrderSessionController({ orderSdk, onSessionUpdate })`

| メソッド | 説明 |
|----------|------|
| `connect(sessionId, pin, shopId?)` | 接続 + 監視開始 |
| `connectViaJoinToken(token, pin, shopId?)` | 合流 |
| `tryAutoReconnect()` | localStorage から再接続 |
| `resync()` / `stop()` | 手動同期 / 監視停止 |

### URL・認証・UI ユーティリティ

| 関数 | 説明 |
|------|------|
| `buildProfileFullName` / `resolveDisplayFamilyName` / `normalizeUserProfile` | プロフィール表示ヘルパー（Core 再エクスポート） |
| `parseJoinCredentialsFromLocation()` | URL → sessionId + PIN（URL から credential を除去） |
| `parseJoinTokenFromLocation()` | 合流トークン |
| `fetchPublicShop(slug, apiBase?)` | 公開店舗情報 |
| `applyGuestBranding(shop)` | ロゴ / カスタム CSS |
| `parseGuestRoute(pathname)` | `/shop-slug` ルート解析 |
| `buildConnectShopUrl` / `connectFromGuestQrText` | QR / ディープリンク |
| `createGuestQrScanner({ onScan })` | カメラ QR |
| `validateGuestOrderSubmission(items)` | 数量上限チェック |
| `validateCartToppingSelections(cart, fetchGroups)` | トッピング min/max |

**後方互換:** `MasterOrderSdk` = `MasterOrderOrderSdk`

---

## HTTP ルート正本

`MasterOrderApiRoutes.API_ROUTES` に method / path / audience を定義。  
実装は必ず `paths.staff.*` または `paths.guest.*` を使用（文字列直書き禁止）。

```javascript
const routes = MasterOrderApiRoutes;
routes.paths.staff.activeSessions();   // '/sessions/active'
routes.paths.guest.connectSession(id); // '/sessions/connect/:id'
routes.assertNodeApiBaseUrl(baseUrl);  // Firestore URL を拒否
```

---

## 配置・同期

| 配布先 | 含まれる SDK |
|--------|--------------|
| Order 静的 (`Order/.../static/js/sdk/`) | api-routes, core, order, menu-image-url |
| Staff 静的 (`Order ビルド → /static/staff/js/sdk/`) | api-routes, core, staff, client-shim, menu-image-url |
| Client リポ (`vendor/MasterOrder-client/source/js/sdk/`) | 同上 Staff |
| DebugPages (`DebugPages/js/sdk/`) | api-routes, core, staff |

```powershell
.\scripts\sync-js-sdk.ps1
```

Maven ビルド時も `Order/pom.xml` が `js-sdk/` から自動コピー。

---

## エラーハンドリング

```javascript
try {
  await staffSdk.checkoutSession(sessionId);
} catch (err) {
  if (err instanceof MasterOrderCoreSdk.ApiError) {
    console.error(err.status, err.message, err.payload);
  }
}
```

---

## バージョン

各モジュールに `VERSION`（現行 `1.0.0`）:

```javascript
MasterOrderCoreSdk.VERSION
MasterOrderStaffSdk.VERSION
MasterOrderOrderSdk.VERSION
```

---

## やってはいけないこと

1. UI から Server API を **直接 `fetch`**（SDK を経由する）
2. ブラウザから **Firestore / Firebase Realtime DB** に接続
3. SSE URL に **Firebase ID トークン** をクエリで付与（チケット API を使う）
4. 来客 URL に **sessionId / PIN をクエリで残す**（SDK が sessionStorage + path へ移行）
5. ルートパスを **ハードコード**（`api-routes.js` を更新する）

---

## Staff Firestore / KITEI 卓席 UI

| モジュール | グローバル | 用途 |
|------------|------------|------|
| `staff-ui-sdk.js` | `MasterOrderStaffUiSdk` | Firestore 429 バックオフ、API エラー整形、セッション読込パネル、`yen` / 注文ソート / 日時表示 |
| `staff-claims-sdk.js` | `MasterOrderStaffClaimsSdk` | Firebase custom claims 同期（Firestore 直読の前提） |
| `staff-session-mode-sdk.js` | `MasterOrderStaffSessionModeSdk` | TSUDO_HAKKO / KITEI_QR モード判定、卓グリッド表示条件 |
| `staff-qr-sdk.js` | `MasterOrderStaffQrSdk` | セッション QR 遅延生成・IntersectionObserver キャッシュ |
| `staff-firestore-sdk.js` | `MasterOrderStaffFirestoreSdk` | Firestore `active_sessions` 購読、`sessionsSignature`（金額変化検知含む）、`mergeTableSeatsWithSessions` |
| `staff-firestore-runtime-sdk.js` | `MasterOrderStaffFirestoreRuntimeSdk` | リスナー起動/停止、REST フォールバック、卓席キャッシュ、描画デバウンス |
| `staff-kitei-table-sdk.js` | `MasterOrderStaffKiteiSdk` | 固定 QR 卓カード UI、`createTableSeatStatusFilter`（Active/Wait フィルター） |
| `staff-dashboard-sdk.js` | `MasterOrderStaffDashboardSdk` | ショップ情報 Chart.js 描画（来店者・売上・複合グラフ） |
| `staff-app-wiring.js` | `MasterOrderStaffAppWiring` | `createStaffAppServices()` — 上記を index.html の hooks と接続 |

```javascript
// index.html — 依存注入して一括生成
const staffApp = MasterOrderStaffAppWiring.createStaffAppServices({
  getShopId: () => shopId,
  clientSdk,
  sessionCache,
  hooks: { /* renderSessions, fetchTableSeatsMetadata, ... */ }
});
staffApp.firestoreRuntime.startListener(shopId);
staffApp.qr.enqueueSessionCardQrLoad(cardEl, session);
staffApp.dashboard.renderSimpleBarChart(container, series, 'sales', period);

// プロフィール（Staff / 将来 Order 共通）
const profile = await staffSdk.getMyProfile();
await staffSdk.saveProfile({
  familyName: '濱田',
  givenName: '太郎',
  publicId: 'hamada_t',
  allowPublicId: true
});

// 卓席フィルター
const filter = MasterOrderStaffKiteiSdk.createTableSeatStatusFilter();
filter.setFilter('active', { wrap, grid });
```

---

## 関連ドキュメント

- [NODE_API_FIRESTORE_BOUNDARY.md](../docs/architecture/NODE_API_FIRESTORE_BOUNDARY.md) — データプレーン境界
- [SESSION_MODES_SECURE_QR.md](../docs/security/SESSION_MODES_SECURE_QR.md) — セッションモード / 固定 QR
