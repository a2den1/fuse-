import { ChannelType, PermissionFlagsBits } from 'discord.js';

/** 피드/타임라인에 올릴 수 있는(글이 존재할 수 있는) 채널 타입 */
export const FEED_CHANNEL_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildVoice,        // 음성 채널에도 텍스트 챗이 붙는다
  ChannelType.GuildStageVoice,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
  ChannelType.PublicThread,
  ChannelType.AnnouncementThread,
  ChannelType.PrivateThread,
]);

export const THREAD_TYPES = new Set([
  ChannelType.PublicThread,
  ChannelType.AnnouncementThread,
  ChannelType.PrivateThread,
]);

const VIEW = PermissionFlagsBits.ViewChannel;
const HISTORY = PermissionFlagsBits.ReadMessageHistory;
const SEND = PermissionFlagsBits.SendMessages;
const SEND_THREAD = PermissionFlagsBits.SendMessagesInThreads;
const CREATE_THREAD = PermissionFlagsBits.CreatePublicThreads;

/** guildId:userId -> { member, at } — REST 멤버 조회를 짧게 캐시 */
const memberCache = new Map();
const MEMBER_TTL = 30_000;

export async function fetchMember(guild, userId) {
  const key = `${guild.id}:${userId}`;
  const hit = memberCache.get(key);
  if (hit && Date.now() - hit.at < MEMBER_TTL) return hit.member;

  let member = null;
  try {
    member = guild.members.cache.get(userId) || (await guild.members.fetch({ user: userId, force: false }));
  } catch {
    member = null; // 서버를 나갔거나 접근 불가
  }
  memberCache.set(key, { member, at: Date.now() });
  return member;
}

export function invalidateMember(guildId, userId) {
  memberCache.delete(`${guildId}:${userId}`);
}

export function invalidateGuild(guildId) {
  for (const key of memberCache.keys()) {
    if (key.startsWith(`${guildId}:`)) memberCache.delete(key);
  }
}

/**
 * 스레드의 가시성은 부모 채널을 따른다.
 * 비공개 스레드는 초대된 멤버만 볼 수 있으므로 추가 검사가 필요하다.
 */
function permissionTarget(channel) {
  if (THREAD_TYPES.has(channel.type) && channel.parent) return channel.parent;
  return channel;
}

export async function memberCanView(channel, member) {
  if (!channel || !member) return false;
  const target = permissionTarget(channel);
  const perms = target.permissionsFor(member);
  if (!perms?.has(VIEW) || !perms.has(HISTORY)) return false;

  // 비공개 스레드: ManageThreads가 없으면 실제 참여자인지 확인
  if (channel.type === ChannelType.PrivateThread) {
    if (perms.has(PermissionFlagsBits.ManageThreads)) return true;
    try {
      const members = await channel.members.fetch();
      return members.has(member.id);
    } catch {
      return false;
    }
  }
  return true;
}

export async function memberCanSend(channel, member) {
  if (!channel || !member) return false;
  const perms = channel.permissionsFor(member);
  if (!perms) return false;
  if (THREAD_TYPES.has(channel.type)) return perms.has(SEND_THREAD);
  return perms.has(SEND);
}

export function botCanCreateThread(channel, botMember) {
  const perms = channel.permissionsFor(botMember);
  return !!perms?.has(CREATE_THREAD);
}

/**
 * 유저가 그 길드에서 볼 수 있는 피드 채널 목록.
 * 봇 자신도 볼 수 없는 채널은 애초에 읽어올 수 없으므로 함께 걸러낸다.
 */
export async function visibleChannels(guild, userId, { includeThreads = true } = {}) {
  const member = await fetchMember(guild, userId);
  if (!member) return [];
  const botMember = guild.members.me;
  if (!botMember) return [];

  const out = [];
  for (const channel of guild.channels.cache.values()) {
    if (!FEED_CHANNEL_TYPES.has(channel.type)) continue;
    if (!includeThreads && THREAD_TYPES.has(channel.type)) continue;
    if (THREAD_TYPES.has(channel.type) && !includeThreads) continue;

    const target = permissionTarget(channel);
    // 봇이 못 보는 채널은 내용을 가져올 수 없다
    if (!target.permissionsFor(botMember)?.has([VIEW, HISTORY])) continue;
    if (!(await memberCanView(channel, member))) continue;
    out.push(channel);
  }
  return out;
}

export async function canViewChannel(guild, channel, userId) {
  if (!guild || !channel) return false;
  const member = await fetchMember(guild, userId);
  if (!member) return false;
  const botMember = guild.members.me;
  const target = permissionTarget(channel);
  if (!botMember || !target.permissionsFor(botMember)?.has([VIEW, HISTORY])) return false;
  return memberCanView(channel, member);
}
