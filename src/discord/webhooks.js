import { ChannelType } from 'discord.js';
import { THREAD_TYPES } from './permissions.js';

const cache = new Map(); // channelId -> { hook, at }
const HOOK_NAME = 'Fuse';
const TTL = 10 * 60_000;

/** 웹훅 이름/유저명에 못 쓰는 단어를 걷어낸다 (디스코드가 400을 던진다) */
export function safeName(name, fallback = 'Fuse 사용자') {
  let out = String(name || '').replace(/discord/gi, 'disc0rd').replace(/clyde/gi, 'clyd3').trim();
  out = out.replace(/[\u0000-\u001f\u007f]/g, '');
  if (out.length > 80) out = out.slice(0, 80);
  if (out.length < 1) out = fallback;
  return out;
}

/** 스레드에는 웹훅을 만들 수 없다 — 부모 채널의 웹훅에 thread_id를 붙여 보낸다 */
export function webhookHost(channel) {
  if (THREAD_TYPES.has(channel.type)) return channel.parent;
  return channel;
}

export async function webhookFor(channel) {
  const host = webhookHost(channel);
  if (!host) throw new Error('웹훅을 붙일 부모 채널을 찾지 못했습니다.');
  if (host.type === ChannelType.GuildForum || host.type === ChannelType.GuildMedia) {
    // 포럼 자체에도 웹훅을 만들 수 있다 (게시글은 thread_id로 지정)
  }

  const hit = cache.get(host.id);
  if (hit && Date.now() - hit.at < TTL) return hit.hook;

  const me = host.guild.members.me;
  if (!host.permissionsFor(me)?.has('ManageWebhooks')) {
    throw Object.assign(new Error('봇에게 이 채널의 웹훅 관리 권한이 없습니다.'), { code: 'NO_WEBHOOK_PERM' });
  }

  let hook = null;
  try {
    const hooks = await host.fetchWebhooks();
    hook = hooks.find((h) => h.owner?.id === me.id && h.name === HOOK_NAME) || null;
  } catch {
    hook = null;
  }
  if (!hook) {
    hook = await host.createWebhook({ name: HOOK_NAME, reason: 'Fuse에서 사용자 명의로 글을 보내기 위해' });
  }
  cache.set(host.id, { hook, at: Date.now() });
  return hook;
}

export function invalidateWebhook(channelId) {
  cache.delete(channelId);
}

/**
 * 사용자 명의(닉네임 + 프로필 사진)로 채널에 글을 보낸다.
 * 웹훅은 message_reference(네이티브 답장)를 지원하지 않으므로,
 * 답글은 상위 레이어에서 스레드로 처리한다.
 */
export async function sendAsUser(channel, author, { content = '', files = [], embeds = [] } = {}) {
  const hook = await webhookFor(channel);
  const isThread = THREAD_TYPES.has(channel.type);

  const sent = await hook.send({
    content: content || undefined,
    files: files.length ? files : undefined,
    embeds: embeds.length ? embeds : undefined,
    username: safeName(author.displayName || author.username),
    avatarURL: author.avatar || undefined,
    threadId: isThread ? channel.id : undefined,
    allowedMentions: { parse: ['users'] }, // @everyone/@here 대리 발송은 막는다
    withComponents: false,
  });
  return sent;
}

export async function editAsUser(channel, messageId, content) {
  const hook = await webhookFor(channel);
  const isThread = THREAD_TYPES.has(channel.type);
  return hook.editMessage(messageId, { content, threadId: isThread ? channel.id : undefined });
}

export async function deleteAsUser(channel, messageId) {
  const hook = await webhookFor(channel);
  const isThread = THREAD_TYPES.has(channel.type);
  return hook.deleteMessage(messageId, isThread ? channel.id : undefined);
}
