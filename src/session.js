import crypto from 'node:crypto';
import { config } from './config.js';

const COOKIE = 'fuse_sid';
const sessions = new Map(); // sid -> { id, userId, user, accessToken, refreshToken, expiresAt, createdAt, touchedAt }

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
  return session;
}

export function getSession(req) {
  const sid = unpack(req.cookies?.[COOKIE]);
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  if (Date.now() - session.createdAt > config.sessionTtlMs) {
    sessions.delete(sid);
    return null;
  }
  session.touchedAt = Date.now();
  return session;
}

export function destroySession(req) {
  const sid = unpack(req.cookies?.[COOKIE]);
  if (sid) sessions.delete(sid);
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
  for (const [sid, s] of sessions) if (s.createdAt < cutoff) sessions.delete(sid);
}, 3_600_000).unref();
