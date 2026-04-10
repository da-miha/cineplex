'use strict';
/**
 * logger.js
 * 運用ログ取得（KPI用）
 * - 入場開始時刻
 * - 状態変更履歴
 * ログファイル: logs/YYYY-MM-DD.jsonl
 */

const fs   = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function todayFile() {
  const d = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `${d}.jsonl`);
}

function log(event, data) {
  const entry = JSON.stringify({ ts: new Date().toISOString(), event, ...data }) + '\n';
  fs.appendFileSync(todayFile(), entry, 'utf8');
}

module.exports = {
  logStatusChange: (screenId, from, to, manual) =>
    log('STATUS_CHANGE', { screenId, from, to, manual }),
  logCSVUpload: (count) =>
    log('CSV_UPLOAD', { count }),
  logVoicePlayed: (screenId) =>
    log('VOICE_PLAYED', { screenId }),
};
