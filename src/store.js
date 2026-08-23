import { config } from './config.js';

const DISCORD_EPOCH = 1420070400000n;

/** 스노우플레이크 ID → 밀리초 타임스탬프 */
export function snowflakeToDate(id) {
  try {
    return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
  } catch {
    return 0;
  }
}

/** 타임스탬프 → 그 시각 직전을 가리키는 스노우플레이크 (before/after 커서용) */
export function dateToSnowflake(ms) {
  return String((BigInt(Math.floor(ms)) - DISCORD_EPOCH) << 22n);
}

const cmp = (a, b) => {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

class ChannelCache {
  constructor() {
    this.byId = new Map();
    this.order = []; // 오름차순
    this.lastFetchAt = 0;
    this.oldestFetchedId = null;
    this.reachedStart = false;
  }

  upsert(post) {
    const existing = this.byId.get(post.id);
    if (existing) {
      Object.assign(existing, post);
      return existing;
    }
    this.byId.set(post.id, post);
    // 대부분 최신 메시지가 뒤에 붙으므로 뒤에서부터 삽입 위치를 찾는다.
    let i = this.order.length;
    while (i > 0 && cmp(this.order[i - 1], post) > 0) i--;
    this.order.splice(i, 0, post);
    this.trim();
    return post;
  }

  trim() {
    const max = config.feed.maxCachedPerChannel;
    while (this.order.length > max) {
      const dropped = this.order.shift();
      this.byId.delete(dropped.id);
      this.reachedStart = false; // 앞쪽을 버렸으니 "처음까지 읽음" 보장이 깨진다
    }
    this.oldestFetchedId = this.order[0]?.id ?? null;
  }

  remove(id) {
    if (!this.byId.delete(id)) return false;
    const i = this.order.findIndex((m) => m.id === id);
    if (i >= 0) this.order.splice(i, 1);
    return true;
  }
}

const channels = new Map(); // channelId -> ChannelCache

export function cacheFor(channelId) {
  let c = channels.get(channelId);
  if (!c) channels.set(channelId, (c = new ChannelCache()));
  return c;
}

export const store = {
  upsert(channelId, post) {
    return cacheFor(channelId).upsert(post);
  },
  upsertMany(channelId, posts) {
    const c = cacheFor(channelId);
    return posts.map((p) => c.upsert(p));
  },
  get(channelId, messageId) {
    return channels.get(channelId)?.byId.get(messageId) || null;
  },
  /** 어느 채널에 있는지 모를 때 전체에서 찾기 (답글·좋아요 라우팅용) */
  find(messageId) {
    for (const [channelId, c] of channels) {
      const hit = c.byId.get(messageId);
      if (hit) return { channelId, post: hit };
    }
    return null;
  },
  list(channelId) {
    return channels.get(channelId)?.order || [];
  },
  remove(channelId, messageId) {
    return channels.get(channelId)?.remove(messageId) ?? false;
  },
  isFresh(channelId) {
    const c = channels.get(channelId);
    return !!c && Date.now() - c.lastFetchAt < config.feed.cacheTtlMs;
  },
  markFetched(channelId) {
    cacheFor(channelId).lastFetchAt = Date.now();
  },
  oldestId(channelId) {
    return channels.get(channelId)?.oldestFetchedId ?? null;
  },
  markReachedStart(channelId) {
    cacheFor(channelId).reachedStart = true;
  },
  hasReachedStart(channelId) {
    return channels.get(channelId)?.reachedStart ?? false;
  },
  /** 여러 채널의 캐시를 합쳐 최신순으로 정렬 */
  merge(channelIds, { before = null, filter = null } = {}) {
    const out = [];
    for (const id of channelIds) {
      const list = channels.get(id)?.order;
      if (!list) continue;
      for (let i = list.length - 1; i >= 0; i--) {
        const post = list[i];
        if (before && post.createdAt >= before) continue;
        if (filter && !filter(post)) continue;
        out.push(post);
      }
    }
    out.sort((a, b) => -cmp(a, b));
    return out;
  },
  stats() {
    let messages = 0;
    for (const c of channels.values()) messages += c.order.length;
    return { channels: channels.size, messages };
  },
  clear() {
    channels.clear();
  },
};
