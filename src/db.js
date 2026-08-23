import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { writeFileSafe } from './safeWrite.js';

const FILE = path.join(config.dataDir, 'db.json');

const empty = () => ({
  likes: {},          // `${channelId}:${messageId}` -> [userId]
  reactionProxy: {},  // `${channelId}:${messageId}:${emojiKey}` -> [userId]  (봇이 대신 누른 리액션의 실주체)
  follows: {},        // userId -> [guildId]  (피드에 고정할 서버)
  settings: {},       // userId -> { theme, density, ... }
  activity: {},       // userId -> [notification]
  reads: {},          // userId -> { lastSeenActivityAt }
  dms: {},            // convId -> { id, members:[a,b], messages:[], updatedAt }
  bridge: {},         // 봇 DM 메시지 id -> convId (디스코드 DM 답장 라우팅용)
  profiles: {},       // userId -> { bio, links } (Fuse 자체 프로필)
  authors: {},        // `${channelId}:${messageId}` -> userId (봇/웹훅이 대신 보낸 글의 진짜 작성자)
  authorInfo: {},     // userId -> { displayName, avatar } (봇 명의로 나간 글을 Fuse에서 제대로 보여주기 위한 스냅샷)
});

let state = empty();
let dirty = false;
let timer = null;

function load() {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    if (fs.existsSync(FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      state = { ...empty(), ...parsed };
    }
  } catch (err) {
    console.error('[db] 로드 실패, 새로 시작합니다:', err.message);
    state = empty();
  }
}
load();

function flush() {
  timer = null;
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    writeFileSafe(FILE, JSON.stringify(state));
  } catch (err) {
    console.error('[db] 저장 실패:', err.message);
  }
}

export function save() {
  dirty = true;
  if (!timer) timer = setTimeout(flush, 400);
}

export function flushNow() {
  if (timer) clearTimeout(timer);
  flush();
}

export const db = new Proxy({}, {
  get: (_, key) => state[key],
  set: (_, key, value) => { state[key] = value; save(); return true; },
});

export function reset() { state = empty(); save(); }

process.on('exit', flushNow);
