/* 서버 API 래퍼 */

import { apiUrl, credentialsMode } from './origin.js';

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, form } = {}) {
  const init = { method, credentials: credentialsMode, headers: {} };

  if (form) {
    init.body = form;                       // FormData — Content-Type은 브라우저가 붙인다
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(apiUrl('/api' + path), init);
  } catch {
    throw new ApiError('서버에 연결할 수 없습니다.', 0);
  }

  if (res.status === 401) {
    location.href = '/login.html';
    throw new ApiError('로그인이 필요합니다.', 401);
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }

  if (!res.ok) {
    throw new ApiError(data?.error || '요청에 실패했습니다. (' + res.status + ')', res.status);
  }
  return data;
}

const qs = (params) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== null && v !== undefined && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? '?' + s : '';
};

export const api = {
  me: () => request('/me'),
  guilds: () => request('/guilds'),

  feed: (params) => request('/feed' + qs(params)),
  channel: (channelId, params) => request('/channel/' + channelId + qs(params)),
  post: (channelId, messageId) => request('/post/' + channelId + '/' + messageId),

  createPost: (form) => request('/post', { method: 'POST', form }),
  reply: (channelId, messageId, form) =>
    request('/post/' + channelId + '/' + messageId + '/reply', { method: 'POST', form }),
  editPost: (channelId, messageId, content) =>
    request('/post/' + channelId + '/' + messageId, { method: 'PATCH', body: { content } }),
  deletePost: (channelId, messageId) =>
    request('/post/' + channelId + '/' + messageId, { method: 'DELETE' }),

  like: (channelId, messageId) =>
    request('/post/' + channelId + '/' + messageId + '/like', { method: 'POST' }),
  react: (channelId, messageId, emoji, on) =>
    request('/post/' + channelId + '/' + messageId + '/react', { method: 'POST', body: { emoji, on } }),

  search: (q) => request('/search' + qs({ q })),
  discover: () => request('/discover'),
  guild: (guildId) => request('/guild/' + guildId),
  guildMembers: (guildId, q) => request('/guild/' + guildId + '/members' + qs({ q })),
  joinGuild: (guildId) => request('/guild/' + guildId + '/join', { method: 'POST' }),
  pinGuild: (guildId) => request('/guild/' + guildId + '/pin', { method: 'POST' }),

  user: (userId) => request('/user/' + userId),
  updateProfile: (body) => request('/profile', { method: 'PATCH', body }),

  activity: () => request('/activity'),
  readActivity: () => request('/activity/read', { method: 'POST' }),

  conversations: () => request('/dm'),
  conversation: (userId) => request('/dm/' + userId),
  sendDM: (userId, form) => request('/dm/' + userId, { method: 'POST', form }),

  settings: () => request('/settings'),
  saveSettings: (patch) => request('/settings', { method: 'PATCH', body: patch }),

  typing: (channelId) => request('/typing', { method: 'POST', body: { channelId } }),

  logout: () => fetch(apiUrl('/auth/logout'), { method: 'POST', credentials: credentialsMode }),
};

export { ApiError };
