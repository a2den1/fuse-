/* 실시간 연결 — 서버 이벤트를 이벤트 버스로 흘려보낸다 */

import { emit, state } from './state.js';
import { wsUrl } from './origin.js';

let socket = null;
let attempt = 0;
let heartbeat = null;
let focusChannel = null;

// 웹소켓은 프록시를 거치지 않고 백엔드에 바로 붙는다
const url = () => wsUrl('/ws');

export function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  try {
    socket = new WebSocket(url());
  } catch {
    scheduleReconnect();
    return;
  }

  socket.addEventListener('open', () => {
    attempt = 0;
    emit('live:status', 'online');
    if (focusChannel) send({ type: 'focus', channelId: focusChannel });
    clearInterval(heartbeat);
    heartbeat = setInterval(() => send({ type: 'ping' }), 25_000);
  });

  socket.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    route(msg.type, msg.data);
  });

  socket.addEventListener('close', () => {
    clearInterval(heartbeat);
    emit('live:status', 'offline');
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    try { socket.close(); } catch { /* 이미 닫힘 */ }
  });
}

function scheduleReconnect() {
  attempt = Math.min(attempt + 1, 6);
  const delay = Math.min(1000 * 2 ** (attempt - 1), 20_000);
  setTimeout(connect, delay);
}

function send(payload) {
  if (socket?.readyState === WebSocket.OPEN) {
    try { socket.send(JSON.stringify(payload)); } catch { /* noop */ }
  }
}

export function focusOn(channelId) {
  focusChannel = channelId || null;
  send({ type: 'focus', channelId: focusChannel });
}

function route(type, data) {
  switch (type) {
    case 'ready':
      emit('live:status', 'online');
      break;
    case 'post:new':
      emit('post:new', data);
      break;
    case 'post:update':
      emit('post:patch', data);
      break;
    case 'post:delete':
      emit('post:remove', data);
      break;
    case 'post:like':
      emit('post:like', data);
      break;
    case 'activity':
      state.unread += 1;
      emit('activity:new', data);
      break;
    case 'typing':
      emit('typing', data);
      break;
    case 'dm':
      emit('dm', data);
      break;
    case 'thread:new':
      emit('thread:new', data);
      break;
    case 'settings':
      Object.assign(state.settings, data);
      emit('settings', data);
      break;
    default:
      break;
  }
}

// 탭이 다시 보이면 끊긴 연결을 즉시 복구한다
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) connect();
});
window.addEventListener('online', connect);
