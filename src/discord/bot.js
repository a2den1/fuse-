import {
  Client, GatewayIntentBits, Partials, ChannelType, Events, AttachmentBuilder,
} from 'discord.js';
import { config } from '../config.js';
import { db, save } from '../db.js';
import { store } from '../store.js';
import { normalizeMessage, normalizeChannel, normalizeGuild, normalizeUser, emojiKey } from './normalize.js';
import {
  visibleChannels, canViewChannel, fetchMember, invalidateGuild, invalidateMember,
  THREAD_TYPES, memberCanSend, botCanCreateThread,
} from './permissions.js';
import { sendAsUser, editAsUser, deleteAsUser, invalidateWebhook } from './webhooks.js';

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,      // 특권 인텐트 — 개발자 포털에서 켜야 함
    GatewayIntentBits.GuildMembers,        // 특권 인텐트 — 멤버 목록/권한 계산
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMessageTyping,
    GatewayIntentBits.DirectMessages,      // 쪽지 브릿지
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
  allowedMentions: { parse: ['users'] },
});

let hooks = {};   // 상위 레이어가 주입하는 이벤트 콜백
export function onEvents(handlers) { hooks = handlers; }

export const state = { ready: false, error: null };

/* ------------------------------ 조회 ------------------------------ */

function guildById(id) {
  return client.guilds.cache.get(id) || null;
}

async function resolveChannel(channelId) {
  let ch = client.channels.cache.get(channelId) || null;
  if (!ch) {
    try { ch = await client.channels.fetch(channelId); } catch { ch = null; }
  }
  return ch;
}

/* ---------------------------- 백엔드 API ---------------------------- */

export const backend = {
  kind: 'discord',

  get ready() { return state.ready; },

  botUser() {
    return client.user ? normalizeUser(client.user) : null;
  },

  /*
   * 봇이 들어가 있는 길드 중, 이 유저도 멤버인 것.
   *
   * 소속 여부는 fetchMember 로 그때그때 확인한다.
   * 예전에는 로그인할 때 OAuth 로 받아둔 길드 목록으로 먼저 걸렀는데,
   * 그러면 로그인한 뒤에 새로 들어간 서버가 영영 보이지 않았다.
   * (실시간 메시지는 canView 로 따로 검사해서 도착하는 바람에,
   *  글은 뜨는데 새로고침하면 사라지는 이상한 상태가 됐다.)
   * fetchMember 는 결과를 30초 캐시하므로 매번 물어봐도 부담이 없다.
   */
  async guildsFor(userId) {
    const out = [];
    for (const guild of client.guilds.cache.values()) {
      if (config.hiddenGuildIds.includes(guild.id)) continue;
      const member = await fetchMember(guild, userId);
      if (!member) continue;
      out.push(normalizeGuild(guild, { botPresent: true }));
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  },

  /** 봇은 들어가 있는데 이 유저는 아직 멤버가 아닌 길드 (탐색 탭) */
  async discover(userId) {
    const out = [];
    for (const guild of client.guilds.cache.values()) {
      if (config.hiddenGuildIds.includes(guild.id)) continue;
      const member = await fetchMember(guild, userId);
      if (member) continue;
      out.push(normalizeGuild(guild, { botPresent: true }));
    }
    return out.sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0));
  },

  async visibleChannels(userId, guildId) {
    const guild = guildById(guildId);
    if (!guild) return [];
    const channels = await visibleChannels(guild, userId);
    return channels.map(normalizeChannel);
  },

  async canView(userId, channelId) {
    const ch = await resolveChannel(channelId);
    if (!ch || !ch.guild) return false;
    return canViewChannel(ch.guild, ch, userId);
  },

  /** 채널 메시지를 캐시에 채운다. before가 있으면 그 이전 페이지를 더 가져온다. */
  async ensureMessages(channelId, { before = null, limit = config.feed.backfillPerChannel, force = false } = {}) {
    if (!before && !force && store.isFresh(channelId)) return store.list(channelId);
    const ch = await resolveChannel(channelId);
    if (!ch?.messages) return [];
    const want = Math.min(limit, 100);
    try {
      const fetched = await ch.messages.fetch({ limit: want, ...(before ? { before } : {}) });
      const posts = [...fetched.values()].map(normalizeMessage);
      store.upsertMany(channelId, posts);
      if (!before) store.markFetched(channelId);
      if (fetched.size < want) store.markReachedStart(channelId);
      return posts;
    } catch (err) {
      // 권한이 사라졌거나 채널이 지워진 경우 — 조용히 빈 결과
      if (![10003, 50001, 50013].includes(err.code)) {
        console.warn('[bot] 메시지 조회 실패 ' + channelId + ':', err.message);
      }
      store.markFetched(channelId);
      return [];
    }
  },

  async getMessage(channelId, messageId) {
    const cached = store.get(channelId, messageId);
    if (cached) return cached;
    const ch = await resolveChannel(channelId);
    if (!ch?.messages) return null;
    try {
      const msg = await ch.messages.fetch(messageId);
      return store.upsert(channelId, normalizeMessage(msg));
    } catch {
      return null;
    }
  },

  async channelInfo(channelId) {
    const ch = await resolveChannel(channelId);
    return ch ? normalizeChannel(ch) : null;
  },

  async guildInfo(guildId) {
    const g = guildById(guildId);
    return g ? normalizeGuild(g) : null;
  },

  async canSend(userId, channelId) {
    const ch = await resolveChannel(channelId);
    if (!ch?.guild) return false;
    const member = await fetchMember(ch.guild, userId);
    if (!member) return false;
    if (!(await canViewChannel(ch.guild, ch, userId))) return false;
    return memberCanSend(ch, member);
  },

  /** 글 작성 — 사용자 명의(웹훅)로 보낸다 */
  async send(user, channelId, { content = '', files = [] } = {}) {
    const ch = await resolveChannel(channelId);
    if (!ch) throw Object.assign(new Error('채널을 찾을 수 없습니다.'), { status: 404 });

    const attachments = files.map((f) => new AttachmentBuilder(f.buffer, { name: f.name }));
    const sent = await sendAsUser(ch, user, { content, files: attachments });

    // 웹훅 메시지의 진짜 작성자를 기록해 둔다 (수정/삭제 권한과 프로필 집계에 쓰인다)
    db.authors[channelId + ':' + sent.id] = user.id;
    db.authorInfo[user.id] = { displayName: user.displayName, avatar: user.avatar };
    save();

    const full = await ch.messages.fetch(sent.id).catch(() => sent);
    return store.upsert(channelId, normalizeMessage(full));
  },

  /**
   * 디스코드 네이티브 답장.
   *
   * 웹훅 실행 API에는 message_reference 가 없어서 이 경로만은 봇 명의로 나간다.
   * 대신 화살표로 원본이 딸려 보이는, 디스코드에서 흔히 보는 그 답장이 된다.
   */
  async replyNative(user, channelId, messageId, { content = '', files = [] } = {}) {
    const ch = await resolveChannel(channelId);
    if (!ch) throw Object.assign(new Error('채널을 찾을 수 없습니다.'), { status: 404 });

    const attachments = files.map((f) => new AttachmentBuilder(f.buffer, { name: f.name }));
    const sent = await ch.send({
      content: content || undefined,
      files: attachments.length ? attachments : undefined,
      reply: { messageReference: messageId, failIfNotExists: false },
      // 답장당한 사람에게 알림이 두 번 가지 않도록 replied_user 핑은 끈다
      allowedMentions: { parse: ['users'], repliedUser: false },
    });

    // 봇이 보냈지만 실제 작성자는 이 사람이다 — Fuse 화면과 권한 판단에 쓰인다
    db.authors[channelId + ':' + sent.id] = user.id;
    db.authorInfo[user.id] = { displayName: user.displayName, avatar: user.avatar };
    save();

    return store.upsert(channelId, normalizeMessage(sent));
  },

  /**
   * 답글을 원본 메시지의 스레드 안에 남긴다 (replyMode = thread 일 때).
   */
  async ensureThread(channelId, messageId, title) {
    const ch = await resolveChannel(channelId);
    if (!ch) return null;
    if (THREAD_TYPES.has(ch.type)) return ch; // 이미 스레드 안이면 그대로

    const msg = await ch.messages.fetch(messageId).catch(() => null);
    if (!msg) return null;
    if (msg.thread) return msg.thread;
    if (!botCanCreateThread(ch, ch.guild.members.me)) return null;

    try {
      return await msg.startThread({
        name: (title || '스레드').slice(0, 90) || '스레드',
        autoArchiveDuration: 1440,
        reason: 'Fuse 답글',
      });
    } catch {
      return null;
    }
  },

  async edit(channelId, messageId, content) {
    const ch = await resolveChannel(channelId);
    if (!ch) throw Object.assign(new Error('채널을 찾을 수 없습니다.'), { status: 404 });
    await editAsUser(ch, messageId, content);
    const msg = await ch.messages.fetch(messageId).catch(() => null);
    return msg ? store.upsert(channelId, normalizeMessage(msg)) : null;
  },

  async remove(channelId, messageId) {
    const ch = await resolveChannel(channelId);
    if (!ch) return false;
    try {
      await deleteAsUser(ch, messageId);
    } catch {
      // 웹훅으로 못 지우면 봇 권한으로 시도
      const msg = await ch.messages.fetch(messageId).catch(() => null);
      if (!msg) return false;
      await msg.delete();
    }
    delete db.authors[channelId + ':' + messageId];
    save();
    store.remove(channelId, messageId);
    return true;
  },

  /** 봇이 대신 리액션을 누른다 (디스코드는 타인 명의 리액션을 허용하지 않는다) */
  async react(channelId, messageId, key, on) {
    const ch = await resolveChannel(channelId);
    if (!ch?.messages) return null;
    const msg = await ch.messages.fetch({ message: messageId, force: true }).catch(() => null);
    if (!msg) return null;

    const findOwn = () => msg.reactions.cache.find((r) => emojiKey(r.emoji) === key)
      || msg.reactions.resolve(key);

    try {
      if (on) {
        if (!findOwn()?.me) await msg.react(key);
      } else {
        const found = findOwn();
        if (found?.me) await found.users.remove(client.user.id);
      }
    } catch (err) {
      throw Object.assign(new Error('리액션을 적용하지 못했습니다.'), { status: 400, cause: err });
    }

    /*
     * 바꾼 뒤에 다시 받아오지 않는다.
     *
     * 디스코드의 리액션 숫자는 곧바로 갱신되지 않는다. 뗀 직후에 물어보면
     * me 는 false 인데 숫자는 아직 1 인 상태가 오고, 붙인 직후에 물어보면
     * 이전 조작이 아직 안 반영돼서 하나 더 많게 나오기도 한다.
     * 그 숫자로 산수를 하면 누를 때마다 조금씩 어긋난다.
     *
     * 그래서 여기서는 바꾸기 전 상태를 그대로 돌려준다. 그 자체로는 앞뒤가
     * 맞는 값이다. Fuse 유저가 누른 몫은 우리 기록에서 나오므로
     * (hydrate 참고) 화면에 나가는 숫자는 이 지연과 무관하게 정확하다.
     */
    return store.upsert(channelId, normalizeMessage(msg));
  },

  /** 이 리액션을 실제로 누른 사람들 (봇은 빼고 — 봇 자리는 Fuse 유저가 채운다) */
  async reactionUsers(channelId, messageId, key, limit = 30) {
    const ch = await resolveChannel(channelId);
    const msg = await ch?.messages?.fetch(messageId).catch(() => null);
    if (!msg) return [];
    const found = msg.reactions.cache.find((r) => emojiKey(r.emoji) === key);
    if (!found) return [];
    const users = await found.users.fetch({ limit }).catch(() => null);
    if (!users) return [];
    return [...users.values()]
      .filter((u) => u.id !== client.user?.id)
      .map((u) => normalizeUser(u));
  },

  async typing(channelId) {
    const ch = await resolveChannel(channelId);
    try { await ch?.sendTyping?.(); } catch { /* noop */ }
  },

  async members(guildId, { limit = 100, query = '' } = {}) {
    const guild = guildById(guildId);
    if (!guild) return [];
    let list;
    try {
      list = query
        ? await guild.members.search({ query, limit })
        : await guild.members.fetch({ limit, time: 10_000 }).catch(() => guild.members.cache);
    } catch {
      list = guild.members.cache;
    }
    return [...list.values()].slice(0, limit).map((m) => normalizeUser(m.user, m));
  },

  async memberProfile(guildId, userId) {
    const guild = guildById(guildId);
    if (!guild) return null;
    const member = await fetchMember(guild, userId);
    return member ? normalizeUser(member.user, member) : null;
  },

  async fetchUser(userId) {
    try {
      const u = await client.users.fetch(userId);
      return normalizeUser(u);
    } catch {
      return null;
    }
  },

  /** OAuth guilds.join — 앱 안에서 서버 가입 */
  async joinGuild(guildId, targetUserId, accessToken) {
    const res = await fetch('https://discord.com/api/v10/guilds/' + guildId + '/members/' + targetUserId, {
      method: 'PUT',
      headers: {
        Authorization: 'Bot ' + config.botToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_token: accessToken }),
    });
    if (res.status === 201) return { joined: true };
    if (res.status === 204) return { joined: false, already: true };
    const body = await res.text();
    throw Object.assign(new Error('서버 가입 실패 (' + res.status + ') ' + body), { status: res.status });
  },

  /** 봇 DM — 쪽지 브릿지 */
  async dmUser(userId, payload) {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return null;
    try {
      return await user.send(payload);
    } catch {
      return null; // DM 차단
    }
  },
};

/* ------------------------------ 이벤트 ------------------------------ */

function wire() {
  client.on(Events.ClientReady, () => {
    state.ready = true;
    console.log('[bot] ' + client.user.tag + ' 로 접속. 길드 ' + client.guilds.cache.size + '개');
    hooks.ready?.();
  });

  client.on(Events.MessageCreate, async (msg) => {
    if (!msg.guild) return hooks.directMessage?.(msg);
    const post = store.upsert(msg.channelId, normalizeMessage(msg));
    hooks.postCreated?.(post, msg);
  });

  client.on(Events.MessageUpdate, async (_old, msg) => {
    if (!msg?.guild) return;
    let full = msg;
    if (full.partial) {
      try { full = await full.fetch(); } catch { return; }
    }
    const post = store.upsert(full.channelId, normalizeMessage(full));
    hooks.postUpdated?.(post);
  });

  client.on(Events.MessageDelete, (msg) => {
    if (!msg?.channelId) return;
    store.remove(msg.channelId, msg.id);
    delete db.authors[msg.channelId + ':' + msg.id];
    save();
    hooks.postDeleted?.({ channelId: msg.channelId, id: msg.id });
  });

  client.on(Events.MessageBulkDelete, (messages) => {
    for (const msg of messages.values()) {
      store.remove(msg.channelId, msg.id);
      hooks.postDeleted?.({ channelId: msg.channelId, id: msg.id });
    }
  });

  const onReaction = async (reaction) => {
    try {
      if (reaction.partial) await reaction.fetch();
      const cached = reaction.message;
      if (!cached?.channelId) return;
      /*
       * 캐시에 있는 메시지를 그대로 쓰지 않고 다시 받아온다.
       *
       * 리액션이 떨어져 나갈 때 discord.js 가 들고 있는 사본은 me 만 false 로
       * 내리고 숫자는 그대로 두는 경우가 있다. 그걸 저장하면 아무도 누르지
       * 않았는데 1 이 붙어 있는 글이 남는다. 원본을 다시 받아오는 편이 확실하다.
       * (개인 서버 규모에서는 리액션 이벤트가 잦지 않아 부담이 되지 않는다)
       */
      const ch = await resolveChannel(cached.channelId);
      const msg = await ch?.messages?.fetch({ message: cached.id, force: true }).catch(() => null);
      if (!msg?.guild) return;
      const post = store.upsert(msg.channelId, normalizeMessage(msg));
      hooks.postUpdated?.(post);
    } catch { /* 삭제된 메시지 */ }
  };
  client.on(Events.MessageReactionAdd, onReaction);
  client.on(Events.MessageReactionRemove, onReaction);

  client.on(Events.TypingStart, (typing) => {
    if (!typing.guild) return;
    hooks.typing?.({
      channelId: typing.channel.id,
      user: { id: typing.user.id, displayName: typing.member?.displayName || typing.user.username },
    });
  });

  client.on(Events.ThreadCreate, (thread) => hooks.threadCreated?.(normalizeChannel(thread)));

  // 권한이 바뀌면 가시성 캐시를 버린다 — 안 그러면 못 보는 채널이 계속 보인다
  client.on(Events.GuildMemberUpdate, (_o, m) => invalidateMember(m.guild.id, m.id));
  client.on(Events.GuildMemberRemove, (m) => invalidateMember(m.guild.id, m.id));
  client.on(Events.GuildMemberAdd, (m) => invalidateMember(m.guild.id, m.id));
  client.on(Events.ChannelUpdate, (ch) => {
    if (ch.guildId) invalidateGuild(ch.guildId);
    invalidateWebhook(ch.id);
  });
  client.on(Events.GuildRoleUpdate, (r) => invalidateGuild(r.guild.id));
  client.on(Events.GuildRoleDelete, (r) => invalidateGuild(r.guild.id));

  client.on(Events.Error, (err) => console.error('[bot] 오류:', err.message));
  client.on(Events.Warn, (msg) => console.warn('[bot] 경고:', msg));
}

export async function start() {
  wire();
  try {
    await client.login(config.botToken);
  } catch (err) {
    state.error = err;
    if (/disallowed intents/i.test(err.message)) {
      console.error(
        '\n[bot] 특권 인텐트가 꺼져 있습니다.\n' +
        '      https://discord.com/developers/applications → 내 앱 → Bot → Privileged Gateway Intents 에서\n' +
        '      MESSAGE CONTENT INTENT 와 SERVER MEMBERS INTENT 를 켜 주세요.\n',
      );
    } else {
      console.error('[bot] 로그인 실패:', err.message);
    }
    throw err;
  }
}

export const ChannelTypes = ChannelType;
