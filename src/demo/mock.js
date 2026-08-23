/**
 * 데모 백엔드.
 * 디스코드 봇 토큰 없이도 Fuse 전체를 그대로 굴리기 위한 목 구현.
 * src/discord/bot.js 의 `backend` 와 완전히 같은 인터페이스를 노출한다.
 */
import { store, dateToSnowflake } from '../store.js';
import { db, save } from '../db.js';
import { imageSize } from './imageSize.js';
import { HEART } from '../hydrate.js';

const now = Date.now();
const MIN = 60_000;

let seq = 0;
function id(atMs) {
  seq += 1;
  return String(BigInt(dateToSnowflake(atMs)) + BigInt(seq));
}

const avatar = (uid) => '/demo/avatar/' + uid + '.svg';

/* ------------------------------- 유저 ------------------------------- */

const rawUsers = [
  ['100', 'aiden', '에이든', '#f0913a'],
  ['101', 'sohee', '소희', '#5b8def'],
  ['102', 'minjun', '민준', '#57c98a'],
  ['103', 'yuna', '유나', '#c96fd8'],
  ['104', 'doyun', '도윤', '#e05c6e'],
  ['105', 'seoa', '서아', '#3fb9c4'],
  ['106', 'jiho', '지호', '#d8a13f'],
  ['107', 'haeun', '하은', '#8b7ff0'],
  ['108', 'taemin', '태민', '#5aa469'],
  ['109', 'nari', '나리', '#e0708f'],
];

export const users = new Map(
  rawUsers.map(([uid, username, displayName, accent]) => [uid, {
    id: uid,
    username,
    displayName,
    avatar: avatar(uid),
    banner: null,
    bot: false,
    accent,
    roles: [],
  }]),
);

/** 데모에서 로그인되는 사용자 */
export const DEMO_USER = users.get('100');

const botUserObj = {
  id: '1', username: 'fuse', displayName: 'Fuse', avatar: avatar('1'),
  bot: true, accent: null, roles: [], banner: null,
};

/* ------------------------------- 길드 ------------------------------- */

const guildDefs = [
  {
    id: 'g1', name: 'RIFT 마인크래프트', accent: '#7a5cff',
    description: '약탈 야생 + 7vs7 구단 리그 서버',
    memberCount: 1284,
    channels: [
      ['c11', '공지', 'announcement'],
      ['c12', '잡담', 'text'],
      ['c13', '건축-자랑', 'text'],
      ['c14', '질문-답변', 'text'],
      ['c15', '리그-중계', 'text'],
      ['c16', '음성-대기실', 'voice'],
    ],
  },
  {
    id: 'g2', name: '프론트엔드 스터디', accent: '#3fb9c4',
    description: '매주 화요일 저녁 발표',
    memberCount: 312,
    channels: [
      ['c21', '공지사항', 'announcement'],
      ['c22', '자유게시판', 'text'],
      ['c23', '코드-리뷰', 'text'],
      ['c24', '자료-공유', 'text'],
    ],
  },
  {
    id: 'g3', name: 'Fuse 개발실', accent: '#f0913a',
    description: 'Fuse 앱을 만드는 사람들',
    memberCount: 47,
    channels: [
      ['c31', '개발-일지', 'text'],
      ['c32', '버그-제보', 'text'],
      ['c33', '디자인', 'text'],
    ],
  },
];

export const guilds = new Map();
export const channels = new Map();

for (const g of guildDefs) {
  guilds.set(g.id, {
    id: g.id,
    name: g.name,
    icon: '/demo/guild/' + g.id + '.svg',
    banner: null,
    description: g.description,
    memberCount: g.memberCount,
    botPresent: true,
    accent: g.accent,
  });
  let pos = 0;
  for (const [cid, name, kind] of g.channels) {
    channels.set(cid, {
      id: cid,
      guildId: g.id,
      name,
      type: kind === 'announcement' ? 5 : kind === 'voice' ? 2 : 0,
      kind,
      topic: null,
      nsfw: false,
      parentId: null,
      parentName: null,
      position: pos++,
      archived: false,
    });
  }
}

/** 아직 가입하지 않은, 탐색 탭에서 보이는 서버 */
export const discoverable = [
  { id: 'g4', name: '인디게임 개발 모임', icon: '/demo/guild/g4.svg', description: '유니티·고도 잡담과 쇼케이스', memberCount: 892, botPresent: true, accent: '#57c98a' },
  { id: 'g5', name: '사진 찍는 사람들', icon: '/demo/guild/g5.svg', description: '주간 사진 챌린지', memberCount: 2140, botPresent: true, accent: '#c96fd8' },
];

/* 데모 사용자가 가입한 서버 (joinGuild 로 늘어난다) */
const joined = new Set(['g1', 'g2', 'g3']);

/* ------------------------------ 시드 글 ------------------------------ */

const seed = [
  ['c11', '101', -2880, '이번 주말 리그 8강 대진표 나왔습니다. 토요일 오후 8시부터 순차 진행하니 각 구단 대표는 30분 전까지 대기실로 모여주세요.', ['👍', '🔥']],
  ['c12', '102', -2600, '어제 야생에서 다이아 32개 캤는데 집 가는 길에 용암 밟았습니다. 인생이 참 짧네요.', ['😭', '💀']],
  ['c13', '103', -2400, '3주 걸린 해상 도시 드디어 완성했어요. 조명은 전부 수동으로 배치했습니다.', ['😍', '👏', '🔥']],
  ['c12', '104', -2100, '누가 우리 창고에서 철 가져갔는지 아는 사람? 로그 보니까 새벽 3시쯤인데', []],
  ['c14', '105', -1900, '레드스톤 비교기 두 개로 클럭 만드는 거 원리가 이해가 안 갑니다. 신호 세기가 왜 감소하는 거죠?', ['🤔']],
  ['c11', '101', -1700, '서버 점검 안내: 오늘 새벽 4시부터 30분간 백업 작업이 있습니다. 그 시간대 접속은 피해주세요.', ['✅']],
  ['c15', '106', -1500, '1구단 대 3구단 경기 지금 시작합니다. 관전은 스펙테이터 모드로 들어와주세요.', ['⚔️']],
  ['c13', '107', -1200, '자작 픽셀아트인데 뭐로 보이시나요. 힌트는 동물입니다.', ['🐰', '❓']],

  ['c21', '108', -2700, '이번 주 발표 주제는 브라우저 렌더링 파이프라인입니다. 자료는 화요일 전까지 자료-공유 채널에 올려주세요.', ['👍']],
  ['c22', '109', -2300, 'CSS의 subgrid 요즘 실무에서 쓰시는 분 계신가요? 지원 범위가 이제 괜찮아진 것 같은데', ['🤔', '👀']],
  ['c23', '102', -2000, '이 코드에서 useEffect 의존성 배열에 함수를 넣으면 매 렌더마다 도는데, useCallback으로 감싸는 게 맞을까요 아니면 구조를 바꿔야 할까요.', []],
  ['c24', '105', -1800, 'View Transition API 정리한 글 공유합니다. 실제로 붙여보니 SPA에서 체감이 꽤 큽니다.', ['🔖', '👍']],
  ['c22', '103', -1400, '타입스크립트 5.x 데코레이터 정식 문법으로 넘어가신 분? 마이그레이션 난이도가 궁금합니다.', []],
  ['c23', '104', -1000, '리뷰 반영했습니다. 렌더 함수 쪼개고 메모이제이션 걷어냈어요.', ['✅', '👏']],

  ['c31', '100', -2200, 'Fuse 첫 커밋. 디스코드 계정으로 로그인하면 스레드처럼 생긴 타임라인이 뜨는 앱을 만들어봅니다.', ['🚀', '🔥', '👏']],
  ['c31', '100', -1600, '권한 계산 붙였습니다. 유저가 디스코드에서 못 보는 채널은 Fuse 피드에도 절대 안 뜨게 했어요. 이게 제일 중요한 부분.', ['👍', '🔒']],
  ['c32', '106', -1300, '모바일에서 컴포저 열면 하단 탭이 키보드에 가려집니다. 아이폰 사파리에서 재현돼요.', ['🐛']],
  ['c33', '107', -900, '로고 시안 정리했습니다. F 아래로 지나가는 선을 살짝 더 두껍게 갔어요.', ['😍', '👀']],
  ['c31', '100', -600, '답글을 디스코드 스레드에 매핑했습니다. Fuse에서 단 답글이 디스코드 앱에서도 스레드로 그대로 보입니다.', ['🤯', '👏']],
  ['c32', '109', -420, '이미지 여러 장 올리면 두 번째부터 비율이 깨지는 것 같아요. 세로 사진일 때 특히요.', ['🐛']],
  ['c12', '108', -300, '오늘 저녁에 같이 네더 요새 털 사람 구합니다. 인원 3명이요.', ['🙋']],
  ['c22', '101', -180, '면접 준비하면서 이벤트 루프 다시 봤는데 매크로태스크/마이크로태스크 순서 헷갈리는 분들 많더라고요.', ['👍']],
  ['c33', '103', -90, '다크모드 대비 확인했습니다. 본문 대비비 7:1 넘게 나옵니다.', ['✅']],
  ['c31', '105', -35, '방금 실시간 반영 테스트했는데 다른 탭에서 바로 뜨네요. 좋습니다.', ['⚡']],
];

/** 답글: [부모 채널(확인용), 부모 인덱스, 작성자, 분오프셋, 내용] */
const seedReplies = [
  ['c13', 2, '101', -2350, '와 이거 서버에 그대로 있는 거죠? 좌표 좀 알려주세요'],
  ['c13', 2, '104', -2340, '조명 수동 배치가 제일 고생이었을 것 같은데 대단합니다'],
  ['c13', 2, '103', -2300, '네 스폰에서 남쪽으로 800칸이요. 배 타고 오시면 됩니다'],
  ['c14', 4, '102', -1880, '비교기는 신호를 유지하고 중계기가 감쇠를 리셋합니다. 클럭은 보통 중계기 지연으로 만들어요'],
  ['c14', 4, '105', -1850, '아 중계기를 거쳐야 하는군요. 해결됐습니다 감사합니다'],
  ['c23', 10, '108', -1950, '함수를 컴포넌트 밖으로 빼서 의존성 자체를 없애는 게 제일 깔끔합니다'],
  ['c23', 10, '105', -1930, '저도 동의합니다. useCallback은 마지막 수단이에요'],
  ['c31', 14, '107', -2150, '디자인은 스레드 그대로 가는 건가요?'],
  ['c31', 14, '100', -2100, '네 레이아웃과 인터랙션은 최대한 똑같이 가고, 아이콘만 Font Awesome으로 씁니다'],
  ['c31', 18, '106', -560, '디스코드 쪽에서도 스레드로 보인다는 게 핵심이네요. 양방향이 되니까'],
  ['c32', 19, '100', -400, '재현했습니다. 세로 사진 aspect-ratio 처리 빠져 있었네요. 고치겠습니다'],
];

const threadsByParent = new Map(); // `${channelId}:${messageId}` -> threadId

/**
 * 실제 모드에서는 discord.js 가 채워주는 멘션 정보를 데모에서도 똑같이 만든다.
 * 이게 없으면 멘션 알림이 오지 않는다.
 */
function parseMentions(content) {
  const out = { users: {}, roles: {}, channels: {}, everyone: false };
  if (!content) return out;

  for (const m of content.matchAll(/<@!?(\d+)>/g)) {
    const user = users.get(m[1]);
    if (user) out.users[m[1]] = { name: user.displayName };
  }
  for (const m of content.matchAll(/<#([\w-]+)>/g)) {
    const ch = channels.get(m[1]);
    if (ch) out.channels[m[1]] = { name: ch.name };
  }
  out.everyone = /@(everyone|here)\b/.test(content);
  return out;
}

function makePost(channelId, authorId, atMs, content, reactionKeys = [], extra = {}) {
  const ch = channels.get(channelId);
  const guild = guilds.get(ch.guildId);
  const author = users.get(authorId);
  return {
    id: extra.id || id(atMs),
    channelId,
    guildId: ch.guildId,
    author: { ...author },
    viaFuse: authorId === DEMO_USER.id,
    content,
    attachments: extra.attachments || [],
    embeds: [],
    stickers: [],
    createdAt: atMs,
    editedAt: null,
    pinned: false,
    tts: false,
    type: 0,
    system: false,
    referenceId: extra.referenceId || null,
    referenceChannelId: extra.referenceChannelId || null,
    threadId: extra.threadId || null,
    threadReplyCount: 0,
    inThread: !!extra.inThread,
    reactions: reactionKeys.map((k, i) => ({
      key: k, name: k, id: null, animated: false, url: null,
      count: ((atMs + i) % 7) + 1, botReacted: false,
    })),
    mentions: parseMentions(content),
    channel: { id: ch.id, name: ch.name, type: ch.type, parentId: null },
    guild: { id: guild.id, name: guild.name, icon: guild.icon },
  };
}

const seededPosts = [];

/**
 * 데모 계정 앞으로 온 알림 몇 개.
 * 이게 없으면 알림 화면이 늘 비어 있어서 무엇을 보여주는 화면인지 알 수 없다.
 */
function seedActivity() {
  if ((db.activity[DEMO_USER.id] || []).length) return; // 이미 있으면 건드리지 않는다

  const mine = seededPosts.filter((p) => p.author.id === DEMO_USER.id);
  const notes = [
    ['like', '107', mine[0], -70],
    ['reply', '106', mine[2], -52],
    ['like', '101', mine[1], -38],
    ['mention', '103', mine[1], -21],
  ];

  const list = [];
  for (const [kind, actorId, post, offMin] of notes) {
    if (!post) continue;
    const actor = users.get(actorId);
    list.push({
      id: 'seed-' + kind + '-' + actorId,
      at: now + offMin * MIN,
      read: false,
      kind,
      actor: { id: actor.id, displayName: actor.displayName, avatar: actor.avatar },
      targetId: post.id,
      channelId: post.channelId,
      guildId: post.guildId,
      excerpt: kind === 'reply'
        ? '디스코드 쪽에서도 스레드로 보인다는 게 핵심이네요. 양방향이 되니까'
        : kind === 'mention'
          ? '@에이든 다크모드 대비비만 한 번 봐주실 수 있나요?'
          : post.content.slice(0, 140),
      guildName: post.guild.name,
      channelName: post.channel.name,
    });
  }
  db.activity[DEMO_USER.id] = list.sort((a, b) => b.at - a.at);
  save();
}

function seedAll() {
  for (const [channelId, authorId, offMin, content, reactions] of seed) {
    const post = makePost(channelId, authorId, now + offMin * MIN, content, reactions);
    store.upsert(channelId, post);
    seededPosts.push(post);
  }

  // 답글 → 부모 메시지에 스레드를 만들어 그 안에 넣는다
  for (const [expectChannel, parentIdx, authorId, offMin, content] of seedReplies) {
    const parent = seededPosts[parentIdx];
    if (!parent) continue;
    // 인덱스가 어긋나면 엉뚱한 글에 답글이 붙으므로 개발 중에 바로 잡아낸다
    if (parent.channelId !== expectChannel) {
      throw new Error('[demo] 답글 인덱스 ' + parentIdx + ' 가 ' + expectChannel + ' 이 아니라 ' + parent.channelId + ' 을 가리킵니다.');
    }
    const key = parent.channelId + ':' + parent.id;
    let threadId = threadsByParent.get(key);
    if (!threadId) {
      threadId = 't' + parent.id;
      threadsByParent.set(key, threadId);
      const parentCh = channels.get(parent.channelId);
      channels.set(threadId, {
        id: threadId,
        guildId: parent.guildId,
        name: parent.content.slice(0, 40),
        type: 11,
        kind: 'thread',
        topic: null,
        nsfw: false,
        parentId: parent.channelId,
        parentName: parentCh.name,
        position: 0,
        archived: false,
      });
      parent.threadId = threadId;
    }
    const reply = makePost(threadId, authorId, now + offMin * MIN, content, [], {
      referenceId: parent.id,
      referenceChannelId: parent.channelId,
      inThread: true,
    });
    store.upsert(threadId, reply);
    parent.threadReplyCount = store.list(threadId).length;
  }

  // 데모 하트 몇 개 — 숫자가 0만 있으면 UI 확인이 안 된다.
  // 하트는 ❤️ 리액션이므로 글의 리액션 목록에 직접 심는다.
  const likeTargets = [[0, ['101', '104', '107']], [2, ['100', '101', '102', '105', '108']], [14, ['101', '103', '106']], [18, ['100', '107']]];
  for (const [idx, likers] of likeTargets) {
    const p = seededPosts[idx];
    if (!p) continue;
    p.reactions = [...(p.reactions || []), {
      key: HEART, name: HEART, url: null, count: likers.length, botReacted: true,
    }];
    db.reactionProxy[`${p.channelId}:${p.id}:${HEART}`] = likers;
  }
  save();

  seedActivity();

  // 데모에는 더 불러올 과거가 없다 — 피드가 무한히 되감기지 않도록 표시해 둔다
  for (const cid of channels.keys()) {
    store.markFetched(cid);
    store.markReachedStart(cid);
  }
}

seedAll();

/* --------------------------- 백엔드 인터페이스 --------------------------- */

let hooks = {};
export function onEvents(handlers) { hooks = handlers; }

const visible = (channelId) => channels.has(channelId);

export const backend = {
  kind: 'demo',
  get ready() { return true; },

  botUser: () => botUserObj,

  async guildsFor() {
    return [...guilds.values()].filter((g) => joined.has(g.id));
  },

  async visibleChannels(_userId, guildId) {
    return [...channels.values()]
      .filter((c) => c.guildId === guildId && c.kind !== 'thread')
      .sort((a, b) => a.position - b.position);
  },

  async canView(_userId, channelId) {
    const ch = channels.get(channelId);
    return !!ch && joined.has(ch.guildId);
  },

  async ensureMessages(channelId) {
    return store.list(channelId);
  },

  async getMessage(channelId, messageId) {
    return store.get(channelId, messageId);
  },

  async channelInfo(channelId) {
    return channels.get(channelId) || null;
  },

  async guildInfo(guildId) {
    return guilds.get(guildId) || [...discoverable].find((g) => g.id === guildId) || null;
  },

  async canSend(_userId, channelId) {
    return visible(channelId);
  },

  async send(user, channelId, { content = '', files = [] } = {}) {
    const at = Date.now();
    const post = makePost(channelId, user.id, at, content, []);
    post.author = { ...user, roles: [] };
    post.viaFuse = true;
    post.attachments = files.map((f, i) => {
      const size = f.mimetype?.startsWith('image/') ? imageSize(f.buffer) : null;
      return {
        id: 'a' + at + i,
        url: '/demo/upload/' + at + '-' + i + '/' + encodeURIComponent(f.name),
        proxyUrl: null,
        name: f.name,
        contentType: f.mimetype || 'application/octet-stream',
        width: size?.width ?? null,
        height: size?.height ?? null,
        size: f.size || 0,
        spoiler: false,
        description: null,
        isImage: !!f.mimetype?.startsWith('image/'),
        isVideo: !!f.mimetype?.startsWith('video/'),
        isAudio: !!f.mimetype?.startsWith('audio/'),
      };
    });
    // 업로드 바이트를 메모리에 보관 (데모 전용)
    files.forEach((f, i) => uploads.set(at + '-' + i, f));
    store.upsert(channelId, post);
    db.authors[channelId + ':' + post.id] = user.id;
    save();
    return post;
  },

  /** 네이티브 답장 — 같은 채널에 원본을 참조하는 메시지를 남긴다 */
  async replyNative(user, channelId, messageId, { content = '', files = [] } = {}) {
    const parent = store.get(channelId, messageId);
    const post = await backend.send(user, channelId, { content, files });
    post.referenceId = messageId;
    post.referenceChannelId = channelId;
    if (parent) post.referenceExcerpt = (parent.content || '').slice(0, 80);
    return post;
  },

  async ensureThread(channelId, messageId, title) {
    const parent = store.get(channelId, messageId);
    if (!parent) return null;
    const ch = channels.get(channelId);
    if (ch?.kind === 'thread') return ch;
    const key = channelId + ':' + messageId;
    let threadId = threadsByParent.get(key);
    if (!threadId) {
      threadId = 't' + messageId;
      threadsByParent.set(key, threadId);
      channels.set(threadId, {
        id: threadId, guildId: parent.guildId, name: (title || '스레드').slice(0, 40),
        type: 11, kind: 'thread', topic: null, nsfw: false,
        parentId: channelId, parentName: ch?.name || null, position: 0, archived: false,
      });
      parent.threadId = threadId;
      store.markFetched(threadId);
    }
    return channels.get(threadId);
  },

  async edit(channelId, messageId, content) {
    const post = store.get(channelId, messageId);
    if (!post) return null;
    post.content = content;
    post.editedAt = Date.now();
    return post;
  },

  async remove(channelId, messageId) {
    delete db.authors[channelId + ':' + messageId];
    save();
    return store.remove(channelId, messageId);
  },

  async react(channelId, messageId, key, on) {
    const post = store.get(channelId, messageId);
    if (!post) return null;
    const list = [...post.reactions];
    const i = list.findIndex((r) => r.key === key);
    if (on) {
      if (i < 0) list.push({ key, name: key, id: null, animated: false, url: null, count: 1, botReacted: true });
      else list[i] = { ...list[i], count: list[i].count + (list[i].botReacted ? 0 : 1), botReacted: true };
    } else if (i >= 0) {
      const next = { ...list[i], count: Math.max(list[i].count - 1, 0), botReacted: false };
      if (next.count <= 0) list.splice(i, 1);
      else list[i] = next;
    }
    post.reactions = list;
    return post;
  },

  async reactionUsers(channelId, messageId, key) {
    const post = store.get(channelId, messageId);
    const found = post?.reactions?.find((r) => r.key === key);
    if (!found || found.botReacted) return [];   // 데모의 리액션은 전부 봇 명의다
    return [];
  },

  async typing() { /* 데모에서는 무의미 */ },

  async members(guildId, { limit = 100, query = '' } = {}) {
    const q = query.trim().toLowerCase();
    return [...users.values()]
      .filter((u) => !q || u.displayName.toLowerCase().includes(q) || u.username.includes(q))
      .slice(0, limit);
  },

  async memberProfile(_guildId, userId) {
    return users.get(userId) || null;
  },

  async fetchUser(userId) {
    return users.get(userId) || (userId === botUserObj.id ? botUserObj : null);
  },

  async joinGuild(guildId) {
    const found = discoverable.find((g) => g.id === guildId);
    if (found && !guilds.has(guildId)) {
      guilds.set(guildId, { ...found });
      // 새로 가입한 서버에도 채널과 글이 있어야 자연스럽다
      const cid = guildId + '-general';
      channels.set(cid, {
        id: cid, guildId, name: '일반', type: 0, kind: 'text', topic: null,
        nsfw: false, parentId: null, parentName: null, position: 0, archived: false,
      });
      store.upsert(cid, makePost(cid, '105', Date.now() - 5 * MIN, found.name + ' 에 오신 걸 환영합니다. 자유롭게 인사 남겨주세요.', ['👋']));
      store.markFetched(cid);
    }
    const already = joined.has(guildId);
    joined.add(guildId);
    return { joined: !already, already };
  },

  /**
   * 데모에는 진짜 디스코드 DM이 없다.
   * 첨부만은 실제로 저장해서 화면에서 사진이 보이도록 흉내만 낸다.
   */
  async dmUser(_userId, payload = {}) {
    const files = payload.files || [];
    if (!files.length) return null;
    const at = Date.now();
    const attachments = new Map();
    files.forEach((f, i) => {
      const key = 'dm' + at + '-' + i;
      uploads.set(key, { buffer: f.attachment, mimetype: guessType(f.name), name: f.name });
      attachments.set(key, {
        name: f.name,
        url: '/demo/upload/' + key + '/' + encodeURIComponent(f.name),
        proxyURL: null,
        contentType: guessType(f.name),
        width: null,
        height: null,
        size: f.attachment?.length || 0,
      });
    });
    return { id: 'dm-' + at, attachments };
  },

  async discover() {
    return discoverable.filter((g) => !joined.has(g.id));
  },
};

/** 데모에서 업로드한 파일 바이트 (메모리) */
export const uploads = new Map();

const TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm',
  mp3: 'audio/mpeg', pdf: 'application/pdf', txt: 'text/plain', zip: 'application/zip',
};
const guessType = (name) => TYPES[String(name).split('.').pop()?.toLowerCase()] || 'application/octet-stream';

/* ------------------------- 가짜 실시간 이벤트 ------------------------- */

const chatter = [
  ['c12', '104', '지금 서버 인원 40명 넘었네요'],
  ['c22', '109', '이 패턴 이름이 뭐죠? 어디서 본 것 같은데'],
  ['c31', '107', '방금 배포된 버전에서 애니메이션 훨씬 부드러워졌어요'],
  ['c13', '106', '네더 포탈 좌표 정리해서 올렸습니다'],
  ['c23', '102', '리뷰 하나만 더 봐주실 수 있나요'],
  ['c32', '108', '알림 뱃지 숫자가 읽고 나서도 남아있는 것 같아요'],
];
let chatterIdx = 0;

export function startFakeGateway() {
  const timer = setInterval(() => {
    const [channelId, authorId, content] = chatter[chatterIdx % chatter.length];
    chatterIdx += 1;
    const post = makePost(channelId, authorId, Date.now(), content, []);
    store.upsert(channelId, post);
    hooks.postCreated?.(post);
  }, 45_000);
  timer.unref();
  return timer;
}
