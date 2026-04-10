'use strict';
/**
 * csvUpload.js
 * CSVアップロード → schedule.json 更新
 *
 * CSVフォーマット（ヘッダー行あり）:
 * screenId,title,previewStart,mainStart,endTime
 * 1,作品名,17:50,18:00,20:49
 */

const fs      = require('fs');
const path    = require('path');
const { parse } = require('csv-parse/sync');

const SCHEDULE_PATH = path.join(__dirname, 'data/schedule.json');
const BACKUP_PATH   = path.join(__dirname, 'data/schedule_backup.json');

const TIME_RE = /^\d{1,2}:\d{2}$/;

function validateRow(row, idx) {
  const errors = [];
  const id = parseInt(row.screenId, 10);
  if (isNaN(id) || id < 1 || id > 20)       errors.push(`行${idx+2}: screenId が不正 (${row.screenId})`);
  if (!row.title || row.title.trim() === '') errors.push(`行${idx+2}: title が空`);
  if (!TIME_RE.test(row.previewStart))        errors.push(`行${idx+2}: previewStart 形式不正 (${row.previewStart})`);
  if (!TIME_RE.test(row.mainStart))           errors.push(`行${idx+2}: mainStart 形式不正 (${row.mainStart})`);
  if (!TIME_RE.test(row.endTime))             errors.push(`行${idx+2}: endTime 形式不正 (${row.endTime})`);
  return errors;
}

/**
 * CSVバッファを受け取り、schedule.json を更新する
 * @param {Buffer} buffer - CSVファイルの内容
 * @returns {{ ok: boolean, schedule?: Array, errors?: string[] }}
 */
function processCSV(buffer) {
  let rows;
  try {
    rows = parse(buffer.toString('utf8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch (e) {
    return { ok: false, errors: [`CSV パース失敗: ${e.message}`] };
  }

  const allErrors = [];
  rows.forEach((row, i) => allErrors.push(...validateRow(row, i)));

  if (allErrors.length > 0) {
    return { ok: false, errors: allErrors };
  }

  const schedule = rows.map(row => ({
    screenId:     parseInt(row.screenId, 10),
    title:        row.title.trim(),
    previewStart: row.previewStart.trim(),
    mainStart:    row.mainStart.trim(),
    endTime:      row.endTime.trim(),
  }));

  // バックアップ
  try {
    if (fs.existsSync(SCHEDULE_PATH)) {
      fs.copyFileSync(SCHEDULE_PATH, BACKUP_PATH);
    }
  } catch (e) { /* ignore */ }

  fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(schedule, null, 2), 'utf8');
  console.log(`[CSV] schedule.json 更新: ${schedule.length}件`);

  return { ok: true, schedule };
}

module.exports = { processCSV };
