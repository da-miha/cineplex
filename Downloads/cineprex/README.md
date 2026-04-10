# 🎬 CINEPREX SIGNAGE SYSTEM v2.0

映画館（8スクリーン）入場案内デジタルサイネージシステム

---

## フォルダ構成

```
cineprex/
├── server.js          # Express + WebSocket サーバー（メイン）
├── stateEngine.js     # 自動ステータス更新エンジン
├── voicevox.js        # VOICEVOX 音声合成連携
├── csvUpload.js       # CSVアップロード処理
├── logger.js          # 運用ログ（KPI）
├── package.json
├── data/
│   ├── schedule.json  # 上映スケジュール（scheduleとstateは完全分離）
│   ├── state.json     # 各スクリーンのステータス
│   └── voice/         # 音声キャッシュ（自動作成）
├── logs/              # 日別運用ログ JSONL（自動作成）
└── public/
    ├── display.html   # テレビ表示用（左大画面）
    ├── control.html   # スマホ操作用
    ├── admin.html     # 管理画面（CSVアップロード・ログ閲覧）
    └── standalone.html # サーバー不要デモ（ファイル単体で動作）
```

---

## 起動手順

### 1. インストール

```bash
cd cineprex
npm install
```

### 2. 起動

```bash
node server.js
# または開発時
npx nodemon server.js
```

### 3. アクセス

| 画面 | URL | 用途 |
|------|-----|------|
| 表示画面 | `http://サーバーIP:3000/` | ロビーのテレビに表示 |
| 操作画面 | `http://サーバーIP:3000/control` | スタッフのスマホ |
| 管理画面 | `http://サーバーIP:3000/admin` | マネージャー（CSVアップロード）|
| スタンドアロン | `http://サーバーIP:3000/standalone` | デモ・テスト |

### 4. VOICEVOX 設定（任意）

VOICEVOX をローカルに起動してから起動してください。

```bash
# VOICEVOXのAPIエンドポイントを変更する場合
VOICEVOX_URL=http://127.0.0.1:50021 node server.js

# 話者IDを変更する場合（デフォルト:3 ずんだもん）
VOICEVOX_SPEAKER=8 node server.js

# 音量調整（0.0〜2.0、デフォルト:1.0）
VOICE_VOLUME=1.5 node server.js
```

VOICEVOX が未起動でも、チャイム音は鳴ります（音声合成なしで動作継続）。

---

## CSVフォーマット

毎朝マネージャーが管理画面からアップロード。

```csv
screenId,title,previewStart,mainStart,endTime
1,劇場版 鬼滅の刃 無限城編,17:50,18:00,20:15
2,DUNE: PART TWO,18:20,18:30,21:15
3,関心領域,18:35,18:45,20:50
```

- `previewStart` : 予告開始時刻（HH:MM）→ この時刻を基準に自動ステータス判定
- `mainStart`    : 本編開始時刻（HH:MM）→ +10分後に自動でnowに移行
- `endTime`      : 終映時刻（HH:MM）→ 過ぎたら自動でreadyに戻す

---

## 自動更新ロジック

```
予告開始20分以上前  → ready（準備中）
予告開始10分前〜直前 → soon（まもなく入場）
本編開始10分後〜終映 → now（上映中）
終映後              → ready（リセット）

⚠️ start（入場開始）は絶対に自動設定しない
⚠️ manualOverride=true のスクリーンは自動更新スキップ
⚠️ start → now のみ例外として自動移行（本編開始10分後）
```

---

## WebSocket メッセージ仕様

| type | 方向 | 内容 |
|------|------|------|
| `INIT` | server→client | 接続時 schedule + state 全送信 |
| `STATE_UPDATE` | server→client | 状態変更時 state 全送信 + changedIds |
| `PLAY_VOICE` | server→client | 音声再生URL送信 |

---

## API

| メソッド | パス | 内容 |
|---------|------|------|
| `POST` | `/api/update` | 手動ステータス変更 `{ screenId, status }` |
| `POST` | `/api/upload-csv` | CSVアップロード（multipart/form-data, field: `csv`）|
| `GET`  | `/api/data` | 現在の schedule + state を返す |
| `GET`  | `/api/logs?date=YYYY-MM-DD` | 指定日のログ一覧 |

---

## 追加改善提案

### ① 遅延対策
- WebSocket が切断された場合、3秒で自動再接続
- サーバー側は 5秒ごとに自動更新（ポーリングではなく push のみ）
- ネットワーク障害時のフォールバック：standalone.html を別タブで開いておく

### ② オフライン対応
- `standalone.html` はサーバー不要でファイル単体動作
- Service Worker の追加で control.html をオフラインキャッシュ可能
- PWA化（manifest.json + sw.js）でスマホホーム画面インストール可能

### ③ ログ取得（KPI）
- `logs/YYYY-MM-DD.jsonl` に記録
  - 入場開始時刻（SC番号・手動操作者）
  - 自動ステータス変遷
  - CSVアップロード履歴
  - 音声再生記録
- 週次集計スクリプトを別途作成可能（入場遅延分析等）

### ④ 運用改善アイデア

**スタッフ動線**
- 清掃完了 → スマホでワンタップ「入場開始」
- 操作画面はブックマークでアクセス（QRコードをスタッフルームに貼る）

**ディスプレイ設置**
- ロビー入口に縦型大画面（43〜55インチ）
- HDMI接続のラズベリーパイ4 + Chromium全画面表示で低コスト実現
- 複数台設置時は全て同一URLを表示（WebSocketで同期）

**管理者機能拡張案**
- 翌日分の予約入力（夜間にCSVアップロード）
- スクリーン単位の音量設定
- 緊急アナウンス機能（テロップ手動入力）

**監視・アラート**
- 本編開始10分後も `start` のまま → Slack通知
- サーバーダウン検知 → メール通知

---

## 動作確認済み環境

- Node.js 18以上
- Chrome / Safari / Firefox（最新版）
- iOS Safari（操作画面）
- VOICEVOX 0.14以上（音声合成、任意）
