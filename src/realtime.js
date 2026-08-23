import { WebSocketServer } from 'ws';
import { sessionFromCookieHeader } from './session.js';

/** userId -> Set<ws> */
const clients = new Map();
let wss = null;

/**
 * 채널 단위 이벤트를 누구에게 보낼지 판단하는 함수.
 * 순환 import를 피하려고 디스코드 모듈이 부팅 때 주입한다.
 * (userId, channelId) => Promise<boolean> | boolean
 */
let canViewChannel = () => false;
export function setVisibilityResolver(fn) {
  canViewChannel = fn;
}

function add(userId, ws) {
  let set = clients.get(userId);
  if (!set) clients.set(userId, (set = new Set()));
  set.add(ws);
}

function drop(userId, ws) {
  const set = clients.get(userId);
  if (!set) return;
  set.delete(ws);
  if (!set.size) clients.delete(userId);
}

function send(ws, type, data) {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify({ type, data, at: Date.now() }));
  } catch {
    /* 소켓이 막 닫힌 경우 — 무시 */
  }
}

export function attach(server) {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/ws')) return; // 다른 업그레이드 요청은 건드리지 않는다
    const session = sessionFromCookieHeader(req.headers.cookie || '');
    if (!session?.userId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.userId = session.userId;
      ws.isAlive = true;
      add(session.userId, ws);
      wss.emit('connection', ws, req);
      send(ws, 'ready', { userId: session.userId });
    });
  });

  wss.on('connection', (ws) => {
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg?.type === 'ping') send(ws, 'pong', {});
      // 클라이언트가 현재 보고 있는 채널 — 타이핑 표시를 좁히는 용도
      if (msg?.type === 'focus') ws.focusChannel = String(msg.channelId || '') || null;
    });
    ws.on('close', () => drop(ws.userId, ws));
    ws.on('error', () => drop(ws.userId, ws));
  });

  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* noop */ }
    }
  }, 30_000);
  beat.unref();

  return wss;
}

/** 특정 유저들에게만 */
export function toUsers(userIds, type, data) {
  for (const userId of new Set(userIds)) {
    const set = clients.get(userId);
    if (!set) continue;
    for (const ws of set) send(ws, type, data);
  }
}

/** 접속 중인 모두에게 (설정 변경 등) */
export function toAll(type, data) {
  if (!wss) return;
  for (const ws of wss.clients) send(ws, type, data);
}

/**
 * 그 채널을 볼 수 있는 사람에게만 — 권한 없는 채널 내용이 새지 않도록 매번 검사한다.
 * data 자리에 함수를 주면 유저별로 다른 페이로드를 만든다 (좋아요/멘션 여부 등).
 */
export async function toChannel(channelId, type, data) {
  const userIds = [...clients.keys()];
  if (!userIds.length) return;
  const allowed = await Promise.all(
    userIds.map(async (userId) => {
      try { return (await canViewChannel(userId, channelId)) ? userId : null; }
      catch { return null; }
    }),
  );
  const build = typeof data === 'function' ? data : () => data;
  for (const userId of allowed.filter(Boolean)) {
    let payload;
    try { payload = build(userId); } catch { continue; }
    if (payload !== undefined) toUsers([userId], type, payload);
  }
}

export function onlineUserIds() {
  return [...clients.keys()];
}

export function isOnline(userId) {
  return clients.has(userId);
}
