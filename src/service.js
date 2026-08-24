/**
 * 프로바이더 중립 서비스 레이어.
 * 라우트는 이 파일만 호출하고, 실제 데이터는 디스코드 봇 또는 데모 백엔드가 제공한다.
 */
import { config } from './config.js';
import { db, save } from './db.js';
import { store } from './store.js';
import {
  hydrate, hydrateMany, setReactor, reactorsOf, rememberAuthorInfo, HEART,
  markBotReactionPulled,
  toggleBookmark, bookmarksOf,
  pushActivity, activityFor, markActivityRead, unreadCount,
  settingsFor, updateSettings,
} from './hydrate.js';
import * as realtime from './realtime.js';

let backend = null;
let startFakeGateway = null;

export function activeBackend() { return backend; }
export const isDemo = () => backend?.kind === 'demo';

/* ============================== 부팅 ============================== */

export async function boot() {
  if (config.demo) {
    const mock = await import('./demo/mock.js');
    backend = mock.backend;
    startFakeGateway = mock.startFakeGateway;
    mock.onEvents(eventHooks);
    startFakeGateway();
    console.log('[fuse] 데모 모드로 실행합니다. 디스코드에 접속하지 않습니다.');
  } else {
    const bot = await import('./discord/bot.js');
    backend = bot.backend;
    bot.onEvents(eventHooks);
    await bot.start();
  }
  realtime.setVisibilityResolver((userId, channelId) => backend.canView(userId, channelId));
  return backend;
}

/* ============================ 이벤트 처리 ============================ */

const eventHooks = {
  ready() {},

  postCreated(post) {
    realtime.toChannel(post.channelId, 'post:new', (uid) => hydrate(post, uid));
    notifyForPost(post);
  },

  postUpdated(post) {
    realtime.toChannel(post.channelId, 'post:update', (uid) => hydrate(post, uid));
  },

  postDeleted(ref) {
    realtime.toChannel(ref.channelId, 'post:delete', ref);
  },

  typing(payload) {
    realtime.toChannel(payload.channelId, 'typing', payload);
  },

  threadCreated(channel) {
    realtime.toChannel(channel.parentId || channel.id, 'thread:new', channel);
  },

  directMessage(msg) {
    handleIncomingDiscordDM(msg).catch((err) => console.warn('[dm] 브릿지 실패:', err.message));
  },
};

/**
 * 알림에 넣을 미리보기 텍스트.
 * 원문의 <@아이디> 를 사람 이름으로 바꿔 저장한다 — 알림 목록에는 멘션 정보가 따라가지 않으므로
 * 여기서 풀어두지 않으면 나중에 "@사용자" 로만 보인다.
 */
function excerptOf(post, limit = 140) {
  let text = post.content || '';
  for (const [id, user] of Object.entries(post.mentions?.users || {})) {
    const label = '@' + user.name;
    text = text.split('<@' + id + '>').join(label).split('<@!' + id + '>').join(label);
  }
  for (const [id, role] of Object.entries(post.mentions?.roles || {})) {
    text = text.split('<@&' + id + '>').join('@' + role.name);
  }
  for (const [id, channel] of Object.entries(post.mentions?.channels || {})) {
    text = text.split('<#' + id + '>').join('#' + channel.name);
  }
  if (!text.trim()) {
    if (post.attachments?.length) text = '사진 ' + post.attachments.length + '장';
    else if (post.stickers?.length) text = '스티커';
  }
  return text.slice(0, limit);
}

function notifyForPost(post) {
  const actor = post.author;
  if (!actor) return;

  // 멘션
  for (const uid of Object.keys(post.mentions?.users || {})) {
    if (uid === actor.id) continue;
    const entry = pushActivity(uid, {
      kind: 'mention', actor, targetId: post.id, channelId: post.channelId,
      guildId: post.guildId, excerpt: excerptOf(post),
      guildName: post.guild?.name || null, channelName: post.channel?.name || null,
    });
    realtime.toUsers([uid], 'activity', entry);
  }

  // 답글 → 원글 작성자에게 (네이티브 답장이든 스레드 답글이든)
  if (post.referenceId) {
    const parent = store.get(post.referenceChannelId || post.channelId, post.referenceId);
    const targetId = parent?.author?.id;
    if (targetId && targetId !== actor.id && !post.mentions?.users?.[targetId]) {
      const entry = pushActivity(targetId, {
        kind: 'reply', actor, targetId: parent.id, channelId: parent.channelId,
        guildId: post.guildId, excerpt: excerptOf(post),
        parentExcerpt: excerptOf(parent, 80),
        guildName: post.guild?.name || null, channelName: post.channel?.name || null,
      });
      realtime.toUsers([targetId], 'activity', entry);
    }
  }
}

/* ============================== 세션 ============================== */


export async function guildsFor(session) {
  const guilds = await backend.guildsFor(session.userId);
  const pinned = new Set(db.follows[session.userId] || []);
  return guilds.map((g) => ({ ...g, pinned: pinned.has(g.id) }));
}

export async function me(session) {
  const [guilds] = await Promise.all([guildsFor(session)]);
  return {
    user: session.user,
    guilds,
    settings: settingsFor(session.userId),
    unread: unreadCount(session.userId),
    demo: isDemo(),
    bot: backend.botUser(),
  };
}

/* ============================== 피드 ============================== */

async function feedChannelIds(session, { guildId = null } = {}) {
  const guilds = await backend.guildsFor(session.userId);
  const targets = guildId ? guilds.filter((g) => g.id === guildId) : guilds;
  const ids = [];
  for (const g of targets) {
    const channels = await backend.visibleChannels(session.userId, g.id);
    // 채널이 아주 많은 서버에서 전부 훑으면 느려지므로 상위 N개만
    ids.push(...channels.slice(0, config.feed.channelsPerGuild).map((c) => c.id));
  }
  return ids;
}

function feedFilter(settings, { allowThreadMessages = false, allowReplies = false } = {}) {
  return (post) => {
    // 답글은 상세 화면에서만 — 단, 스레드 채널 자체를 보고 있을 때는 그게 본문이다
    if (post.inThread && !allowThreadMessages) return false;
    // 네이티브 답장도 같은 채널에 남으므로 타임라인에서는 접어둔다
    if (post.referenceId && !allowReplies) return false;
    if (!settings.showSystemMessages && post.system) return false;
    if (!post.content && !post.attachments?.length && !post.embeds?.length && !post.stickers?.length) return false;
    return true;
  };
}

export async function feed(session, { guildId = null, before = null, limit = config.feed.pageSize } = {}) {
  const settings = settingsFor(session.userId);
  const channelIds = await feedChannelIds(session, { guildId });
  if (!channelIds.length) return { posts: [], cursor: null, empty: true };

  await Promise.all(channelIds.map((id) => backend.ensureMessages(id)));

  const filter = feedFilter(settings);
  let merged = store.merge(channelIds, { before, filter });

  // 첫 페이지가 부족하면 채널별로 과거를 더 끌어온다
  for (let pass = 0; merged.length < limit && pass < 2; pass += 1) {
    const deeper = channelIds.filter((id) => !store.hasReachedStart(id));
    if (!deeper.length) break;
    await Promise.all(deeper.map((id) => backend.ensureMessages(id, { before: store.oldestId(id) })));
    merged = store.merge(channelIds, { before, filter });
  }

  const page = merged.slice(0, limit);
  const cursor = merged.length > limit ? page[page.length - 1].createdAt : null;
  return { posts: present(page, session.userId, replyCounts(channelIds)), cursor, empty: false };
}

export async function channelFeed(session, channelId, { before = null, limit = config.feed.pageSize } = {}) {
  if (!(await backend.canView(session.userId, channelId))) {
    throw Object.assign(new Error('이 채널을 볼 권한이 없습니다.'), { status: 403 });
  }
  const settings = settingsFor(session.userId);
  await backend.ensureMessages(channelId);
  const channel = await backend.channelInfo(channelId);
  // 채널 화면은 그 채널의 대화 전체다 — 답장도 원본 아래가 아니라 시간순 그대로 보여준다
  const filter = feedFilter(settings, {
    allowThreadMessages: channel?.kind === 'thread',
    allowReplies: true,
  });
  let merged = store.merge([channelId], { before, filter });
  for (let pass = 0; merged.length < limit && pass < 2; pass += 1) {
    if (store.hasReachedStart(channelId)) break;
    await backend.ensureMessages(channelId, { before: store.oldestId(channelId) });
    merged = store.merge([channelId], { before, filter });
  }
  const page = merged.slice(0, limit);
  return {
    posts: present(page, session.userId, replyCounts([channelId])),
    cursor: merged.length > limit ? page[page.length - 1].createdAt : null,
    channel,
  };
}

/* ============================== 상세 ============================== */

export async function detail(session, channelId, messageId) {
  if (!(await backend.canView(session.userId, channelId))) {
    throw Object.assign(new Error('이 글을 볼 권한이 없습니다.'), { status: 403 });
  }
  const post = await backend.getMessage(channelId, messageId);
  if (!post) throw Object.assign(new Error('글을 찾을 수 없습니다.'), { status: 404 });

  let parent = null;
  if (post.referenceId && post.referenceChannelId) {
    const p = await backend.getMessage(post.referenceChannelId, post.referenceId);
    if (p) parent = hydrate(p, session.userId);
  }

  // 답글은 두 곳에 있을 수 있다.
  // 네이티브 답장은 같은 채널에서 이 글을 참조하고, 예전 스레드 답글은 스레드 채널 안에 있다.
  const found = new Map();

  for (const r of nativeRepliesOf(channelId, messageId)) found.set(r.id, r);

  if (post.threadId) {
    await backend.ensureMessages(post.threadId);
    for (const r of store.list(post.threadId)) {
      if (r.id !== post.id) found.set(r.id, r);
    }
  }

  const replies = hydrateMany(
    [...found.values()].sort((a, b) => a.createdAt - b.createdAt),
    session.userId,
  );

  return { post: hydrate(post, session.userId), parent, replies };
}

/* ============================== 작성 ============================== */

const MAX_LEN = 2000;

function assertContent(content, files) {
  // 멀티파트 폼은 줄바꿈을 CRLF로 인코딩한다. 그대로 두면 마크다운 줄 단위 규칙이 깨지므로
  // 디스코드로 보내기 전에 여기서 한 번 정리한다.
  const text = (content || '').replace(/\r\n?/g, '\n').trim();
  if (!text && !files.length) {
    throw Object.assign(new Error('내용을 입력해 주세요.'), { status: 400 });
  }
  if (text.length > MAX_LEN) {
    throw Object.assign(new Error('글은 ' + MAX_LEN + '자까지 쓸 수 있습니다.'), { status: 400 });
  }
  return text;
}

export async function createPost(session, { channelId, content, files = [] }) {
  const text = assertContent(content, files);
  if (!(await backend.canSend(session.userId, channelId))) {
    throw Object.assign(new Error('이 채널에 글을 쓸 권한이 없습니다.'), { status: 403 });
  }
  const post = await backend.send(session.user, channelId, { content: text, files });
  eventHooks.postCreated(post);
  return hydrate(post, session.userId);
}

/** 같은 채널에서 이 글을 참조하는 답글들 */
function nativeRepliesOf(channelId, messageId) {
  return store.list(channelId).filter((p) => p.referenceId === messageId);
}

/**
 * 네이티브 답장에는 스레드가 없어서 discord.js 가 답글 수를 알려주지 않는다.
 * 캐시를 한 번 훑어 "이 글을 참조하는 메시지가 몇 개인지" 세어 둔다.
 */
function replyCounts(channelIds) {
  const map = new Map();
  for (const id of new Set(channelIds)) {
    for (const p of store.list(id)) {
      if (!p.referenceId) continue;
      map.set(p.referenceId, (map.get(p.referenceId) || 0) + 1);
    }
  }
  return map;
}

/**
 * 답장이 무엇에 달린 것인지 한 줄 미리보기를 붙인다.
 * 디스코드가 답장 위에 원본을 살짝 보여주는 것과 같은 역할이다.
 */
function referencePreview(post) {
  if (!post.referenceId) return null;
  const parent = store.get(post.referenceChannelId || post.channelId, post.referenceId);
  if (!parent) return { unavailable: true };
  return {
    id: parent.id,
    channelId: parent.channelId,
    author: { id: parent.author.id, displayName: parent.author.displayName, avatar: parent.author.avatar },
    excerpt: excerptOf(parent, 80),
  };
}

/** 뷰어 정보 + 답글 수 + 답장 맥락까지 채워 화면에 내보낼 형태로 만든다 */
function present(posts, viewerId, counts, opts) {
  return hydrateMany(posts, viewerId, opts).map((p) => {
    const replies = p.threadReplyCount || counts?.get(p.id) || 0;
    const replyTo = referencePreview(p);
    if (replies === p.threadReplyCount && !replyTo) return p;
    return { ...p, threadReplyCount: replies, replyTo };
  });
}

export async function createReply(session, { channelId, messageId, content, files = [] }) {
  const text = assertContent(content, files);
  if (!(await backend.canSend(session.userId, channelId))) {
    throw Object.assign(new Error('여기에 답글을 달 권한이 없습니다.'), { status: 403 });
  }
  const parent = await backend.getMessage(channelId, messageId);
  if (!parent) throw Object.assign(new Error('원글을 찾을 수 없습니다.'), { status: 404 });

  const bumpParent = (post) => {
    parent.threadReplyCount = (parent.threadReplyCount || 0) + 1;
    eventHooks.postCreated(post);
    eventHooks.postUpdated(parent);
    return hydrate(post, session.userId);
  };

  /* 1) 네이티브 답장 — 디스코드에서 화살표로 원본이 딸려 보인다 */
  if (config.replyMode === 'reply' && backend.replyNative) {
    const post = await backend.replyNative(session.user, channelId, messageId, { content: text, files });
    return bumpParent(post);
  }

  /* 2) 스레드 — 원본에 스레드를 파고 그 안에 남긴다 */
  if (config.replyMode === 'thread') {
    const thread = await backend.ensureThread(channelId, messageId, (parent.content || '스레드').slice(0, 90));
    if (thread) {
      const post = await backend.send(session.user, thread.id, { content: text, files });
      post.referenceId = parent.id;
      post.referenceChannelId = channelId;
      post.inThread = true;
      parent.threadId = thread.id;
      return bumpParent(post);
    }
    // 스레드를 못 만드는 채널이면 아래 인용문 방식으로 흘러간다
  }

  /* 3) 웹훅 — 회원님 이름·프사는 지키고, 원본은 인용문으로 보여준다 */
  const quoted = '> ' + (parent.content || '(내용 없음)').split('\n')[0].slice(0, 120) +
    '\n> — ' + parent.author.displayName + '\n\n' + text;
  const post = await backend.send(session.user, channelId, { content: quoted, files });
  post.referenceId = parent.id;
  post.referenceChannelId = channelId;
  return bumpParent(post);
}

export async function editPost(session, channelId, messageId, content) {
  const post = await backend.getMessage(channelId, messageId);
  if (!post) throw Object.assign(new Error('글을 찾을 수 없습니다.'), { status: 404 });
  const view = hydrate(post, session.userId);
  if (!view.canEdit) {
    throw Object.assign(new Error('Fuse에서 쓴 자기 글만 수정할 수 있습니다.'), { status: 403 });
  }
  const text = assertContent(content, []);
  const updated = await backend.edit(channelId, messageId, text);
  if (updated) eventHooks.postUpdated(updated);
  return hydrate(updated || post, session.userId);
}

export async function deletePost(session, channelId, messageId) {
  const post = await backend.getMessage(channelId, messageId);
  if (!post) return { deleted: true };
  const view = hydrate(post, session.userId);
  if (!view.canDelete) {
    throw Object.assign(new Error('Fuse에서 쓴 자기 글만 지울 수 있습니다.'), { status: 403 });
  }
  await backend.remove(channelId, messageId);
  eventHooks.postDeleted({ channelId, id: messageId });
  return { deleted: true };
}

/* =========================== 좋아요 / 리액션 =========================== */

/*
 * 하트 = ❤️ 리액션.
 *
 * 버튼 하나가 두 가지 일을 하지 않도록, 좋아요는 리액션과 같은 길을 탄다.
 * 디스코드에서 ❤️ 를 눌러도 Fuse 의 하트가 켜지고, 그 반대도 된다.
 */
export async function like(session, channelId, messageId) {
  const post = await backend.getMessage(channelId, messageId);
  if (!post) throw Object.assign(new Error('글을 찾을 수 없습니다.'), { status: 404 });
  if (!(await backend.canView(session.userId, channelId))) {
    throw Object.assign(new Error('권한이 없습니다.'), { status: 403 });
  }

  // 켤지 끌지는 줄을 선 뒤에 정한다 (react 안에서)
  const updated = await react(session, channelId, messageId, HEART, 'toggle');
  const result = { liked: !!updated?.liked, count: updated?.likeCount || 0 };

  realtime.toChannel(channelId, 'post:like', (uid) => ({
    channelId, id: messageId, likeCount: result.count,
    liked: uid === session.userId ? result.liked : undefined,
  }));

  if (result.liked && post.author.id !== session.userId) {
    const entry = pushActivity(post.author.id, {
      kind: 'like', actor: session.user, targetId: messageId, channelId,
      guildId: post.guildId, excerpt: excerptOf(post),
      guildName: post.guild?.name || null, channelName: post.channel?.name || null,
    });
    realtime.toUsers([post.author.id], 'activity', entry);
  }
  return result;
}

/*
 * 같은 리액션에 대한 요청은 한 줄로 세운다.
 *
 * 광클하면 요청 여러 개가 겹친다. 겹치면 둘 다 "아직 아무도 안 눌렀다" 를
 * 보고 각자 봇 리액션을 붙이거나 떼는데, 끝나는 순서는 보장되지 않는다.
 * 그러면 디스코드에는 없는데 Fuse 기록에는 남아 있는 상태가 되고,
 * 그 뒤로는 눌러도 아무 일도 일어나지 않는다.
 * 앞 작업이 끝난 뒤에 현재 상태를 다시 읽고 움직인다.
 */
const reactionQueue = new Map(); // `${channelId}:${messageId}:${key}` -> Promise

function queueReaction(lockKey, task) {
  const prev = reactionQueue.get(lockKey) || Promise.resolve();
  const next = prev.then(task, task);
  // 줄이 끝나면 지운다 — 안 그러면 메시지마다 프로미스가 쌓인다
  reactionQueue.set(lockKey, next.catch(() => {}).finally(() => {
    if (reactionQueue.get(lockKey) === next) reactionQueue.delete(lockKey);
  }));
  return next;
}

export async function react(session, channelId, messageId, key, on) {
  if (!(await backend.canView(session.userId, channelId))) {
    throw Object.assign(new Error('권한이 없습니다.'), { status: 403 });
  }
  if (!key || key.length > 60) {
    throw Object.assign(new Error('올바르지 않은 이모지입니다.'), { status: 400 });
  }

  return queueReaction(`${channelId}:${messageId}:${key}`, async () => {
    // 줄을 서서 기다린 뒤이므로 여기서 다시 읽어야 한다
    const before = reactorsOf(channelId, messageId, key);
    const mine = before.includes(session.userId);
    const others = before.filter((u) => u !== session.userId);

    // 'toggle' 은 "지금 상태의 반대" — 줄을 선 뒤에 정해야 맞다.
    // 밖에서 미리 정하면 연타했을 때 여섯 번 다 같은 값을 들고 들어온다.
    const want = on === 'toggle' ? !mine : !!on;

    let updated = null;
    if (want && !before.length) {
      // 봇 리액션은 "Fuse 유저가 한 명이라도 남아 있을 때"만 유지한다
      updated = await backend.react(channelId, messageId, key, true);
      // 붙인 직후에도 디스코드 숫자는 잠깐 흔들린다
      markBotReactionPulled(channelId, messageId, key);
    } else if (!want && others.length === 0) {
      /*
       * 나 말고 아무도 안 남았으면 봇 리액션을 뗀다.
       * mine 이 아니어도 시도한다 — 예전에 떼기가 실패해서 봇 것만 남아 있는
       * 글을 여기서 같이 치운다. 없으면 아무 일도 일어나지 않는다.
       */
      updated = await backend.react(channelId, messageId, key, false);
      // 디스코드 숫자가 따라올 때까지는 우리가 뗐다는 사실로 보정한다
      markBotReactionPulled(channelId, messageId, key);
    }

    if (mine !== want) setReactor(channelId, messageId, key, session.userId, want);
    if (want) rememberAuthorInfo(session.user);

    const post = updated || (await backend.getMessage(channelId, messageId));
    if (post) eventHooks.postUpdated(post);
    return post ? hydrate(post, session.userId) : null;
  });
}

/**
 * 이 리액션을 누른 사람들.
 *
 * 디스코드에서 직접 누른 사람은 그대로, 봇 명의로 나간 자리는
 * 실제로 누른 Fuse 유저들로 바꿔 넣는다. 그래야 "봇이 눌렀다" 가 아니라
 * 누가 눌렀는지가 보인다.
 */
export async function reactionUsers(session, channelId, messageId, key) {
  if (!(await backend.canView(session.userId, channelId))) {
    throw Object.assign(new Error('권한이 없습니다.'), { status: 403 });
  }

  const direct = await backend.reactionUsers(channelId, messageId, key);
  const proxied = reactorsOf(channelId, messageId, key).map((id) => {
    const info = db.authorInfo[id];
    return { id, displayName: info?.displayName || '어떤 사람', avatar: info?.avatar || null, viaFuse: true };
  });

  // 같은 사람이 양쪽에 들어갈 수 있다 (디스코드에서도 누르고 Fuse 에서도 누른 경우)
  const seen = new Set();
  const out = [];
  for (const u of [...proxied, ...direct]) {
    if (!u?.id || seen.has(u.id)) continue;
    seen.add(u.id);
    out.push({ id: u.id, displayName: u.displayName, avatar: u.avatar || null, me: u.id === session.userId });
  }
  return out;
}

/* ============================== 북마크 ============================== */

/*
 * 나중에 다시 볼 글.
 *
 * 좋아요와 달리 남에게 보이지 않고 디스코드로도 나가지 않는다.
 * 그래서 리액션이 아니라 Fuse 안에만 둔다 — 조용히 담아두는 게 요점이다.
 */
export async function bookmark(session, channelId, messageId) {
  if (!(await backend.canView(session.userId, channelId))) {
    throw Object.assign(new Error('권한이 없습니다.'), { status: 403 });
  }
  const post = await backend.getMessage(channelId, messageId);
  if (!post) throw Object.assign(new Error('글을 찾을 수 없습니다.'), { status: 404 });
  return toggleBookmark(session.userId, channelId, messageId);
}

export async function bookmarks(session, { limit = 50 } = {}) {
  const saved = bookmarksOf(session.userId);
  const posts = [];

  for (const b of saved.slice(0, limit)) {
    /*
     * 못 여는 것은 건너뛰기만 하고 지우지는 않는다.
     *
     * 글이 진짜 지워진 것인지, 잠깐 네트워크가 끊긴 것인지,
     * 권한을 잠시 잃은 것인지 여기서는 구분할 수 없다.
     * 담아둔 것을 대신 지워주는 쪽이 훨씬 나쁘다.
     */
    if (!(await backend.canView(session.userId, b.channelId))) continue;
    const post = await backend.getMessage(b.channelId, b.messageId);
    if (!post) continue;
    posts.push({ ...hydrate(post, session.userId), bookmarkedAt: b.at });
  }

  return { posts };
}

/* ============================== 검색 ============================== */

export async function search(session, query, { limit = 30 } = {}) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return { posts: [], users: [], guilds: [], channels: [] };

  const guilds = await backend.guildsFor(session.userId);
  const channelIds = [];
  const channelHits = [];
  for (const g of guilds) {
    const channels = await backend.visibleChannels(session.userId, g.id);
    for (const c of channels) {
      channelIds.push(c.id);
      if (c.name.toLowerCase().includes(q)) channelHits.push({ ...c, guildName: g.name, guildIcon: g.icon });
    }
  }
  await Promise.all(channelIds.slice(0, 20).map((id) => backend.ensureMessages(id)));

  const posts = store
    .merge(channelIds, { filter: (p) => (p.content || '').toLowerCase().includes(q) })
    .slice(0, limit);

  const seen = new Map();
  for (const p of store.merge(channelIds)) {
    const a = p.author;
    if (!a || seen.has(a.id)) continue;
    if (a.displayName?.toLowerCase().includes(q) || a.username?.toLowerCase().includes(q)) seen.set(a.id, a);
  }

  return {
    posts: present(posts, session.userId, replyCounts(channelIds)),
    users: [...seen.values()].slice(0, 10),
    guilds: guilds.filter((g) => g.name.toLowerCase().includes(q)),
    channels: channelHits.slice(0, 10),
  };
}

/* ============================== 프로필 ============================== */

export async function profile(session, targetId) {
  const guilds = await backend.guildsFor(session.userId);
  const channelIds = [];
  const shared = [];
  for (const g of guilds) {
    const channels = await backend.visibleChannels(session.userId, g.id);
    channelIds.push(...channels.map((c) => c.id));
    const member = await backend.memberProfile(g.id, targetId);
    if (member) shared.push({ guild: g, roles: member.roles || [] });
  }
  await Promise.all(channelIds.slice(0, 25).map((id) => backend.ensureMessages(id)));

  let user = shared[0]
    ? await backend.memberProfile(shared[0].guild.id, targetId)
    : await backend.fetchUser(targetId);
  if (!user) {
    const anyPost = store.merge(channelIds, { filter: (p) => p.author?.id === targetId })[0];
    user = anyPost?.author || null;
  }
  if (!user) throw Object.assign(new Error('사용자를 찾을 수 없습니다.'), { status: 404 });

  const posts = store
    .merge(channelIds, { filter: (p) => p.author?.id === targetId })
    .slice(0, 40);

  const likeTotal = posts.reduce((sum, p) => sum + (hydrate(p, session.userId).likeCount || 0), 0);

  return {
    user,
    bio: db.profiles[targetId]?.bio || null,
    shared: shared.map((s) => ({ ...s.guild, roles: s.roles })),
    posts: present(posts, session.userId, replyCounts(channelIds)),
    stats: { posts: posts.length, likes: likeTotal, guilds: shared.length },
    isMe: targetId === session.userId,
  };
}

export function updateProfile(session, { bio }) {
  const next = { ...(db.profiles[session.userId] || {}) };
  if (typeof bio === 'string') next.bio = bio.slice(0, 200);
  db.profiles[session.userId] = next;
  save();
  return next;
}

/* ============================== 서버 ============================== */

export async function guildDetail(session, guildId) {
  const guilds = await backend.guildsFor(session.userId);
  const guild = guilds.find((g) => g.id === guildId);
  if (!guild) throw Object.assign(new Error('서버를 찾을 수 없거나 접근할 수 없습니다.'), { status: 404 });
  const [channels, members] = await Promise.all([
    backend.visibleChannels(session.userId, guildId),
    backend.members(guildId, { limit: 60 }),
  ]);
  return { guild, channels, members };
}

/** 봇은 들어가 있지만 이 유저는 아직 가입하지 않은 서버 */
export async function discover(session) {
  return backend.discover(session.userId);
}

export async function joinGuild(session, guildId) {
  if (!session.accessToken && !isDemo()) {
    throw Object.assign(new Error('다시 로그인한 뒤 시도해 주세요.'), { status: 401 });
  }
  const result = await backend.joinGuild(guildId, session.userId, session.accessToken);
  return result;
}

export function togglePin(session, guildId) {
  const list = db.follows[session.userId] ? [...db.follows[session.userId]] : [];
  const i = list.indexOf(guildId);
  const pinned = i < 0;
  if (pinned) list.push(guildId);
  else list.splice(i, 1);
  db.follows[session.userId] = list;
  save();
  return { pinned };
}

/* ============================== 알림 ============================== */

export function activity(session) {
  return { items: activityFor(session.userId), unread: unreadCount(session.userId) };
}

export function readActivity(session) {
  markActivityRead(session.userId);
  return { unread: 0 };
}

/* ============================== 설정 ============================== */

export function getSettings(session) { return settingsFor(session.userId); }

export function patchSettings(session, patch) {
  const next = updateSettings(session.userId, patch);
  realtime.toUsers([session.userId], 'settings', next);
  return next;
}

/* =============================== 쪽지 =============================== */

const convId = (a, b) => [a, b].sort().join('--');

function normalizeDmAttachment(a) {
  return {
    name: a.name,
    url: a.url,
    proxyUrl: a.proxyURL || null,
    contentType: a.contentType || null,
    width: a.width || null,
    height: a.height || null,
    size: a.size || 0,
    isImage: !!a.contentType?.startsWith('image/'),
    isVideo: !!a.contentType?.startsWith('video/'),
  };
}

export async function listConversations(session) {
  const mine = Object.values(db.dms).filter((c) => c.members.includes(session.userId));
  const out = [];
  for (const c of mine) {
    const otherId = c.members.find((m) => m !== session.userId);
    const other = (await backend.fetchUser(otherId)) || { id: otherId, displayName: '알 수 없음', avatar: null };
    const last = c.messages[c.messages.length - 1] || null;
    out.push({
      id: c.id,
      user: other,
      last: last ? { content: last.content, at: last.at, mine: last.from === session.userId } : null,
      unread: c.messages.filter((m) => m.from !== session.userId && !m.read).length,
      updatedAt: c.updatedAt,
    });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getConversation(session, otherId) {
  const cid = convId(session.userId, otherId);
  const conv = db.dms[cid];
  const other = (await backend.fetchUser(otherId)) || { id: otherId, displayName: '알 수 없음', avatar: null };
  if (conv) {
    // 상대가 보낸 메시지를 읽음 처리
    let changed = false;
    conv.messages = conv.messages.map((m) => {
      if (m.from !== session.userId && !m.read) { changed = true; return { ...m, read: true }; }
      return m;
    });
    if (changed) { db.dms = { ...db.dms, [cid]: conv }; save(); }
  }
  return { id: cid, user: other, messages: conv?.messages || [] };
}

export async function sendDM(session, otherId, content, files = []) {
  const text = (content || '').replace(/\r\n?/g, '\n').trim();
  if (!text && !files.length) throw Object.assign(new Error('내용을 입력해 주세요.'), { status: 400 });
  if (otherId === session.userId) throw Object.assign(new Error('자기 자신에게는 보낼 수 없습니다.'), { status: 400 });

  const cid = convId(session.userId, otherId);
  const conv = db.dms[cid] || { id: cid, members: [session.userId, otherId], messages: [], updatedAt: 0 };
  const at = Date.now();

  // 첨부는 디스코드 DM으로 먼저 올린다. 디스코드 CDN 주소를 그대로 쓰면
  // 파일을 우리가 따로 보관하지 않아도 양쪽에서 같은 것을 본다.
  const sent = await backend.dmUser(otherId, {
    content: text || undefined,
    files: files.map((f) => ({ attachment: f.buffer, name: f.name })),
  });

  const attachments = sent
    ? [...(sent.attachments?.values() || [])].map(normalizeDmAttachment)
    : files.map((f) => ({
        name: f.name,
        url: null,
        contentType: f.mimetype || null,
        size: f.size || 0,
        isImage: !!f.mimetype?.startsWith('image/'),
        isVideo: !!f.mimetype?.startsWith('video/'),
        pending: true,
      }));

  const entry = {
    id: sent?.id || at.toString(36) + Math.random().toString(36).slice(2, 6),
    from: session.userId,
    content: text.slice(0, 1800),
    attachments,
    at,
    read: false,
    viaDiscord: false,
  };
  conv.messages = [...conv.messages, entry].slice(-500);
  conv.updatedAt = entry.at;
  db.dms = { ...db.dms, [cid]: conv };
  save();

  realtime.toUsers([otherId, session.userId], 'dm', { conversationId: cid, message: entry, from: session.user });

  // 상대가 디스코드에서 답장하면 이 대화로 되돌리기 위해 연결해 둔다
  if (sent?.id) {
    db.bridge = { ...db.bridge, [sent.id]: cid };
    save();
  }

  const note = pushActivity(otherId, {
    kind: 'dm', actor: session.user, targetId: session.userId,
    excerpt: entry.content.slice(0, 140) || (attachments.length ? '사진 ' + attachments.length + '장' : ''),
  });
  realtime.toUsers([otherId], 'activity', note);

  return entry;
}

/** 사용자가 디스코드 앱에서 봇 DM에 답장하면 Fuse 대화로 되돌린다 */
async function handleIncomingDiscordDM(msg) {
  if (msg.author?.bot) return;
  const refId = msg.reference?.messageId;
  let cid = refId ? db.bridge[refId] : null;

  if (!cid) {
    // 답장이 아니면 가장 최근 대화로 보낸다
    const mine = Object.values(db.dms)
      .filter((c) => c.members.includes(msg.author.id))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    cid = mine[0]?.id || null;
  }
  if (!cid || !db.dms[cid]) return;

  const conv = db.dms[cid];
  const entry = {
    id: msg.id,
    from: msg.author.id,
    content: (msg.content || '').slice(0, 1800),
    attachments: [...(msg.attachments?.values() || [])].map(normalizeDmAttachment),
    at: msg.createdTimestamp,
    read: false,
    viaDiscord: true,
  };
  conv.messages = [...conv.messages, entry].slice(-500);
  conv.updatedAt = entry.at;
  db.dms = { ...db.dms, [cid]: conv };
  save();

  realtime.toUsers(conv.members, 'dm', { conversationId: cid, message: entry });
  const otherId = conv.members.find((m) => m !== msg.author.id);
  if (otherId) {
    const note = pushActivity(otherId, {
      kind: 'dm',
      actor: { id: msg.author.id, displayName: msg.author.globalName || msg.author.username, avatar: msg.author.displayAvatarURL?.({ size: 128 }) || null },
      targetId: msg.author.id,
      excerpt: entry.content.slice(0, 140),
    });
    realtime.toUsers([otherId], 'activity', note);
  }
}

/* ============================== 기타 ============================== */

export async function typing(session, channelId) {
  if (!(await backend.canView(session.userId, channelId))) return;
  realtime.toChannel(channelId, 'typing', {
    channelId,
    user: { id: session.userId, displayName: session.user.displayName },
  });
  backend.typing(channelId);
}

export async function members(session, guildId, query) {
  return backend.members(guildId, { limit: 60, query });
}
