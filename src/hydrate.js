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

/*
 * "방금 봇 리액션을 뗐다" 는 기억.
 *
 * 디스코드는 리액션을 뗀 직후 한동안 me 는 false 로 주면서 숫자는 그대로 준다.
 * 강제로 다시 받아와도 마찬가지다 — 서버 쪽 집계가 늦게 따라온다.
 * 그 사이에는 봇이 누른 한 개가 남의 것처럼 세어져서, 아무도 누르지 않았는데
 * 1 이 붙어 있는 글이 된다.
 *
 * 우리가 뗐다는 것은 우리가 안다. 잠깐 기억해 뒀다가 그동안만 봇 몫을 빼준다.
 * 시간이 지나면 디스코드 숫자가 맞아 있으므로 기억을 버린다.
 */
const SETTLE_MS = 8_000;
const pulled = new Map();      // `${ch}:${id}:${key}` -> 언제까지 흔들릴지
const othersCache = new Map(); // `${ch}:${id}:${key}` -> 마지막으로 믿을 만했던 "남이 누른 수"

export function markBotReactionPulled(channelId, messageId, key) {
  pulled.set(rk(channelId, messageId, key), Date.now() + SETTLE_MS);
}

function shaky(channelId, messageId, key) {
  const k = rk(channelId, messageId, key);
  const until = pulled.get(k);
  if (!until) return false;
  if (Date.now() > until) { pulled.delete(k); return false; }
  return true;
}

/**
 * 남이(디스코드에서 직접) 누른 수.
 *
 * 우리가 방금 건드렸으면 디스코드 숫자는 잠깐 못 믿는다. 그럴 때는
 * 마지막으로 앞뒤가 맞았을 때 세어둔 값을 쓴다. 어차피 우리가 봇 리액션을
 * 붙이거나 떼는 것은 이 숫자를 바꾸지 않는다 — 남이 누른 건 그대로다.
 */
function othersCountOf(channelId, messageId, r, weProxy) {
  const k = rk(channelId, messageId, r.key);
  const trustworthy = !shaky(channelId, messageId, r.key) && r.botReacted === weProxy;

  if (trustworthy) {
    const n = Math.max(r.count - (r.botReacted ? 1 : 0), 0);
    othersCache.set(k, n);
    return n;
  }
  /*
   * 믿을 만한 값을 아직 한 번도 못 봤으면 0 으로 본다.
   * 근거 없이 "남이 누른 사람이 있다" 고 지어내지 않는다는 뜻이다.
   * 남이 이미 누른 리액션이라면 그 전의 평범한 조회에서 이미 세어져 있다.
   */
  return othersCache.get(k) ?? 0;
}

/** 이 글에 Fuse 쪽에서 누른 것 전부 — key -> [userId] */
export function proxiedReactionsOf(channelId, messageId) {
  const prefix = `${channelId}:${messageId}:`;
  const out = new Map();
  for (const [k, users] of Object.entries(db.reactionProxy)) {
    if (k.startsWith(prefix) && users?.length) out.set(k.slice(prefix.length), users);
  }
  return out;
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

  /*
   * 리액션 숫자를 두 조각으로 나눠서 센다.
   *
   *   남이 디스코드에서 직접 누른 것  = 디스코드 숫자 - (봇이 눌렀으면 1)
   *   Fuse 에서 누른 것              = 우리 기록에 있는 사람 수
   *
   * 봇은 여러 사람을 대신해 한 번만 누르므로, 봇 몫을 빼고 우리 사람 수를 얹어야
   * 맞는다. 이렇게 나눠 두면 디스코드 숫자가 잠깐 뒤처져 있어도(누른 직후에는
   * 흔한 일이다) 우리가 아는 몫은 늘 정확하다.
   *
   * 아직 디스코드 쪽에 안 보이는 것도 우리 기록에 있으면 자리를 만들어 준다 —
   * 누르자마자 사라졌다가 나타나지 않게.
   */
  const proxyMap = proxiedReactionsOf(post.channelId, post.id);
  const merged = [...(post.reactions || [])];
  for (const key of proxyMap.keys()) {
    if (!merged.some((r) => r.key === key)) {
      merged.push({ key, name: key, id: null, animated: false, url: null, count: 0, botReacted: false });
    }
  }

  const all = merged.map((r) => {
    const proxied = proxyMap.get(r.key) || [];
    const others = othersCountOf(post.channelId, post.id, r, proxied.length > 0);
    return { ...r, count: others + proxied.length, me: proxied.includes(viewerId), proxied: proxied.length };
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
