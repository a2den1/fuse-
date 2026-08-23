/* 앱 전역 상태 + 아주 작은 이벤트 버스 */

export const state = {
  me: null,          // { id, displayName, avatar, ... }
  guilds: [],
  settings: {},
  unread: 0,
  demo: false,
  bot: null,
  guildFilter: null, // 피드에서 고른 서버 id
};

const listeners = new Map();

export function on(event, fn) {
  let set = listeners.get(event);
  if (!set) listeners.set(event, (set = new Set()));
  set.add(fn);
  return () => set.delete(fn);
}

export function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of [...set]) {
    try { fn(payload); } catch (err) { console.error('[bus] ' + event, err); }
  }
}

/** 라우터가 부팅 때 채워 넣는다 (순환 import 회피) */
export const nav = {
  go: () => {},
  back: () => {},
  replace: () => {},
};

export const postKey = (post) => post.channelId + ':' + post.id;

export const guildOf = (id) => state.guilds.find((g) => g.id === id) || null;

export function discordLink(post) {
  if (!post.guildId) return null;
  return 'https://discord.com/channels/' + post.guildId + '/' + post.channelId + '/' + post.id;
}
