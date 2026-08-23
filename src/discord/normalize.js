import { ChannelType, MessageType } from 'discord.js';
import { db } from '../db.js';
import { THREAD_TYPES } from './permissions.js';

const CDN = 'https://cdn.discordapp.com';

export function emojiKey(emoji) {
  return emoji.id ? `${emoji.name}:${emoji.id}` : emoji.name;
}

export function emojiUrl(emoji) {
  return emoji.id ? `${CDN}/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}?size=44` : null;
}

export function normalizeUser(user, member = null) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: member?.displayName || user.globalName || user.displayName || user.username,
    avatar: typeof user.displayAvatarURL === 'function'
      ? user.displayAvatarURL({ size: 128, extension: 'png' })
      : user.avatar || null,
    banner: typeof user.bannerURL === 'function' ? user.bannerURL({ size: 512 }) || null : null,
    bot: !!user.bot,
    accent: member?.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : null,
    roles: member ? member.roles.cache.filter((r) => r.name !== '@everyone').map((r) => ({
      id: r.id, name: r.name, color: r.hexColor === '#000000' ? null : r.hexColor,
    })) : [],
  };
}

export function normalizeGuild(guild, { botPresent = true } = {}) {
  return {
    id: guild.id,
    name: guild.name,
    icon: typeof guild.iconURL === 'function' ? guild.iconURL({ size: 128 }) : guild.icon || null,
    banner: typeof guild.bannerURL === 'function' ? guild.bannerURL({ size: 512 }) || null : null,
    description: guild.description || null,
    memberCount: guild.memberCount ?? null,
    botPresent,
  };
}

export function normalizeChannel(channel) {
  const isThread = THREAD_TYPES.has(channel.type);
  return {
    id: channel.id,
    guildId: channel.guildId || channel.guild?.id || null,
    name: channel.name,
    type: channel.type,
    kind: isThread ? 'thread'
      : channel.type === ChannelType.GuildForum || channel.type === ChannelType.GuildMedia ? 'forum'
      : channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice ? 'voice'
      : channel.type === ChannelType.GuildAnnouncement ? 'announcement'
      : 'text',
    topic: channel.topic || null,
    nsfw: !!channel.nsfw,
    parentId: channel.parentId || null,
    parentName: channel.parent?.name || null,
    position: channel.rawPosition ?? channel.position ?? 0,
    archived: isThread ? !!channel.archived : false,
  };
}

function normalizeAttachment(a) {
  return {
    id: a.id,
    url: a.url,
    proxyUrl: a.proxyURL,
    name: a.name,
    contentType: a.contentType || null,
    width: a.width || null,
    height: a.height || null,
    size: a.size || 0,
    spoiler: !!a.spoiler,
    description: a.description || null,
    isImage: !!a.contentType?.startsWith('image/'),
    isVideo: !!a.contentType?.startsWith('video/'),
    isAudio: !!a.contentType?.startsWith('audio/'),
  };
}

function normalizeEmbed(e) {
  const d = typeof e.toJSON === 'function' ? e.toJSON() : e;
  return {
    type: d.type || 'rich',
    title: d.title || null,
    description: d.description || null,
    url: d.url || null,
    color: typeof d.color === 'number' ? `#${d.color.toString(16).padStart(6, '0')}` : null,
    timestamp: d.timestamp || null,
    author: d.author ? { name: d.author.name, url: d.author.url || null, icon: d.author.icon_url || d.author.iconURL || null } : null,
    footer: d.footer ? { text: d.footer.text, icon: d.footer.icon_url || d.footer.iconURL || null } : null,
    image: d.image ? { url: d.image.url, width: d.image.width || null, height: d.image.height || null } : null,
    thumbnail: d.thumbnail ? { url: d.thumbnail.url, width: d.thumbnail.width || null, height: d.thumbnail.height || null } : null,
    video: d.video ? { url: d.video.url, width: d.video.width || null, height: d.video.height || null } : null,
    provider: d.provider ? { name: d.provider.name || null, url: d.provider.url || null } : null,
    fields: (d.fields || []).map((f) => ({ name: f.name, value: f.value, inline: !!f.inline })),
  };
}

const SYSTEM_TYPES = new Set([
  MessageType.UserJoin, MessageType.GuildBoost, MessageType.GuildBoostTier1,
  MessageType.GuildBoostTier2, MessageType.GuildBoostTier3, MessageType.ChannelPinnedMessage,
  MessageType.ThreadCreated, MessageType.ChannelFollowAdd, MessageType.GuildDiscoveryDisqualified,
  MessageType.GuildDiscoveryRequalified, MessageType.RecipientAdd, MessageType.RecipientRemove,
  MessageType.Call, MessageType.ChannelNameChange, MessageType.ChannelIconChange,
]);

/** discord.js Message → Fuse Post DTO (뷰어 무관 필드만; 나머지는 hydrate에서 채운다) */
export function normalizeMessage(msg) {
  const channel = msg.channel;
  const guild = msg.guild;
  const key = `${msg.channelId}:${msg.id}`;
  const realAuthorId = db.authors?.[key] || null;

  const author = normalizeUser(msg.author, msg.member);
  const viaFuse = !!realAuthorId;

  if (viaFuse) {
    author.id = realAuthorId;
    // 웹훅으로 나간 글은 이미 그 사람의 이름·프사를 달고 있다.
    // 봇 명의로 나간 글(네이티브 답장)은 봇 정보가 붙어 있으므로 실제 작성자로 바꿔준다.
    if (!msg.webhookId) {
      const member = msg.guild?.members?.cache?.get(realAuthorId);
      const snapshot = db.authorInfo?.[realAuthorId];
      if (member) {
        author.displayName = member.displayName;
        author.avatar = member.user.displayAvatarURL({ size: 128, extension: 'png' });
        author.username = member.user.username;
      } else if (snapshot) {
        author.displayName = snapshot.displayName;
        author.avatar = snapshot.avatar;
      }
      author.bot = false;
    }
  }
  if (msg.webhookId && !viaFuse) author.webhook = true;

  const reactions = [...(msg.reactions?.cache?.values() || [])].map((r) => ({
    key: emojiKey(r.emoji),
    name: r.emoji.name,
    id: r.emoji.id || null,
    animated: !!r.emoji.animated,
    url: emojiUrl(r.emoji),
    count: r.count,
    botReacted: !!r.me,
  }));

  const thread = msg.thread || null;

  return {
    id: msg.id,
    channelId: msg.channelId,
    guildId: guild?.id || null,
    author,
    viaFuse,
    content: msg.content || '',
    attachments: [...(msg.attachments?.values() || [])].map(normalizeAttachment),
    embeds: (msg.embeds || []).map(normalizeEmbed),
    stickers: [...(msg.stickers?.values() || [])].map((s) => ({
      id: s.id, name: s.name, url: `${CDN}/stickers/${s.id}.png`,
    })),
    createdAt: msg.createdTimestamp,
    editedAt: msg.editedTimestamp || null,
    pinned: !!msg.pinned,
    tts: !!msg.tts,
    type: msg.type,
    system: SYSTEM_TYPES.has(msg.type),
    referenceId: msg.reference?.messageId || null,
    referenceChannelId: msg.reference?.channelId || null,
    threadId: thread?.id || (THREAD_TYPES.has(channel?.type) ? channel.id : null),
    threadReplyCount: thread ? (thread.totalMessageSent ?? thread.messageCount ?? 0) : 0,
    inThread: THREAD_TYPES.has(channel?.type),
    reactions,
    mentions: {
      users: Object.fromEntries([...(msg.mentions?.users?.values() || [])].map((u) => [
        u.id, { name: msg.mentions.members?.get(u.id)?.displayName || u.globalName || u.username },
      ])),
      roles: Object.fromEntries([...(msg.mentions?.roles?.values() || [])].map((r) => [
        r.id, { name: r.name, color: r.hexColor === '#000000' ? null : r.hexColor },
      ])),
      channels: Object.fromEntries([...(msg.mentions?.channels?.values() || [])].map((c) => [
        c.id, { name: c.name },
      ])),
      everyone: !!msg.mentions?.everyone,
    },
    channel: channel ? { id: channel.id, name: channel.name, type: channel.type, parentId: channel.parentId || null } : null,
    guild: guild ? { id: guild.id, name: guild.name, icon: guild.iconURL?.({ size: 64 }) || null } : null,
  };
}
