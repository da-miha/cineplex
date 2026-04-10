'use strict';
/**
 * server.js
 * Express + WebSocket サーバー
 * ポート: 3000（環境変数 PORT で変更可）
 */

const express  = require('express');
const http     = require('http');
const path     = require('path');
const fs       = require('fs');
const { WebSocketServer } = require('ws');
const multer   = require('multer');

const { runAutoUpdate, manualUpdate, readJSON, writeJSON } = require('./stateEngine');
const { processCSV }   = require('./csvUpload');
const { requestPlay }  = require('./voicevox');
const logger           = require('./logger');

const PORT          = process.env.PORT || 3000;
const SCHEDULE_PATH = path.join(__dirname, 'data/schedule.json');
const STATE_PATH    = path.join(__dirname, 'data/state.json');
const VOICE_DIR     = path.join(__dirname, 'data/voice');

// ── Express ──────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/voice', express.static(VOICE_DIR));
app.get('/schedule', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'schedule.html'));
});
app.get('/schedule', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'schedule.html'));
});

app.get('/control', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'control.html'));
});
// ── WebSocket ─────────────────────────────────────────
const wss = new WebSocketServer({ server });

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(c => {
    if (c.readyState === 1) c.send(data);
  });
}

function broadcastFull() {
  broadcast({
    type:    'INIT',
    payload: {
      schedule: readJSON(SCHEDULE_PATH) || [],
      state:    readJSON(STATE_PATH)    || [],
    },
  });
}

wss.on('connection', ws => {
  // 接続時に現在の全データを送信
  ws.send(JSON.stringify({
    type:    'INIT',
    payload: {
      schedule: readJSON(SCHEDULE_PATH) || [],
      state:    readJSON(STATE_PATH)    || [],
    },
  }));
});

// ── 自動更新（5秒ごと）────────────────────────────────
setInterval(() => {
  runAutoUpdate((changedIds, newState) => {
    broadcast({
      type:    'STATE_UPDATE',
      payload: { state: newState, changedIds },
    });
    changedIds.forEach(id => {
      const st = newState.find(s => s.screenId === id);
      if (st) logger.logStatusChange(id, '?', st.status, false);
    });
  });
}, 5000);

// 起動時も即実行
runAutoUpdate((changedIds, newState) => {
  changedIds.forEach(id => {
    const st = newState.find(s => s.screenId === id);
    if (st) logger.logStatusChange(id, '?', st.status, false);
  });
});
// 追加：現在のスケジュール（状態）を取得するAPI
app.get('/api/schedule', (req, res) => {
  try {
    const state = readJSON(STATE_PATH) || [];
    res.json(state);
  } catch (e) {
    res.status(500).json({ error: 'データの読み込みに失敗しました' });
  }
});	
// ── API: 手動ステータス変更 ───────────────────────────
app.post('/api/update', async (req, res) => {
  const { screenId, status } = req.body;
  if (!screenId || !status) return res.status(400).json({ error: 'screenId と status が必要です' });

  const validStatuses = ['ready', 'soon', 'start', 'now'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: '無効なステータス' });

  try {
    const prevState = readJSON(STATE_PATH) || [];
    const prev = (prevState.find(s => s.screenId === screenId) || {}).status || '?';

    const newState = manualUpdate(screenId, status);
    logger.logStatusChange(screenId, prev, status, true);

    broadcast({ type: 'STATE_UPDATE', payload: { state: newState, changedIds: [screenId] } });

    // 入場開始 → 音声リクエスト
    if (status === 'start') {
      const voiceUrl = await requestPlay(screenId);
      if (voiceUrl) {
        logger.logVoicePlayed(screenId);
        broadcast({ type: 'PLAY_VOICE', payload: { screenId, url: voiceUrl } });
      }
    }

    res.json({ ok: true, state: newState });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── API: CSVアップロード ──────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1 * 1024 * 1024 } });

app.post('/api/upload-csv', upload.single('csv'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ファイルがありません' });

  const result = processCSV(req.file.buffer);
  if (!result.ok) return res.status(400).json({ errors: result.errors });

  logger.logCSVUpload(result.schedule.length);

  // state をリセット（新スケジュールに合わせ全ready）
  const newState = result.schedule.map(sc => ({
    screenId:        sc.screenId,
    status:          'ready',
    manualOverride:  false,
    updatedAt:       new Date().toISOString(),
    lastVoicePlayed: '',
  }));
  writeJSON(STATE_PATH, newState);

  broadcastFull();
  res.json({ ok: true, count: result.schedule.length });
});

// ── API: 現在データ取得 ───────────────────────────────
app.get('/api/data', (req, res) => {
  res.json({
    schedule: readJSON(SCHEDULE_PATH) || [],
    state:    readJSON(STATE_PATH)    || [],
  });
});

// ── API: ログ取得（管理用）────────────────────────────
app.get('/api/logs', (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const logPath = path.join(__dirname, 'logs', `${date}.jsonl`);
  if (!fs.existsSync(logPath)) return res.json([]);
  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
  res.json(lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
});

// ── ページルーティング ────────────────────────────────
app.get('/',          (_, res) => res.sendFile(path.join(__dirname, 'public/display.html')));
app.get('/control',   (_, res) => res.sendFile(path.join(__dirname, 'public/control.html')));
app.get('/admin',     (_, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));
app.get('/standalone',(_, res) => res.sendFile(path.join(__dirname, 'public/standalone.html')));

server.listen(PORT, () => {
  console.log(`\n🎬 CINEPREX SIGNAGE サーバー起動`);
  console.log(`   表示画面   : http://localhost:${PORT}/`);
  console.log(`   操作画面   : http://localhost:${PORT}/control`);
  console.log(`   管理画面   : http://localhost:${PORT}/admin`);
  console.log(`   スタンドアロン: http://localhost:${PORT}/standalone\n`);
});
