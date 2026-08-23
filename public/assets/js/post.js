/* 글 카드 — 피드와 상세 화면에서 함께 쓴다 */

import { h, icon, timeAgo, fullTime, compact, toast, openMenu, openLightbox, clear } from './dom.js';
import { renderMarkdown, plainText } from './markdown.js';
import { api } from './api.js';
import { state, nav, postKey, discordLink, emit } from './state.js';

/* 같은 글이 여러 화면에 떠 있을 수 있으므로 DOM을 추적해 함께 갱신한다 */
const registry = new Map(); // key -> Set<HTMLElement>

function track(key, el) {
  let set = registry.get(key);
  if (!set) registry.set(key, (set = new Set()));
  set.add(el);
  // 화면에서 사라진 노드는 정리
  queueMicrotask(() => {
    for (const node of [...set]) if (!node.isConnected && node !== el) set.delete(node);
  });
}

export function forEachPostEl(key, fn) {
  const set = registry.get(key);
  if (!set) return;
  for (const el of [...set]) {
    if (!el.isConnected) { set.delete(el); continue; }
    fn(el);
  }
}

/* ------------------------------ 조각들 ------------------------------ */

const FILE_ICONS = [
  [/^image\//, 'image'],
  [/^video\//, 'film'],
  [/^audio\//, 'music'],
  [/pdf/, 'fileText'],
  [/zip|rar|7z|tar/, 'fileZip'],
  [/text|json|xml|javascript/, 'fileCode'],
];

const fileIcon = (type) => (FILE_ICONS.find(([re]) => re.test(type || ''))?.[1]) || 'file';

function renderMedia(post) {
  const files = post.attachments || [];
  const stickers = post.stickers || [];
  if (!files.length && !stickers.length) return null;

  const visual = files.filter((f) => f.isImage || f.isVideo);
  const others = files.filter((f) => !f.isImage && !f.isVideo);
  const nodes = [];

  if (visual.length || stickers.length) {
    const items = [
      ...visual,
      ...stickers.map((s) => ({ url: s.url, name: s.name, isImage: true, sticker: true })),
    ];
    const count = Math.min(items.length, 4);
    const grid = h('div', { class: 'media media-' + count });

    // 라이트박스에서 넘겨볼 목록 — 격자에 4장까지만 보여도 전부 넘길 수 있다
    const viewable = items.filter((f) => f.url && !f.spoiler)
      .map((f) => ({ url: f.url, name: f.description || f.name || '', video: !!f.isVideo }));

    items.slice(0, 4).forEach((f) => {
      const single = count === 1;
      const media = f.isVideo
        ? h('video', {
            src: f.url, controls: true, preload: 'metadata', playsinline: true,
            ...(single && f.width && f.height ? { style: { aspectRatio: f.width + ' / ' + f.height } } : {}),
          })
        : h('img', {
            src: f.url,
            alt: f.description || f.name || '',
            loading: 'lazy',
            decoding: 'async',
            // 비율을 미리 잡아 로딩 중 레이아웃이 튀지 않게 한다
            ...(single && f.width && f.height ? { width: f.width, height: f.height, style: { aspectRatio: f.width + ' / ' + f.height } } : {}),
          });

      // 크기를 모르는 이미지는 로드 전까지 높이가 0이라 화면이 튄다.
      // 임시로 자리를 잡아두고 로드되면 푼다.
      const unknownSize = single && !(f.width && f.height);

      const figure = h('figure', {
        class: unknownSize ? 'is-sizing' : null,
        onClick: (e) => {
          e.stopPropagation();
          if (f.spoiler && !figure.classList.contains('is-open')) { figure.classList.add('is-open'); return; }
          if (f.isVideo) return;
          openLightbox(viewable, { index: Math.max(viewable.findIndex((v) => v.url === f.url), 0) });
        },
      }, media);

      // 세로로 긴 사진이 넓은 빈 상자 안에 떠 있지 않도록, 상자를 비율에 맞춰 좁힌다.
      // (최대 높이는 CSS 변수라 촘촘히 보기 설정과도 자동으로 맞는다)
      if (single && f.width && f.height) {
        const ratio = (f.width / f.height).toFixed(4);
        figure.style.width = 'min(100%, calc(var(--media-cap) * ' + ratio + '))';
      }

      if (unknownSize) {
        const settle = () => figure.classList.remove('is-sizing');
        media.addEventListener('load', settle, { once: true });
        media.addEventListener('loadedmetadata', settle, { once: true });
        media.addEventListener('error', settle, { once: true });
      }

      if (f.spoiler) figure.append(h('div', { class: 'spoiler-cover' }, '스포일러 · 눌러서 보기'));
      grid.append(figure);
    });

    if (items.length > 4) {
      grid.lastChild.append(h('div', { class: 'spoiler-cover', style: { opacity: '1' }, text: '+' + (items.length - 4) }));
    }
    nodes.push(grid);
  }

  for (const f of others) {
    nodes.push(h('a', {
      class: 'media', href: f.url, target: '_blank', rel: 'noopener',
      onClick: (e) => e.stopPropagation(),
    }, h('div', { class: 'file' },
      icon(fileIcon(f.contentType)),
      h('span', { text: f.name }),
      h('small', { class: 'muted', text: f.size ? Math.max(1, Math.round(f.size / 1024)) + 'KB' : '' }),
    )));
  }

  return nodes;
}

function renderEmbed(e) {
  const box = h('div', { class: 'embed', style: e.color ? { borderLeftColor: e.color } : null });
  if (e.author?.name) {
    box.append(h('div', { class: 'e-author' },
      e.author.icon ? h('img', { class: 'avatar avatar-20', src: e.author.icon, alt: '' }) : null,
      h('span', { text: e.author.name })));
  }
  if (e.title) {
    box.append(e.url
      ? h('a', { class: 'e-title', href: e.url, target: '_blank', rel: 'noopener', text: e.title, onClick: (ev) => ev.stopPropagation() })
      : h('div', { class: 'e-title', text: e.title }));
  }
  if (e.description) box.append(h('div', { class: 'e-desc', html: renderMarkdown(e.description) }));
  if (e.fields?.length) {
    box.append(h('div', { class: 'e-fields' }, e.fields.map((f) =>
      h('div', { class: 'e-field' }, h('b', { text: f.name }), h('span', { html: renderMarkdown(f.value) })))));
  }
  if (e.image?.url) {
    box.append(h('img', {
      class: 'e-image', src: e.image.url, alt: '', loading: 'lazy',
      ...(e.image.width && e.image.height ? { style: { aspectRatio: e.image.width + ' / ' + e.image.height } } : {}),
    }));
  } else if (e.thumbnail?.url) {
    box.append(h('img', { class: 'e-image', src: e.thumbnail.url, alt: '', loading: 'lazy', style: { maxWidth: '160px' } }));
  }
  if (e.footer?.text) {
    box.append(h('div', { class: 'e-footer' },
      e.footer.icon ? h('img', { class: 'avatar avatar-20', src: e.footer.icon, alt: '' }) : null,
      h('span', { text: e.footer.text })));
  }
  return box;
}

const COMMON_EMOJI = ['❤️', '😂', '😮', '😢', '👍', '👎', '🔥', '🎉', '👏', '🙏', '😍', '🤔', '💀', '✅', '👀', '⚡', '🚀', '💯', '🐛', '🔖', '😭'];

function openEmojiPicker(anchor, onPick) {
  document.querySelector('.emoji-pop')?.remove();
  const pop = h('div', { class: 'emoji-pop' },
    h('div', { class: 'emoji-grid' }, COMMON_EMOJI.map((e) =>
      h('button', { type: 'button', text: e, onClick: (ev) => { ev.stopPropagation(); close(); onPick(e); } }))));

  const close = () => {
    pop.remove();
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const outside = (ev) => { if (!pop.contains(ev.target)) close(); };
  const onKey = (ev) => { if (ev.key === 'Escape') close(); };

  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  let left = Math.min(r.left, innerWidth - pop.offsetWidth - 10);
  let top = r.bottom + 6;
  if (top + pop.offsetHeight > innerHeight - 10) top = Math.max(10, r.top - pop.offsetHeight - 6);
  pop.style.left = Math.max(10, left) + 'px';
  pop.style.top = top + 'px';

  setTimeout(() => {
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
}

/* --------------------- 누가 눌렀는지 (마우스 올리면) --------------------- */

const reactorCache = new Map(); // `${channelId}:${id}:${key}` -> 이름 배열
let hoverTip = null;

function hideReactorTip() {
  hoverTip?.remove();
  hoverTip = null;
}

function showReactorTip(anchor, names) {
  hideReactorTip();
  if (!names.length) return;
  const shown = names.slice(0, 8);
  const rest = names.length - shown.length;
  hoverTip = h('div', { class: 'reactor-tip' },
    h('span', { text: shown.join(', ') + (rest > 0 ? ` 외 ${rest}명` : '') }));
  document.body.append(hoverTip);

  const box = anchor.getBoundingClientRect();
  const tip = hoverTip.getBoundingClientRect();
  // 화면 밖으로 나가지 않게 좌우를 접어 넣는다
  const left = Math.min(Math.max(box.left + box.width / 2 - tip.width / 2, 8), innerWidth - tip.width - 8);
  hoverTip.style.left = left + 'px';
  hoverTip.style.top = Math.max(box.top - tip.height - 8, 8) + 'px';
  hoverTip.classList.add('is-in');
}

/** 올려둔 채 잠깐 기다리면 물어본다 — 스쳐 지나갈 때마다 요청하지 않도록 */
function attachReactorTip(el, post, key) {
  let timer = null;
  let over = false;
  const lock = post.channelId + ':' + post.id + ':' + key;

  const enter = () => {
    over = true;
    timer = setTimeout(async () => {
      if (reactorCache.has(lock)) { showReactorTip(el, reactorCache.get(lock)); return; }
      try {
        const { users } = await api.reactors(post.channelId, post.id, key);
        const names = users.map((u) => (u.me ? '나' : u.displayName));
        reactorCache.set(lock, names);
        // 기다리는 사이에 마우스가 떠났으면 띄우지 않는다
        if (over) showReactorTip(el, names);
      } catch { /* 못 가져오면 조용히 넘어간다 */ }
    }, 320);
  };
  const leave = () => { over = false; clearTimeout(timer); hideReactorTip(); };

  el.addEventListener('mouseenter', enter);
  el.addEventListener('mouseleave', leave);
  // 눌러서 숫자가 바뀌면 이름도 다시 물어봐야 한다
  el.addEventListener('click', () => { reactorCache.delete(lock); leave(); });
  return el;
}

function renderReactions(post) {
  const row = h('div', { class: 'reactions' });

  for (const r of post.reactions || []) {
    const chip = h('button', {
      class: 'reaction' + (r.me ? ' is-mine' : ''),
      type: 'button',
      title: r.name,
      onClick: (e) => { e.stopPropagation(); toggleReaction(post, r.key, !r.me); },
    },
      r.url ? h('img', { src: r.url, alt: r.name, loading: 'lazy' }) : h('span', { class: 'r-emoji', text: r.name }),
      h('span', { text: compact(r.count) }));
    row.append(attachReactorTip(chip, post, r.key));
  }

  row.append(h('button', {
    class: 'reaction reaction-add',
    type: 'button',
    'aria-label': '반응 추가',
    onClick: (e) => {
      e.stopPropagation();
      openEmojiPicker(e.currentTarget, (emoji) => toggleReaction(post, emoji, true));
    },
  }, icon('emoji'), icon('plus')));

  return row;
}

/*
 * 같은 리액션을 연달아 누르는 동안에는 요청을 하나만 띄운다.
 *
 * 광클하면 응답이 도착하는 순서가 뒤죽박죽이 되고, 마지막에 남는 화면이
 * 실제 상태와 달라진다. 서버도 줄을 세우지만 여기서 먼저 막는 편이
 * 손맛에 좋다 — 누르는 즉시 잠기고, 끝나면 마지막으로 원한 상태로 한 번 더 간다.
 */
/** 하트는 서버에서도 이 리액션이다 (src/hydrate.js 의 HEART 와 같아야 한다) */
const HEART = '❤️';

const reacting = new Map(); // `${channelId}:${id}:${key}` -> { want }

async function toggleReaction(post, key, on) {
  const lock = post.channelId + ':' + post.id + ':' + key;
  const entry = reacting.get(lock);
  if (entry) { entry.want = on; return; }   // 진행 중 — 마지막 의사만 기억한다

  const self = { want: on };
  reacting.set(lock, self);
  try {
    let sent = null;
    // 기다리는 동안 마음이 바뀌었으면 한 번 더 보낸다
    while (sent !== self.want) {
      sent = self.want;
      const { post: updated } = await api.react(post.channelId, post.id, key, sent);
      if (updated) emit('post:patch', updated);
    }
  } catch (err) {
    toast(err.message, { error: true });
  } finally {
    reacting.delete(lock);
  }
}

/* ------------------------------ 본체 ------------------------------ */

/**
 * @param {object} post
 * @param {{detail?:boolean, showWhere?:boolean, connector?:boolean, onOpen?:Function}} opts
 */
export function renderPost(post, opts = {}) {
  const { detail = false, showWhere = true, connector = false } = opts;
  const key = postKey(post);

  const avatar = h('img', {
    class: 'avatar avatar-36', src: post.author.avatar, alt: '',
    loading: 'lazy', decoding: 'async',
    onClick: (e) => { e.stopPropagation(); nav.go('/u/' + post.author.id); },
  });

  const rail = h('div', { class: 'post-rail' }, avatar, connector ? h('div', { class: 'thread-line' }) : null);

  const head = h('div', { class: 'post-head' },
    h('a', {
      class: 'post-author', text: post.author.displayName,
      href: '/u/' + post.author.id,
      onClick: (e) => { e.preventDefault(); e.stopPropagation(); nav.go('/u/' + post.author.id); },
    }),
    post.author.bot ? h('span', { class: 'tag', text: 'BOT' }) : null,
    post.viaFuse ? h('span', { class: 'tag tag-fuse', text: 'Fuse' }) : null,
    h('div', { class: 'post-head-right' },
      // 서버 이름은 좁은 화면에서 CSS로 숨긴다 — 채널만 남아도 맥락은 충분하다
      showWhere && post.guild ? h('a', {
        class: 'post-where',
        href: '/g/' + post.guildId,
        onClick: (e) => { e.preventDefault(); e.stopPropagation(); nav.go('/g/' + post.guildId); },
      },
        h('span', { class: 'pw-guild', text: post.guild.name + ' · ' }),
        h('span', { class: 'pw-channel', text: '#' + (post.channel?.name || '') })) : null,
      h('time', { datetime: new Date(post.createdAt).toISOString(), title: fullTime(post.createdAt), text: timeAgo(post.createdAt) }),
      h('button', {
        class: 'post-more', type: 'button', 'aria-label': '더보기',
        onClick: (e) => { e.stopPropagation(); openPostMenu(e.currentTarget, post); },
      }, icon('more'))));

  const body = h('div', { class: 'post-body' });

  // 답장이면 무엇에 답한 것인지 위에 한 줄로 얹는다 (디스코드에서 답장을 보는 방식)
  if (post.replyTo) {
    body.append(post.replyTo.unavailable
      ? h('div', { class: 'reply-to is-gone' }, icon('reply', 'ic-xs'), h('span', { text: '원본을 불러올 수 없습니다' }))
      : h('button', {
          class: 'reply-to', type: 'button',
          onClick: (e) => {
            e.stopPropagation();
            nav.go('/p/' + post.replyTo.channelId + '/' + post.replyTo.id);
          },
        },
        icon('reply', 'ic-xs'),
        h('img', { class: 'avatar avatar-20', src: post.replyTo.author.avatar || '', alt: '', loading: 'lazy' }),
        h('b', { text: post.replyTo.author.displayName }),
        h('span', { class: 'reply-to-text', text: plainText(post.replyTo.excerpt) || '첨부' })));
  }

  body.append(head);

  if (post.content) {
    body.append(h('div', {
      class: 'post-content',
      html: renderMarkdown(post.content, post.mentions),
    }));
  }
  if (post.editedAt) {
    body.append(h('small', { class: 'muted', text: '수정됨' }));
  }

  const media = renderMedia(post);
  if (media) body.append(...media);

  for (const e of post.embeds || []) body.append(renderEmbed(e));

  // 리액션 칩은 상세에서만 — 피드는 아이콘 네 개로 깔끔하게 둔다
  if (detail) body.append(renderReactions(post));

  /* 액션 바 — 숫자는 아래 메타 줄에 모으고 여기엔 아이콘만 둔다 */
  const heart = icon('heart', post.liked ? 'is-filled' : '');
  const likeBtn = h('button', {
    class: 'act act-like' + (post.liked ? ' is-on' : ''),
    type: 'button', 'aria-label': '좋아요',
    onClick: (e) => { e.stopPropagation(); doLike(post, e.currentTarget); },
  }, heart);
  // 누른 뒤에 올려도 보여야 하므로 개수와 상관없이 붙인다
  // (아무도 안 눌렀으면 showReactorTip 이 알아서 아무것도 안 띄운다)
  attachReactorTip(likeBtn, post, HEART);

  const replyBtn = h('button', {
    class: 'act', type: 'button', 'aria-label': '답글',
    onClick: (e) => {
      e.stopPropagation();
      if (opts.onReply) opts.onReply(post);
      else nav.go('/p/' + post.channelId + '/' + post.id);
    },
  }, icon('comment'));

  const quoteBtn = h('button', {
    class: 'act', type: 'button', 'aria-label': '인용',
    onClick: (e) => { e.stopPropagation(); emit('compose:quote', post); },
  }, icon('repost'));

  const shareBtn = h('button', {
    class: 'act', type: 'button', 'aria-label': '공유',
    onClick: (e) => { e.stopPropagation(); sharePost(post, e.currentTarget); },
  }, icon('share'));

  body.append(h('div', { class: 'post-actions' }, likeBtn, replyBtn, quoteBtn, shareBtn));
  body.append(buildMetaCounts(post));

  const article = h('article', {
    class: 'post' + (detail ? ' detail-post' : ''),
    dataset: { key, channel: post.channelId, post: post.id },
    onClick: (e) => {
      if (detail) return;
      if (e.target.closest('a, button, video, .spoiler')) return;
      openDetail(post, article);
    },
  }, rail, body);

  article._post = post;
  track(key, article);
  return article;
}

/**
 * "답글 N개 · 좋아요 N개" 한 줄.
 * 스레드처럼 숫자를 아이콘 옆이 아니라 아래에 모아 액션 바를 가볍게 유지한다.
 */
function buildMetaCounts(post) {
  const row = h('div', { class: 'post-meta-counts' });
  if (!post) return row;

  const parts = [];
  if (post.threadReplyCount) parts.push(compact(post.threadReplyCount) + ' 답글');
  if (post.likeCount) parts.push(compact(post.likeCount) + ' 좋아요');
  if (!parts.length) { row.hidden = true; return row; }

  if (post.replyFaces?.length) {
    row.append(h('div', { class: 'facepile' }, post.replyFaces.slice(0, 3).map((src) =>
      h('img', { src, alt: '', loading: 'lazy' }))));
  }
  row.append(h('button', {
    class: 'meta-link', type: 'button', text: parts.join(' · '),
    onClick: (e) => { e.stopPropagation(); nav.go('/p/' + post.channelId + '/' + post.id, { seed: post }); },
  }));
  return row;
}

/** 좋아요·답글 수가 바뀌었을 때 카드의 메타 줄만 갈아끼운다 */
export function refreshMetaCounts(el, post) {
  const next = buildMetaCounts(post);
  const current = el.querySelector('.post-meta-counts');
  if (current) current.replaceWith(next);
  else el.querySelector('.post-body')?.append(next);
}

/* ------------------------------ 동작 ------------------------------ */

function openDetail(post, el) {
  const path = '/p/' + post.channelId + '/' + post.id;
  // seed 를 함께 넘겨 상세 화면이 즉시 그려지도록 한다 — 그래야 요소가 이어지며 변형된다
  nav.go(path, { morphFrom: el, seed: post });
}

async function doLike(post, btn) {
  // 하트도 ❤️ 리액션이므로 같은 잠금을 쓴다 — 광클해도 요청은 하나씩
  const lock = post.channelId + ':' + post.id + ':' + HEART;
  const before = { liked: post.liked, count: post.likeCount || 0 };

  // 낙관적 업데이트 — 네트워크를 기다리지 않는다
  const next = !post.liked;
  applyLike(post, next, next ? before.count + 1 : Math.max(before.count - 1, 0));
  if (next) {
    btn.classList.add('just-liked');
    setTimeout(() => btn.classList.remove('just-liked'), 460);
  }

  const entry = reacting.get(lock);
  if (entry) { entry.want = next; return; }

  const self = { want: next };
  reacting.set(lock, self);
  try {
    let sent = null;
    while (sent !== self.want) {
      sent = self.want;
      const res = await api.like(post.channelId, post.id);
      // 서버가 토글이므로 원하는 상태와 어긋나면 한 번 더 돈다
      applyLike(post, res.liked, res.count);
      if (res.liked === self.want) break;
    }
  } catch (err) {
    applyLike(post, before.liked, before.count);
    toast(err.message, { error: true });
  } finally {
    reacting.delete(lock);
  }
}

function applyLike(post, liked, count) {
  post.liked = liked;
  post.likeCount = count;
  forEachPostEl(postKey(post), (el) => {
    const btn = el.querySelector('.act-like');
    if (!btn) return;
    btn.classList.toggle('is-on', liked);
    // 스트로크 하트를 채우고 비우는 것으로 상태를 표현한다 (아이콘 교체가 아니라 채움)
    btn.querySelector('.ic')?.classList.toggle('is-filled', liked);
    if (el._post) { el._post.liked = liked; el._post.likeCount = count; }
    refreshMetaCounts(el, el._post || post);
  });
}

async function sharePost(post, btn) {
  const url = location.origin + '/p/' + post.channelId + '/' + post.id;
  if (navigator.share) {
    try {
      await navigator.share({ title: post.author.displayName + ' 님의 글', text: plainText(post.content).slice(0, 80), url });
      return;
    } catch { /* 사용자가 취소 — 복사로 넘어간다 */ }
  }
  await copy(url, '링크를 복사했습니다.');
  flashCheck(btn, 'share');
}

/** 아이콘을 체크로 잠깐 변형했다가 되돌린다 (복사 완료 피드백) */
async function flashCheck(btn, back) {
  const svg = btn?.querySelector('.ic');
  if (!svg) return;
  const { morphIcon } = await import('./dom.js');
  if (!svg.morphTo) {
    const replacement = morphIcon(back, svg.getAttribute('class').replace('ic', '').trim());
    svg.replaceWith(replacement);
    replacement.morphTo('check');
    setTimeout(() => replacement.morphTo(back), 1100);
    return;
  }
  svg.morphTo('check');
  setTimeout(() => svg.morphTo(back), 1100);
}

async function copy(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    try { document.execCommand('copy'); toast(message); } catch { toast('복사하지 못했습니다.', { error: true }); }
    ta.remove();
  }
}

function openPostMenu(anchor, post) {
  const items = [];

  if (post.canEdit) {
    items.push({ icon: 'edit', label: '수정', onSelect: () => emit('compose:edit', post) });
  }
  items.push({ icon: 'comment', label: '답글 달기', onSelect: () => nav.go('/p/' + post.channelId + '/' + post.id) });
  items.push({ icon: 'copy', label: '텍스트 복사', onSelect: () => copy(post.content || '', '내용을 복사했습니다.') });
  items.push({ icon: 'link', label: '링크 복사', onSelect: () => copy(location.origin + '/p/' + post.channelId + '/' + post.id, '링크를 복사했습니다.') });

  const link = discordLink(post);
  if (link) {
    items.push({ icon: 'discord', label: '디스코드에서 열기', onSelect: () => window.open(link, '_blank', 'noopener') });
  }
  if (post.author.id !== state.me?.id) {
    items.push({ icon: 'user', label: '프로필 보기', onSelect: () => nav.go('/u/' + post.author.id) });
    items.push({ icon: 'share', label: '쪽지 보내기', onSelect: () => nav.go('/dm/' + post.author.id) });
  }
  if (post.canDelete) {
    items.push('-');
    items.push({ icon: 'trash', label: '삭제', danger: true, onSelect: () => confirmDelete(post) });
  }

  openMenu(anchor, items);
}

function confirmDelete(post) {
  import('./dom.js').then(({ openOverlay }) => {
    openOverlay((close) => h('div', { class: 'sheet', style: { maxWidth: '360px' } },
      h('div', { class: 'sheet-body', style: { padding: '24px 22px 8px', textAlign: 'center' } },
        h('h2', { style: { fontSize: '17px', marginBottom: '8px' }, text: '이 글을 지울까요?' }),
        h('p', { class: 'muted', style: { fontSize: '14px' }, text: '디스코드에서도 함께 삭제됩니다. 되돌릴 수 없습니다.' })),
      h('div', { class: 'sheet-foot' },
        h('button', { class: 'btn-outline btn grow', type: 'button', text: '취소', onClick: () => close() }),
        h('button', {
          class: 'btn grow', type: 'button', text: '삭제',
          style: { background: 'var(--danger)', color: '#fff' },
          onClick: async () => {
            close();
            try {
              await api.deletePost(post.channelId, post.id);
              emit('post:remove', { channelId: post.channelId, id: post.id });
              toast('글을 삭제했습니다.');
            } catch (err) {
              toast(err.message, { error: true });
            }
          },
        }))));
  });
}

/* --------------------------- 부분 갱신 --------------------------- */

/** 서버에서 온 최신 글 데이터를 화면에 반영 */
export function patchPostEl(post) {
  forEachPostEl(postKey(post), (el) => {
    const fresh = renderPost(post, {
      detail: el.classList.contains('detail-post'),
      connector: !!el.querySelector('.thread-line'),
    });
    el.replaceWith(fresh);
  });
}

export function removePostEl(ref) {
  forEachPostEl(ref.channelId + ':' + ref.id, (el) => {
    el.style.transition = 'opacity .2s, transform .2s';
    el.style.opacity = '0';
    el.style.transform = 'scale(.98)';
    setTimeout(() => el.remove(), 200);
  });
}

/**
 * 실시간으로 도착한 카드가 자리를 밀어내며 펼쳐진다.
 * 높이를 같이 움직여야 아래 내용이 뚝 끊기지 않는다.
 */
export function playArrival(el) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (document.documentElement.dataset.motion === 'off') return;

  const full = el.getBoundingClientRect().height;
  if (!full) return;

  el.style.overflow = 'hidden';
  const anim = el.animate(
    [
      { height: '0px', opacity: 0, transform: 'translateY(-6px) scale(0.98)' },
      { height: full + 'px', opacity: 1, transform: 'none' },
    ],
    { duration: 460, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
  );
  // 애니메이션이 끝나면 푼다. 백그라운드 탭이라 재생이 멈춰 있을 수 있으므로
  // 타이머로도 한 번 더 풀어준다 — 안 그러면 내용이 잘린 채 남는다.
  const done = () => el.style.removeProperty('overflow');
  anim.finished.then(done, done);
  setTimeout(done, 700);

  // 방금 온 글이라는 표시가 잠깐 스쳤다 사라진다
  el.classList.add('is-arriving');
  setTimeout(() => el.classList.remove('is-arriving'), 1400);
}

/* --------------------------- 목록 렌더 --------------------------- */

export function renderFeedList(posts, opts = {}) {
  const list = h('div', { class: 'feed' });
  if (!posts.length) return list;
  for (const post of posts) list.append(renderPost(post, opts));
  return list;
}

export function skeletonFeed(count = 5) {
  const wrap = h('div', { class: 'feed' });
  for (let i = 0; i < count; i += 1) {
    wrap.append(h('div', { class: 'sk-post' },
      h('div', { class: 'skeleton', style: { width: '36px', height: '36px', borderRadius: '50%', flex: 'none' } }),
      h('div', { class: 'sk-lines' },
        h('span', { class: 'skeleton', style: { width: '30%' } }),
        h('span', { class: 'skeleton', style: { width: '92%' } }),
        h('span', { class: 'skeleton', style: { width: '64%' } }))));
  }
  return wrap;
}

export { clear, copy };
