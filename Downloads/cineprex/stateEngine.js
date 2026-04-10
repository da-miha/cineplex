'use strict';
/**
 * stateEngine.js
 * 自動ステータス更新エンジン
 * - 5秒ごとに実行
 * - manualOverride=true のスクリーンはスキップ
 * - start は絶対に自動設定しない
 * - start → now は本編開始10分後に自動移行
 */

const fs   = require('fs');
const path = require('path');

const SCHEDULE_PATH = path.join(__dirname, 'data/schedule.json');
const STATE_PATH    = path.join(__dirname, 'data/state.json');

// HH:MM → 分
function toMin(t) {
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// 現在時刻（分）
function nowMin() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

// schedule & state の読み書き
function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return null; }
}
function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * previewStart 基準で自動ステータスを算出
 *   ready  : 予告開始20分以上前
 *   soon   : 予告開始10分前〜直前
 *   now    : 本編開始10分後〜終映まで
 *   終映後  : ready にリセット
 *   start  : 絶対に自動設定しない
 */
function calcAutoStatus(sc) {
  const pm = toMin(sc?.previewStart);
  const mm = toMin(sc?.mainStart);
  const em = toMin(sc?.endTime);
  const now = nowMin();

  if (pm === null) return 'ready';

  const diffPreview = pm - now;

  if (diffPreview > 20) return 'ready';       // 予告20分以上前
  if (diffPreview > 0)  return 'soon';         // 予告10分前〜直前

  // 予告開始後：本編開始10分後でnow
  if (mm !== null && now >= mm + 10) {
    // 終映後はready
    if (em !== null && now >= em) return 'ready';
    return 'now';
  }

  // 予告開始〜本編開始10分後はsoon（入場中）
  return 'soon';
}

/**
 * メイン更新関数
 * @param {Function} onChanged - 変更があったときのコールバック (changedIds: number[]) => void
 */
function runAutoUpdate(onChanged) {
  const schedule = readJSON(SCHEDULE_PATH);
  const state    = readJSON(STATE_PATH);
  if (!schedule || !state) return;

  const changedIds = [];

  state.forEach(st => {
    if (st.manualOverride) return;

    const sc = schedule.find(s => s.screenId === st.screenId);

    // start 中 → 本編開始10分後に自動で now へ
    if (st.status === 'start') {
      const mm = toMin(sc?.mainStart);
      if (mm !== null && nowMin() >= mm + 10) {
        st.status         = 'now';
        st.manualOverride = false;
        st.updatedAt      = new Date().toISOString();
        changedIds.push(st.screenId);
      }
      return;
    }

    const auto = calcAutoStatus(sc);
    if (auto === 'start') return; // start には絶対に自動設定しない

    if (st.status !== auto) {
      st.status    = auto;
      st.updatedAt = new Date().toISOString();
      changedIds.push(st.screenId);
    }
  });

  if (changedIds.length > 0) {
    writeJSON(STATE_PATH, state);
    if (typeof onChanged === 'function') onChanged(changedIds, state);
  }
}

/**
 * 手動でステータスを変更
 * @returns {object} 更新後のstate配列
 */
function manualUpdate(screenId, newStatus) {
  const state = readJSON(STATE_PATH);
  if (!state) throw new Error('state.json 読み込み失敗');

  const st = state.find(s => s.screenId === screenId);
  if (!st) throw new Error(`screenId ${screenId} が見つかりません`);

  st.status         = newStatus;
  st.manualOverride = (newStatus === 'start'); // start のみ override ロック
  st.updatedAt      = new Date().toISOString();

  writeJSON(STATE_PATH, state);
  return state;
}

/**
 * voice再生済み記録
 */
function markVoicePlayed(screenId) {
  const state = readJSON(STATE_PATH);
  if (!state) return;
  const st = state.find(s => s.screenId === screenId);
  if (st) {
    st.lastVoicePlayed = new Date().toISOString();
    writeJSON(STATE_PATH, state);
  }
}

module.exports = { runAutoUpdate, manualUpdate, markVoicePlayed, readJSON, writeJSON };
