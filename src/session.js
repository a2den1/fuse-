import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { writeFileSafe } from './safeWrite.js';

const COOKIE = 'fuse_sid';
const sessions = new Map(); // sid -> { id, userId, user, accessToken, refreshToken, expiresAt, createdAt, touchedAt }

/*
 * 로그인 유지.
 *
 * 세션이 메모리에만 있으면 앱을 껐다 켤 때마다 다시 로그인해야 한다.
 * 데이터 폴더에 남겨두고 시작할 때 되살린다. 만료된 것은 그때 버린다.
 *
 * 여기에는 디스코드 액세스 토큰이 들어 있으므로 파일 권한을 좁혀 둔다.
 * (자격증명과 같은 폴더이고, 이미 그 폴더가 보호 대상이다)
 */
const STORE = () => path.join(config.dataDir, 'sessions.json');

let saveTimer = null;

function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(config.dataDir, { recursive: true });
      const rows = [...sessions.values()].map((s) => ({
        id: s.id,
        userId: s.userId,
        user: s.user,
        accessToken: s.accessToken ?? null,
        refreshToken: s.refreshToken ?? null,
        expiresAt: s.expiresAt ?? null,
        guildIds: s.guildIds ?? null,
        createdAt: s.createdAt,
        touchedAt: s.touchedAt,
      }));
      writeFileSafe(STORE(), JSON.stringify(rows), { mode: 0o600 });
    } catch (err) {
      console.warn('[session] 저장 실패:', err.message);
    }
  }, 300);
  saveTimer.unref?.();
}

function restore() {
  try {
    if (!fs.existsSync(STORE())) return;
    const rows = JSON.parse(fs.readFileSync(STORE(), 'utf8'));
    if (!Array.isArray(rows)) return;
    const cutoff = Date.now() - config.sessionTtlMs;
    let kept = 0;
    for (const row of rows) {
      if (!row?.id || !row.userId || row.createdAt < cutoff) continue;
      sessions.set(row.id, row);
      kept += 1;
    }
    if (kept) console.log('[session] 로그인 ' + kept + '건을 이어서 유지합니다.');
  } catch (err) {
    console.warn('[session] 복원 실패, 새로 시작합니다:', err.message);
  }
}
restore();

const sign = (sid) =>
  crypto.createHmac('sha256', config.sessionSecret).update(sid).digest('base64url');

const pack = (sid) => `${sid}.${sign(sid)}`;

function unpack(raw) {
  if (typeof raw !== 'string') return null;
  const idx = raw.lastIndexOf('.');
  if (idx <= 0) return null;
  const sid = raw.slice(0, idx);
  const mac = raw.slice(idx + 1);
  const expected = sign(sid);
  // 타이밍 공격 방지: 길이가 다르면 timingSafeEqual이 던지므로 먼저 걸러낸다.
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  return sid;
}

export function createSession(data) {
  const id = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  const session = { id, createdAt: now, touchedAt: now, ...data };
  sessions.set(id, session);
  persist();
  return session;
}

export function getSession(req) {
  const sid = unpack(req.cookies?.[COOKIE]);
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  if (Date.now() - session.createdAt > config.sessionTtlMs) {
    sessions.delete(sid);
    persist();
    return null;
  }
  session.touchedAt = Date.now();
  return session;
}

export function destroySession(req) {
  const sid = unpack(req.cookies?.[COOKIE]);
  if (sid && sessions.delete(sid)) persist();
}

export function setSessionCookie(res, session) {
  /*
   * 프런트엔드가 다른 출처에 있으면 (예: Vercel + 별도 백엔드)
   * SameSite=Lax 쿠키는 아예 실려 가지 않는다. 그럴 때만 None 으로 바꾼다.
   * None 은 Secure 를 요구하므로 https 가 아니면 의미가 없다.
   */
  const crossSite = config.allowedOrigins.length > 0;
  const secure = crossSite || config.baseUrl.startsWith('https://');

  res.cookie(COOKIE, pack(session.id), {
    httpOnly: true,
    sameSite: crossSite ? 'none' : 'lax',
    secure,
    maxAge: config.sessionTtlMs,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

/** WebSocket 업그레이드처럼 req.cookies가 없는 경로용 */
export function sessionFromCookieHeader(header = '') {
  const raw = header
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const sid = unpack(decodeURIComponent(raw.slice(COOKIE.length + 1)));
  return sid ? sessions.get(sid) || null : null;
}

export function allSessions() {
  return [...sessions.values()];
}

// 만료 세션 청소 (1시간마다)
setInterval(() => {
  const cutoff = Date.now() - config.sessionTtlMs;
  let dropped = 0;
  for (const [sid, s] of sessions) if (s.createdAt < cutoff && sessions.delete(sid)) dropped += 1;
  if (dropped) persist();
}, 3_600_000).unref();
