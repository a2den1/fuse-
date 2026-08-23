import { db, save } from './db.js';

const rk = (channelId, messageId, key) => `${channelId}:${messageId}:${key}`;

/*
 * 하트는 별도의 좋아요가 아니라 ❤️ 리액션이다.
 *
 * 예전에는 좋아요를 Fuse 안에만 저장했다. 그러면 디스코드에서 ❤️ 를 눌러도
 * Fuse 의 하트는 비어 있고, Fuse 에서 하트를 눌러도 디스코드에는 아무 일도
 * 일어나지 않는다. 같은 것을 두 군데에 따로 세고 있었던 셈이다.
 * 이제 둘은 같은 하나다.
 */
export const HEART = '❤️';

/* ------------------------------ 북마크 ------------------------------ */

const bk = (channelId, messageId) => `${channelId}:${messageId}`;

export function bookmarksOf(userId) {
  return db.bookmarks[userId] || [];
}

export function isBookmarked(userId, channelId, messageId) {
  const key = bk(channelId, messageId);
  return (db.bookmarks[userId] || []).some((b) => bk(b.channelId, b.messageId) === key);
}

/** 누르면 담기고 다시 누르면 빠진다. 최근에 담은 것이 앞이다. */
export function toggleBookmark(userId, channelId, messageId) {
  const key = bk(channelId, messageId);
  const list = (db.bookmarks[userId] || []).filter((b) => bk(b.channelId, b.messageId) !== key);
  const saved = list.length === (db.bookmarks[userId] || []).length;
  if (saved) list.unshift({ channelId, messageId, at: Date.now() });
  if (list.length) db.bookmarks[userId] = list;
  else delete db.bookmarks[userId];
  save();
  return { saved, count: list.length };
}

/** 리액션 누른 사람 이름을 나중에 보여주려면 누구인지 기억해 둬야 한다 */
export function rememberAuthorInfo(user) {
  if (!user?.id) return;
  const prev = db.authorInfo[user.id];
  if (prev?.displayName === user.displayName && prev?.avatar === user.avatar) return;
  db.authorInfo[user.id] = { displayName: user.displayName, avatar: user.avatar };
  save();
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
  const mine = post.author?.id === viewerId;

  const all = (post.reactions || []).map((r) => {
    const proxied = reactorsOf(post.channelId, post.id, r.key);
    // 봇이 대신 누른 리액션은 Fuse 유저 수가 진짜 숫자다.
    const count = r.botReacted ? Math.max(r.count - 1, 0) + proxied.length : r.count;
    return { ...r, count, me: proxied.includes(viewerId), proxied: proxied.length };
  }).filter((r) => r.count > 0);

  // 하트는 액션 바의 버튼이 맡는다. 칩으로 또 보여주면 같은 것이 두 번 나온다.
  const heart = all.find((r) => r.key === HEART);
  const reactions = all.filter((r) => r.key !== HEART);

  const mentionedMe = !!(
    post.mentions?.users?.[viewerId] ||
    (post.mentions?.everyone && !mine)
  );

  return {
    ...post,
    reactions,
    likeCount: heart?.count || 0,
    liked: !!heart?.me,
    bookmarked: isBookmarked(viewerId, post.channelId, post.id),
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
