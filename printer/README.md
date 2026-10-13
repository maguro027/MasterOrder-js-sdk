# Printer（58mm ESC/POS）

スタッフ画面のレシート印刷。**公開 API は `MasterOrderStaffEscPosSdk` のまま。**
実体は次の独立 IIFE。バンドル時は連結するだけで、外側をさらに包まない。

| ファイル | グローバル | 役割 |
|----------|------------|------|
| `printer-codec.js` | `MasterOrderPrinter` | Canvas → **ESC \*** 24-dot。日本語はビットマップのみ |
| `printer-receipt.js` | 同上へ追加 | 公式レシート。最大 2 塊（ロゴ → 本文）。クーポンは 2 行 |
| `printer-modes.js` | 同上へ追加 | 印刷方式（マニュアル / OS ダイアログ / スター / Epson） |
| `printer-transport.js` | 同上へ追加 | keep-open 搬送。busy ロック。バッファと送り間隔。Web Bluetooth |
| `printer-drivers.js` | 同上へ追加 | OS 印刷ダイアログ、Star WebPRNT、ePOS HTTP |
| `printer-sdk.js` | `MasterOrderStaffEscPosSdk` | Staff 向けファサード |

コードページ／Shift_JIS／encoding-japanese は使わない（1.15 調査の残骸）。
絵文字・特殊記号は印字しない（顔文字の ´ω｀ などは残す）。マニュアルの初期値は 4KB / 100ms。画像の紙送りは端末ごと（`mo.staff.rasterFeed`）。既定は「余白を詰める」（行間 24 のあと LF）。行の直後に上下反転した同じ行が出る機種はこれ。詰めても白い帯が残る機種は「行間ゼロ」。帯が重なる 58E は「58E 互換」。改行しても反転行が残る機種は「プリンタに任せる」。

## 印刷方式（モード）

| id | 表示 | 状態 |
|----|------|------|
| `escpos-manual` | マニュアル（ESC/POS） | **現行の keep-open 送り。** 旧 id `escpos-cdc` はこれへ読み替える。バッファ KB と送り間隔 ms を設定する |
| `windows-driver` | OS 印刷ダイアログ | ESC\* を画像にして OS の印刷ダイアログへ。スマホではプリンタ選択に使う。USB シリアルへは送らない |
| `star-prnt` | スター精密 | LAN IP があるときだけ WebPRNT。空なら USB シリアルへ通常の ESC/POS |
| `epson-epos` | EPSON ePOS | LAN IP があるときだけ ePOS XML。空なら USB シリアルへ通常の ESC/POS |

## 端末ごとの送り先

| 端末 | 使える経路 |
|------|------------|
| PC Chrome / Edge | USB シリアル、WebUSB、Windows の USB / ネットワークプリンタ、Bluetooth COM。LAN の IP はスター / Epson の HTTP、届かないときは Windows の一覧 |
| Android Chrome | Web Bluetooth（BLE ESC/POS）。未設定時は OS 印刷ダイアログへフォールバック |
| Android Staff アプリ | ネイティブ Bluetooth Classic SPP / TCP 9100 |
| iPhone Safari | OS 印刷ダイアログ（AirPrint 等）。Web Bluetooth は非対応 |

Classic SPP 専用の安価機（Web Bluetooth の一覧に出ないもの）は Staff アプリが必要です。

マニュアルのバッファは 1 回に溜めるバイト数、送り間隔はその塊ごとの待ちです。印刷調整は成功サイズから一段下げて固定します。バッファ・間隔・方式・LAN URL・画像の紙送りは、スタッフ画面ではその端末の localStorage だけに残します。店舗プロフィールへは送りません。来客向け KV にも出しません。

## この端末の印刷

どちらも `localStorage`。店舗では共有しない。

| キー | 既定 | 動き |
|------|------|------|
| `mo.staff.autoPrintReceipt` | ON（`'0'` のときだけ OFF） | 会計した端末がレシートを出す。会計画面の「レシートを出さない」はその 1 回だけ止める |
| `mo.staff.kitchenMode` | OFF | 注文タブの厨房モード。ON の端末だけ、選んである USB / Bluetooth / LAN プリンタへ新しい `orderId` の注文票を送る |

注文票は卓・時刻・商品・数量・トッピング。起動時の未提供一覧や、提供による数量変更では出さない。OS 印刷ダイアログは厨房モードにしない。同じブラウザの別タブは先に予約した方だけ印刷する。

生成物 `js-sdk/staff/staff-escpos-sdk.js` は `node scripts/bundle-staff-js.mjs` が作る。手編集しない。

## 実機で固まった送り方

- Web Serial は **keep-open**（`port.close()` すると Windows CDC が死ぬ）
- **writer を握ったまま待たない**（`releaseLock` してから digest）
- **ロゴ一気 → 本文一気**（細切れ待ちはテスト印刷を遅らせ、バッファも溢れる）
- ロゴは保存した細かい間隔のまま。本文はインクが薄いので **4KB / 40ms**（ロゴ用に下げた 512B 間隔では送らない）
- ジョブ後の待ちは全体バイト数ベース（約 100ms/KB）
- 失敗直後に本文だけ再送しない（二重送信で CDC が確定死する）
- 日本語はコードページ勝負せず **ESC \*** ビットマップ。帯は 24 ドット。既定は行間を 24 にしてから LF（行間 0 だと、帯の直後に上下反転した同じ行を足す機種がある）。白い帯が残るときは「行間ゼロ」。58E で重なるときは「58E 互換」
- シリアル / USB の待ちはコマンドの切れ目だけ。ESC \* の途中では待たない
- シリアルは DLE EOT で印字前後の本体ステータスを読む。印字前は応答あり・印字後だけ無応答ならバッファ溢れとして失敗にする（非対応判定は前後とも無応答のときだけ）
- テスト印刷は接続確認（送りは変えない）。印刷調整は黒→白 10cm を約 1.2cm ずつ送り、塊ごとに DLE で生存確認してから格子へ（58E は Clear buf Disable。4 万バイト一塊は MCU リセット）
- 1 回目成功・2 回目 `UnknownError` は接続ゴミより **バッファ溢れ＋二重送信** が多い → `printBusy` を await 前に立て、最大 2 バーストに畳む
