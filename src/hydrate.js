import { db, save } from './db.js';

const lk = (channelId, messageId) => `${channelId}:${messageId}`;
const rk = (channelId, messageId, key) => `${channelId}:${messageId}:${key}`;

export function likesOf(channelId, messageId) {
  return db.likes[lk(channelId, messageId)] || [];
}

export function toggleLike(channelId, messageId, userId) {
  const key = lk(channelId, messageId);
  const list = db.likes[key] ? [...db.likes[key]] : [];
  const i = list.indexOf(userId);
  const liked = i < 0;
  if (liked) list.push(userId);
  else list.splice(i, 1);
  if (list.length) db.likes[key] = list;
  else delete db.likes[key];
  save();
  return { liked, count: list.length };
}

export function reactorsOf(channelId, messageId, key) {
  return db.reactionProxy[rk(channelId, messageId, key)] || [];
}

export function setReactor(channelId, messageId, key, userId, on) {
  const k = rk(channelId, messageId, key);
  const list = db.reactionProxy[k] ? [...db.reactionProxy[k]] : [];
  const i = list.indexOf(userId);
  if (on && i < 0) list.push(userId);
  if (!on && i >= 0) list.splice(i, 1);
  if (list.length) db.reactionProxy[k] = list;
  else delete db.reactionProxy[k];
  save();
  return list;
}

/**
 * 뷰어에 따라 달라지는 필드를 채운다.
 * 저장소의 Post 객체를 오염시키지 않도록 얕은 복사본을 돌려준다.
 */
export function hydrate(post, viewerId, { canManage = false } = {}) {
  if (!post) return null;
  const likes = likesOf(post.channelId, post.id);
  const mine = post.author?.id === viewerId;

  const reactions = (post.reactions || []).map((r) => {
    const proxied = reactorsOf(post.channelId, post.id, r.key);
    // 봇이 대신 누른 리액션은 Fuse 유저 수가 진짜 숫자다.
    const count = r.botReacted ? Math.max(r.count - 1, 0) + proxied.length : r.count;
    return { ...r, count, me: proxied.includes(viewerId), proxied: proxied.length };
  }).filter((r) => r.count > 0);

  const mentionedMe = !!(
    post.mentions?.users?.[viewerId] ||
    (post.mentions?.everyone && !mine)
  );

  return {
    ...post,
    reactions,
    likeCount: likes.length,
    liked: likes.includes(viewerId),
    mine,
    mentionedMe,
    // 웹훅으로 대신 보낸 글만 수정/삭제할 수 있다 (진짜 디스코드 유저의 글은 손댈 수 없음)
    canEdit: mine && post.viaFuse,
    canDelete: (mine && post.viaFuse) || canManage,
  };
}

export function hydrateMany(posts, viewerId, opts) {
  return posts.map((p) => hydrate(p, viewerId, opts));
}

/* ------------------------------- 알림 ------------------------------- */

const MAX_ACTIVITY = 200;

export function pushActivity(userId, item) {
  if (!userId) return null;
  const list = db.activity[userId] ? [...db.activity[userId]] : [];
  const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now(), read: false, ...item };
  // 같은 대상에 대한 같은 종류의 알림이 연달아 쌓이지 않게 합친다
  const dupe = list.findIndex(
    (x) => x.kind === entry.kind && x.targetId === entry.targetId && x.actor?.id === entry.actor?.id,
  );
  if (dupe >= 0) list.splice(dupe, 1);
  list.unshift(entry);
  db.activity[userId] = list.slice(0, MAX_ACTIVITY);
  save();
  return entry;
}

export function activityFor(userId) {
  return db.activity[userId] || [];
}

export function markActivityRead(userId) {
  const list = db.activity[userId];
  if (!list?.length) return 0;
  db.activity[userId] = list.map((x) => ({ ...x, read: true }));
  save();
  return list.filter((x) => !x.read).length;
}

export function unreadCount(userId) {
  return (db.activity[userId] || []).filter((x) => !x.read).length;
}

/* ------------------------------ 설정 ------------------------------- */

export const DEFAULT_SETTINGS = {
  theme: 'system',      // system | light | dark
  notifications: true,  // 멘션·답글·좋아요·쪽지 알림
  reduceMotion: false,
  showSystemMessages: false,
  compact: false,
  autoplayGifs: true,
  feedSort: 'recent',   // recent | active
};

export function settingsFor(userId) {
  return { ...DEFAULT_SETTINGS, ...(db.settings[userId] || {}) };
}

export function updateSettings(userId, patch) {
  const next = { ...settingsFor(userId) };
  for (const [k, v] of Object.entries(patch || {})) {
    if (k in DEFAULT_SETTINGS) next[k] = v;
  }
  db.settings[userId] = next;
  save();
  return next;
}
