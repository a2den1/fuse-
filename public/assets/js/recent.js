/*
 * 최근 본 것 기록.
 *
 * 검색 화면에서 검색어를 비웠을 때 보여준다.
 * 브라우저에만 남고 서버로 가지 않는다.
 */

const KEY = 'fuse:recent';
const MAX = 24;

let items = load();

function load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* 사생활 보호 모드 */ }
}

const idOf = (entry) => entry.kind + ':' + entry.id;

/**
 * @param {{kind:'post'|'user'|'guild'|'channel', id:string, title:string,
 *          subtitle?:string, avatar?:string, path:string, round?:boolean}} entry
 */
export function rememberRecent(entry) {
  if (!entry?.id || !entry?.path) return;
  const key = idOf(entry);
  items = [{ ...entry, at: Date.now() }, ...items.filter((x) => idOf(x) !== key)].slice(0, MAX);
  persist();
}

export function recents(kind = null) {
  return kind ? items.filter((x) => x.kind === kind) : items;
}

export function removeRecent(kind, id) {
  items = items.filter((x) => idOf(x) !== kind + ':' + id);
  persist();
}

export function clearRecents() {
  items = [];
  persist();
}

/* 글·사람 기록을 만드는 짧은 도우미 */

export function rememberPost(post) {
  if (!post) return;
  rememberRecent({
    kind: 'post',
    id: post.channelId + '/' + post.id,
    title: post.author?.displayName || '글',
    subtitle: (post.content || '').replace(/\s+/g, ' ').trim().slice(0, 60) || '첨부',
    avatar: post.author?.avatar || null,
    round: true,
    path: '/p/' + post.channelId + '/' + post.id,
  });
}

export function rememberUser(user) {
  if (!user?.id) return;
  rememberRecent({
    kind: 'user',
    id: user.id,
    title: user.displayName || user.username,
    subtitle: '@' + (user.username || ''),
    avatar: user.avatar || null,
    round: true,
    path: '/u/' + user.id,
  });
}

export function rememberGuild(guild) {
  if (!guild?.id) return;
  rememberRecent({
    kind: 'guild',
    id: guild.id,
    title: guild.name,
    subtitle: guild.description || '서버',
    avatar: guild.icon || null,
    path: '/g/' + guild.id,
  });
}

export function rememberChannel(channel, guildName) {
  if (!channel?.id) return;
  rememberRecent({
    kind: 'channel',
    id: channel.id,
    title: '#' + channel.name,
    subtitle: guildName || '채널',
    avatar: null,
    path: '/c/' + channel.id,
  });
}
