'use strict';
/**
 * voicevox.js
 * VOICEVOX ローカル API 連携
 * - start 時のみ音声合成・再生
 * - 二重再生防止（同一スクリーン＋同一日のみ）
 * - 音声ファイルキャッシュ（data/voice/）
 * - 再生はブラウザ側に wav の URL を送信する方式
 */

const fs   = require('fs');
const path = require('path');
const axios = require('axios');

const VOICEVOX_URL  = process.env.VOICEVOX_URL  || 'http://127.0.0.1:50021';
const SPEAKER_ID    = parseInt(process.env.VOICEVOX_SPEAKER || '3', 10); // ずんだもん
const VOICE_DIR     = path.join(__dirname, 'data/voice');
const VOLUME        = parseFloat(process.env.VOICE_VOLUME || '1.0');

if (!fs.existsSync(VOICE_DIR)) fs.mkdirSync(VOICE_DIR, { recursive: true });

// 再生済みキャッシュ（メモリ：スクリーンId → 最終再生日）
const playedToday = new Map();

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * 音声テキストを生成
 */
function buildText(screenId) {
  return `お待たせいたしました。${screenId}番スクリーンのご入場を開始いたします。`;
}

/**
 * キャッシュキー（スクリーンId + 日付）
 */
function cacheKey(screenId) {
  return `${todayStr()}_sc${screenId}`;
}

/**
 * 音声ファイルパスを返す（キャッシュがあればそのまま使用）
 * @returns {string|null} ファイルパス or null（失敗時）
 */
async function synthesize(screenId) {
  const key      = cacheKey(screenId);
  const wavPath  = path.join(VOICE_DIR, `${key}.wav`);

  if (fs.existsSync(wavPath)) {
    console.log(`[VOICE] キャッシュ使用: ${wavPath}`);
    return wavPath;
  }

  const text = buildText(screenId);

  try {
    // Step1: audio_query
    const queryRes = await axios.post(
      `${VOICEVOX_URL}/audio_query?text=${encodeURIComponent(text)}&speaker=${SPEAKER_ID}`,
      {}, { timeout: 8000 }
    );
    const query = queryRes.data;
    query.volumeScale = VOLUME;

    // Step2: synthesis
    const synthRes = await axios.post(
      `${VOICEVOX_URL}/synthesis?speaker=${SPEAKER_ID}`,
      query,
      { responseType: 'arraybuffer', timeout: 15000 }
    );

    fs.writeFileSync(wavPath, Buffer.from(synthRes.data));
    console.log(`[VOICE] 合成完了: ${wavPath}`);
    return wavPath;

  } catch (e) {
    console.error(`[VOICE] 合成失敗 SC${screenId}:`, e.message);
    return null;
  }
}

/**
 * 再生リクエスト
 * @returns {string|null} クライアントに渡す URL パス or null
 */
async function requestPlay(screenId) {
  const today = todayStr();
  if (playedToday.get(screenId) === today) {
    console.log(`[VOICE] 二重再生防止 SC${screenId}`);
    return null; // 同日二重再生防止
  }

  const wavPath = await synthesize(screenId);
  if (!wavPath) return null;

  playedToday.set(screenId, today);

  // サーバーから配信するパスを返す
  const filename  = path.basename(wavPath);
  return `/voice/${filename}`;
}

/**
 * 翌日0時にキャッシュとメモリをリセット
 */
function scheduleDailyReset() {
  const now  = new Date();
  const next = new Date(now);
  next.setDate(now.getDate() + 1);
  next.setHours(0, 1, 0, 0); // 0:01 AM
  const msUntil = next - now;

  setTimeout(() => {
    playedToday.clear();
    // 前日音声ファイル削除
    try {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      fs.readdirSync(VOICE_DIR)
        .filter(f => f.startsWith(yesterday))
        .forEach(f => fs.unlinkSync(path.join(VOICE_DIR, f)));
      console.log('[VOICE] 前日キャッシュ削除完了');
    } catch (e) { /* ignore */ }
    scheduleDailyReset();
  }, msUntil);
}

scheduleDailyReset();

module.exports = { requestPlay };
