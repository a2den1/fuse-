/* 화면들 */

import {
  h, icon, morphIcon, clear, toast, timeAgo, fullTime, clockTime, compact, autoGrow, openLightbox,
} from './dom.js';
import { api } from './api.js';
import { state, nav, on, emit } from './state.js';
import { renderPost, renderFeedList, skeletonFeed, playArrival } from './post.js';
import { openComposer, inlineComposer } from './compose.js';
import { plainText } from './markdown.js';
import { focusOn } from './live.js';
import { attachMentions } from './mention.js';
import { topbar, view, emptyState, errorState, infinite, makeTabs, whenSized } from './ui.js';
import { recents, clearRecents, rememberPost, rememberUser, rememberGuild, rememberChannel } from './recent.js';
import { notifyPermission, requestNotifyPermission } from './notify.js';

/* ------------------------------- 홈 ------------------------------- */

export function homeView() {
  const feedWrap = h('div');
  let cursor = null;
  let stopInfinite = null;

  const chips = h('div', { class: 'chiprow' });

  function renderChips() {
    clear(chips);
    chips.append(h('button', {
      class: 'pill' + (!state.guildFilter ? ' is-active' : ''), type: 'button', text: '전체',
      onClick: () => setFilter(null),
    }));
    for (const g of state.guilds) {
      chips.append(h('button', {
        class: 'pill' + (state.guildFilter === g.id ? ' is-active' : ''), type: 'button',
        onClick: () => setFilter(g.id),
      }, g.icon ? h('img', { src: g.icon, alt: '', loading: 'lazy' }) : null, h('span', { text: g.name })));
    }
  }

  function setFilter(id) {
    if (state.guildFilter === id) return;
    state.guildFilter = id;
    renderChips();
    load(true);
  }

  async function load(reset = false) {
    if (reset) {
      cursor = null;
      stopInfinite?.();
      clear(feedWrap);
      feedWrap.append(skeletonFeed());
    }
    try {
      const data = await api.feed({ guild: state.guildFilter, cursor });
      cursor = data.cursor;
      if (reset) clear(feedWrap);

      if (!data.posts.length && reset) {
        feedWrap.append(data.empty
          ? emptyState('compass', '아직 볼 수 있는 서버가 없습니다',
              'Fuse 봇이 들어가 있는 서버에 가입하면 여기에 글이 모입니다.',
              h('button', { class: 'pill', type: 'button', text: '서버 둘러보기', style: { marginTop: '14px' }, onClick: () => nav.go('/discover') }))
          : emptyState('comment', '아직 글이 없습니다', '이 서버에서 첫 글을 남겨보세요.'));
        return;
      }

      const list = renderFeedList(data.posts);
      feedWrap.append(list);

      if (cursor) {
        stopInfinite = infinite(feedWrap, async () => {
          const more = await api.feed({ guild: state.guildFilter, cursor });
          cursor = more.cursor;
          return { nodes: more.posts.map((p) => renderPost(p)), more: !!cursor };
        });
      }
    } catch (err) {
      if (reset) clear(feedWrap);
      feedWrap.append(errorState(err.message, () => load(true)));
    }
  }

  // 새 글은 배너로 알리지 않고 바로 목록 맨 위에 얹는다
  const offNew = on('post:new', (post) => {
    if (state.guildFilter && post.guildId !== state.guildFilter) return;
    if (post.inThread) return;
    // 내가 쓴 글은 HTTP 응답과 실시간 브로드캐스트 양쪽으로 도착한다 — 한 번만 그린다
    if (feedWrap.querySelector('[data-post="' + post.id + '"]')) return;
    const card = renderPost(post);
    feedWrap.querySelector('.feed')?.prepend(card);
    playArrival(card);
  });

  renderChips();
  load(true);

  // 서버 칩 바로 아래에서 곧장 글을 쓴다 — 글쓰기가 화면 이동이 아니게
  const composer = inlineComposer();

  const el = view(chips, composer, feedWrap);

  // 맨 위에서 당기면 도화선이 타들어가고 새로고침
  let ptr = null;
  import('./refresh.js').then(({ attachPullToRefresh }) => {
    ptr = attachPullToRefresh(el, async () => {
      state.recentRefresh = Date.now();
      await load(true);
    });
    el._ptr = ptr;
  });

  el._cleanup = () => { offNew(); stopInfinite?.(); ptr?.destroy(); composer._cleanup?.(); };
  return el;
}

/* ------------------------------ 글 상세 ------------------------------ */

/**
 * @param {string} channelId
 * @param {string} messageId
 * @param {object|null} seed 피드에서 이미 알고 있는 글 — 있으면 즉시 그려서 화면 전환이 이어지게 한다
 */
export function postView(channelId, messageId, seed = null) {
  const wrap = h('div');
  const el = view(topbar({ title: '스레드', back: true }), wrap);

  // 씨앗이 있으면 네트워크를 기다리지 않고 본문부터 띄운다 (모프 전환의 도착점)
  let seedEl = null;
  if (seed) {
    seedEl = renderPost(seed, { detail: true, showWhere: true });
    seedEl.dataset.morphTarget = '1';
    wrap.append(seedEl, h('div', { class: 'reply-head', text: '답글' }), skeletonFeed(2));
  } else {
    wrap.append(skeletonFeed(3));
  }

  (async () => {
    try {
      const data = await api.post(channelId, messageId);
      rememberPost(data.post);

      // 씨앗 카드가 위로 올라오는 중이면 끝날 때까지 기다린다.
      // 여기서 바로 지우면 그 움직임이 첫 프레임에 사라진다.
      if (state.rise) await state.rise;

      clear(wrap);
      focusOn(data.post.threadId || data.post.channelId);

      if (data.parent) {
        wrap.append(renderPost(data.parent, { connector: true }));
      }

      const main = renderPost(data.post, { detail: true, showWhere: true });
      main.dataset.morphTarget = '1';
      wrap.append(main);

      const stats = h('div', { class: 'detail-stats' },
        h('span', { text: fullTime(data.post.createdAt) }),
        data.post.likeCount ? h('span', {}, h('b', { text: compact(data.post.likeCount) }), ' 좋아요') : null,
        data.replies.length ? h('span', {}, h('b', { text: compact(data.replies.length) }), ' 답글') : null);
      wrap.append(stats);

      /* 인라인 답글 입력 */
      const textarea = h('textarea', { placeholder: data.post.author.displayName + ' 님에게 답글 남기기…', rows: '1', maxlength: '2000' });
      const sendBtn = h('button', { class: 'btn', type: 'button', text: '답글', disabled: true });
      const box = h('div', { class: 'replybox' },
        h('img', { class: 'avatar avatar-36', src: state.me?.avatar || '', alt: '' }),
        h('div', { class: 'rb-main' }, textarea,
          h('div', { class: 'rb-foot' },
            h('small', { class: 'muted', text: '누구나 답글을 볼 수 있습니다' }),
            sendBtn)));

      autoGrow(textarea, 200);
      const mentions = attachMentions(textarea, () => data.post.guildId);
      textarea.addEventListener('focus', () => box.classList.add('is-open'));
      textarea.addEventListener('input', () => { sendBtn.disabled = !textarea.value.trim(); });
      textarea.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submitReply(); }
      });

      let typingSent = 0;
      textarea.addEventListener('input', () => {
        const now = Date.now();
        if (now - typingSent > 6000) {
          typingSent = now;
          api.typing(data.post.threadId || channelId).catch(() => {});
        }
      });

      async function submitReply() {
        const text = textarea.value.trim();
        if (!text) return;
        sendBtn.disabled = true;
        sendBtn.textContent = '남기는 중…';
        try {
          const form = new FormData();
          form.set('content', mentions.resolve(text));
          const { post } = await api.reply(channelId, messageId, form);
          textarea.value = '';
          textarea.style.height = 'auto';
          box.classList.remove('is-open');
          // 첫 답글이면 여기서 스레드가 새로 생긴다 — 이후 실시간 답글을 받으려면 id를 갱신해야 한다
          if (!data.post.threadId && post.channelId !== channelId) {
            data.post.threadId = post.channelId;
            focusOn(post.channelId);
          }
          appendReply(post);
        } catch (err) {
          toast(err.message, { error: true });
        } finally {
          sendBtn.textContent = '답글';
          sendBtn.disabled = !textarea.value.trim();
        }
      }
      sendBtn.addEventListener('click', submitReply);
      wrap.append(box);

      wrap.append(h('div', { class: 'reply-head', text: '답글' }));

      const replies = h('div', { class: 'feed' });

      /**
       * 답글을 목록에 한 번만 넣는다.
       * 서버의 실시간 브로드캐스트가 HTTP 응답보다 먼저 도착할 수 있어
       * 두 경로가 모두 이 함수를 거치게 한다.
       */
      function appendReply(post) {
        if (replies.querySelector('[data-post="' + post.id + '"]')) return;
        replies.querySelector('.empty')?.remove();
        const card = renderPost(post, { showWhere: false });
        replies.append(card);
        playArrival(card);
      }

      if (data.replies.length) {
        for (const r of data.replies) appendReply(r);
      } else {
        replies.append(emptyState('forum', '아직 답글이 없습니다', '첫 답글을 남겨보세요.'));
      }
      wrap.append(replies);

      const typingRow = h('div', { class: 'typing', hidden: true });
      wrap.append(typingRow);
      const typers = new Map();

      const offTyping = on('typing', (t) => {
        if (t.channelId !== (data.post.threadId || channelId)) return;
        if (t.user.id === state.me?.id) return;
        typers.set(t.user.id, { name: t.user.displayName, at: Date.now() });
        renderTyping();
        setTimeout(renderTyping, 5200);
      });

      function renderTyping() {
        const now = Date.now();
        for (const [id, v] of typers) if (now - v.at > 5000) typers.delete(id);
        if (!typers.size) { typingRow.hidden = true; return; }
        clear(typingRow);
        typingRow.hidden = false;
        typingRow.append(
          h('span', { class: 'dots' }, h('i'), h('i'), h('i')),
          h('span', { text: [...typers.values()].map((v) => v.name).join(', ') + ' 님이 입력 중' }));
      }

      const offNew = on('post:new', (post) => {
        if (post.channelId !== data.post.threadId) return;
        appendReply(post);
      });

      // 보고 있던 글이 지워지면 빈 화면에 남지 않도록 되돌아간다
      const offGone = on('post:remove', (ref) => {
        if (ref.channelId === data.post.channelId && ref.id === data.post.id) nav.back();
      });

      el._cleanup = () => { offTyping(); offNew(); offGone(); focusOn(null); };
    } catch (err) {
      clear(wrap);
      wrap.append(errorState(err.message, () => nav.replace('/p/' + channelId + '/' + messageId)));
    }
  })();

  return el;
}

/* ------------------------------- 검색 ------------------------------- */

export function searchView(initialQuery = '') {
  const input = h('input', { type: 'search', placeholder: '검색', value: initialQuery, 'aria-label': '검색', autocomplete: 'off' });
  const results = h('div');
  let timer = null;
  let lastQuery = '';

  const clearBtn = h('button', { class: 'clear', type: 'button', 'aria-label': '지우기', hidden: !initialQuery, onClick: () => { input.value = ''; clearBtn.hidden = true; run(''); input.focus(); } }, icon('close'));

  const RECENT_ICON = { post: 'comment', user: 'user', guild: 'building', channel: 'hash' };

  /*
   * 담아둔 글.
   *
   * 검색 화면은 "다시 찾으러 오는 곳" 이라 북마크가 여기 있는 게 자연스럽다.
   * 목록을 통째로 늘어놓지 않고 몇 개만 보여주고 나머지는 북마크 화면으로 보낸다.
   */
  const bookmarkBox = h('div');

  async function showBookmarks() {
    clear(bookmarkBox);
    let posts = [];
    try {
      ({ posts } = await api.bookmarks());
    } catch { return; }
    if (!posts.length || lastQuery.trim()) return;

    bookmarkBox.append(h('div', { class: 'section-head' },
      h('div', { class: 'section-label' }, icon('bookmark'), h('span', { text: '북마크' })),
      h('button', {
        class: 'section-action', type: 'button', text: '모두 보기',
        onClick: () => nav.go('/bookmarks'),
      })));

    for (const post of posts.slice(0, 3)) {
      bookmarkBox.append(h('button', {
        class: 'result-row', type: 'button',
        onClick: () => nav.go('/p/' + post.channelId + '/' + post.id, { seed: post }),
      },
        h('img', { class: 'rr-icon', src: post.author.avatar, alt: '', loading: 'lazy', style: { borderRadius: '50%' } }),
        h('div', { class: 'rr-main' },
          h('b', { text: post.author.displayName }),
          h('small', { text: plainText(post.content, post.mentions).slice(0, 70) || '(첨부만 있는 글)' })),
        h('span', { class: 'rr-time muted', text: timeAgo(post.bookmarkedAt || post.createdAt) })));
    }
    if (posts.length > 3) {
      bookmarkBox.append(h('button', {
        class: 'result-row rr-more', type: 'button', text: `북마크 ${posts.length}개 모두 보기`,
        onClick: () => nav.go('/bookmarks'),
      }));
    }
  }

  /** 검색어가 비었을 때 — 담아둔 글과 최근에 본 것들 */
  function showRecents() {
    clear(results);
    results.append(bookmarkBox);
    showBookmarks();

    const list = recents();
    if (!list.length) {
      results.append(emptyState('search', '무엇을 찾으시나요', '글, 사람, 서버, 채널을 한 번에 찾습니다.'));
      return;
    }

    results.append(h('div', { class: 'section-head' },
      h('div', { class: 'section-label', text: '최근 본 항목' }),
      h('button', {
        class: 'section-action', type: 'button', text: '모두 지우기',
        onClick: () => { clearRecents(); showRecents(); },
      })));

    for (const item of list) {
      results.append(h('button', {
        class: 'result-row', type: 'button',
        onClick: () => nav.go(item.path),
      },
        item.avatar
          ? h('img', { class: 'rr-icon', src: item.avatar, alt: '', loading: 'lazy',
              style: item.round ? { borderRadius: '50%' } : null })
          : h('div', { class: 'rr-icon' }, icon(RECENT_ICON[item.kind] || 'comment')),
        h('div', { class: 'rr-main' },
          h('b', { text: item.title }),
          h('small', { text: item.subtitle || '' })),
        h('span', { class: 'rr-time muted', text: timeAgo(item.at) })));
    }
  }

  const offBookmarks = on('bookmarks:changed', () => {
    if (!lastQuery.trim()) showBookmarks();
  });

  async function run(q) {
    lastQuery = q;
    if (!q.trim()) {
      showRecents();
      return;
    }
    clear(results);
    results.append(skeletonFeed(3));
    try {
      const data = await api.search(q);
      if (lastQuery !== q) return; // 더 최신 검색이 진행 중
      clear(results);

      const total = data.posts.length + data.users.length + data.guilds.length + data.channels.length;
      if (!total) {
        results.append(emptyState('frown', '결과가 없습니다', '"' + q + '" 와 일치하는 항목을 찾지 못했습니다.'));
        return;
      }

      if (data.users.length) {
        results.append(h('div', { class: 'section-label', text: '사람' }));
        for (const u of data.users) {
          results.append(h('button', { class: 'result-row', type: 'button', onClick: () => nav.go('/u/' + u.id) },
            h('img', { class: 'avatar avatar-40 rr-icon', src: u.avatar, alt: '', style: { borderRadius: '50%' } }),
            h('div', { class: 'rr-main' }, h('b', { text: u.displayName }), h('small', { text: '@' + u.username }))));
        }
      }
      if (data.guilds.length) {
        results.append(h('div', { class: 'section-label', text: '서버' }));
        for (const g of data.guilds) {
          results.append(h('button', { class: 'result-row', type: 'button', onClick: () => nav.go('/g/' + g.id) },
            h('img', { class: 'rr-icon', src: g.icon || '', alt: '' }),
            h('div', { class: 'rr-main' }, h('b', { text: g.name }), h('small', { text: g.description || (g.memberCount ? g.memberCount.toLocaleString('ko-KR') + '명' : '서버') }))));
        }
      }
      if (data.channels.length) {
        results.append(h('div', { class: 'section-label', text: '채널' }));
        for (const c of data.channels) {
          results.append(h('button', { class: 'result-row', type: 'button', onClick: () => nav.go('/c/' + c.id) },
            h('div', { class: 'rr-icon' }, icon('hash')),
            h('div', { class: 'rr-main' }, h('b', { text: c.name }), h('small', { text: c.guildName || '' }))));
        }
      }
      if (data.posts.length) {
        results.append(h('div', { class: 'section-label', text: '글' }));
        results.append(renderFeedList(data.posts));
      }
    } catch (err) {
      clear(results);
      results.append(errorState(err.message, () => run(q)));
    }
  }

  input.addEventListener('input', () => {
    clearBtn.hidden = !input.value;
    clearTimeout(timer);
    timer = setTimeout(() => run(input.value), 260);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); run(input.value); } });

  run(initialQuery);

  const el = view(
    topbar({ title: '검색' }),
    h('div', { class: 'searchbar' },
      h('div', { class: 'searchfield' }, icon('search'), input, clearBtn)),
    results,
  );
  requestAnimationFrame(() => { if (!initialQuery) input.focus(); });
  el._cleanup = () => offBookmarks();
  return el;
}

/* ------------------------------- 알림 ------------------------------- */

const ACTIVITY_META = {
  like: ['heart', 'kind-like', '님이 회원님의 글을 좋아합니다'],
  reply: ['reply', 'kind-reply', '님이 답글을 남겼습니다'],
  mention: ['at', 'kind-mention', '님이 회원님을 언급했습니다'],
  dm: ['mail', 'kind-dm', '님이 쪽지를 보냈습니다'],
};

function activityRow(item) {
  const [iconName, kindClass, phrase] = ACTIVITY_META[item.kind] || ACTIVITY_META.mention;
  return h('button', {
    class: 'activity-row' + (item.read ? '' : ' is-unread'), type: 'button',
    onClick: () => {
      if (item.kind === 'dm') nav.go('/dm/' + item.actor.id);
      else if (item.channelId && item.targetId) nav.go('/p/' + item.channelId + '/' + item.targetId);
    },
  },
    h('div', { class: 'activity-av' },
      h('img', { class: 'avatar avatar-36', src: item.actor?.avatar || '', alt: '' }),
      h('div', { class: 'kind ' + kindClass }, icon(iconName))),
    h('div', { class: 'activity-main' },
      h('div', { class: 'a-line' }, h('b', { text: item.actor?.displayName || '누군가' }), phrase),
      item.excerpt ? h('div', { class: 'a-excerpt', text: plainText(item.excerpt) }) : null,
      h('div', { class: 'a-time' }, timeAgo(item.at), item.guildName ? ' · ' + item.guildName : '')));
}

export function activityView() {
  const list = h('div');
  list.append(skeletonFeed(4));

  (async () => {
    try {
      const data = await api.activity();
      clear(list);
      if (!data.items.length) {
        list.append(emptyState('bell', '알림이 없습니다', '좋아요, 답글, 멘션이 여기에 모입니다.'));
      } else {
        for (const item of data.items) list.append(activityRow(item));
      }
      await api.readActivity();
      state.unread = 0;
      emit('unread', 0);
    } catch (err) {
      clear(list);
      list.append(errorState(err.message, () => nav.replace('/activity')));
    }
  })();

  const off = on('activity:new', (item) => {
    list.querySelector('.empty')?.remove();
    list.prepend(activityRow(item));
  });

  const el = view(topbar({ title: '알림' }), list);
  el._cleanup = off;
  return el;
}

/* ------------------------------ 프로필 ------------------------------ */

export function profileView(userId) {
  const wrap = h('div');
  wrap.append(skeletonFeed(3));
  const el = view(topbar({ title: '프로필', back: true }), wrap);

  (async () => {
    try {
      const data = await api.user(userId);
      rememberUser(data.user);
      clear(wrap);

      const head = h('div', { class: 'profile-head' },
        h('div', { class: 'profile-top' },
          h('div', { class: 'profile-id' },
            h('div', { class: 'profile-name', text: data.user.displayName }),
            h('div', { class: 'profile-handle', text: '@' + data.user.username })),
          h('img', { class: 'avatar avatar-84', src: data.user.avatar, alt: '' })),
        data.bio ? h('div', { class: 'profile-bio', text: data.bio }) : null,
        h('div', { class: 'profile-stats' },
          h('span', {}, h('b', { text: compact(data.stats.posts) }), ' 글'),
          h('span', {}, h('b', { text: compact(data.stats.likes) }), ' 좋아요'),
          h('span', {}, h('b', { text: compact(data.stats.guilds) }), ' 함께 있는 서버')));
      wrap.append(head);

      const actions = h('div', { class: 'profile-actions' });
      if (data.isMe) {
        actions.append(h('button', { class: 'btn btn-outline', type: 'button', text: '소개 수정', onClick: () => editBio(data.bio) }));
        actions.append(h('button', { class: 'btn btn-outline', type: 'button', text: '설정', onClick: () => nav.go('/settings') }));
      } else {
        actions.append(h('button', { class: 'btn', type: 'button', text: '쪽지 보내기', onClick: () => nav.go('/dm/' + data.user.id) }));
        actions.append(h('button', { class: 'btn btn-outline', type: 'button', text: '멘션해서 글쓰기', onClick: () => openComposer() }));
      }
      wrap.append(actions);

      const panel = h('div');
      const tabs = makeTabs(['글', '서버'], (i) => {
        clear(panel);
        if (i === 0) {
          panel.append(data.posts.length
            ? renderFeedList(data.posts, { showWhere: true })
            : emptyState('edit', '아직 글이 없습니다',
                data.isMe ? '첫 글을 올려보세요.' : '이 사람이 쓴 글이 아직 없습니다.'));
        } else {
          if (!data.shared.length) {
            panel.append(emptyState('building', '함께 있는 서버가 없습니다', ''));
          }
          for (const g of data.shared) {
            panel.append(h('button', { class: 'result-row', type: 'button', onClick: () => nav.go('/g/' + g.id) },
              h('img', { class: 'rr-icon', src: g.icon || '', alt: '' }),
              h('div', { class: 'rr-main' },
                h('b', { text: g.name }),
                g.roles?.length
                  ? h('div', { class: 'rolechips', style: { marginTop: '5px' } }, g.roles.slice(0, 4).map((r) =>
                      h('span', { class: 'rolechip', style: r.color ? { color: r.color } : null },
                        h('span', { class: 'dot' }), r.name)))
                  : h('small', { text: '역할 없음' }))));
          }
        }
      });
      wrap.append(tabs.bar, panel);
      tabs.select(0);

      /** 소개 수정도 모달이 아니라 그 자리에서 펼쳐지는 입력칸이다 */
      function editBio(current) {
        if (head.querySelector('.bio-edit')) return;
        const ta = h('textarea', { placeholder: '자기소개를 적어주세요', maxlength: '200' });
        ta.value = current || '';

        const saveBtn = h('button', { class: 'btn', type: 'button', text: '저장' });
        const box = h('div', { class: 'bio-edit' }, ta,
          h('div', { class: 'bio-foot' },
            h('button', { class: 'btn btn-outline', type: 'button', text: '취소', onClick: () => { box.remove(); actions.hidden = false; } }),
            saveBtn));

        saveBtn.addEventListener('click', async () => {
          saveBtn.disabled = true;
          saveBtn.textContent = '저장 중…';
          try {
            await api.updateProfile({ bio: ta.value.trim() });
            toast('소개를 저장했습니다.');
            nav.replace('/u/' + userId);
          } catch (err) {
            toast(err.message, { error: true });
            saveBtn.disabled = false;
            saveBtn.textContent = '저장';
          }
        });

        actions.hidden = true;
        head.append(box);
        autoGrow(ta, 200);
        ta.focus();
      }
    } catch (err) {
      clear(wrap);
      wrap.append(errorState(err.message, () => nav.replace('/u/' + userId)));
    }
  })();

  return el;
}

/* ------------------------------- 서버 ------------------------------- */

const CHANNEL_ICON = {
  text: 'hash',
  announcement: 'megaphone',
  voice: 'volume',
  forum: 'forum',
  thread: 'thread',
};

export function guildView(guildId) {
  const wrap = h('div');
  wrap.append(skeletonFeed(3));
  const bar = topbar({ title: '서버', back: true });
  const el = view(bar, wrap);

  (async () => {
    try {
      const data = await api.guild(guildId);
      rememberGuild(data.guild);
      clear(wrap);
      bar.querySelector('.topbar-title').textContent = data.guild.name;

      const pinBtn = h('button', {
        class: 'btn btn-outline', type: 'button',
        text: data.guild.pinned ? '고정 해제' : '고정',
        onClick: async () => {
          try {
            const res = await api.pinGuild(guildId);
            pinBtn.textContent = res.pinned ? '고정 해제' : '고정';
            const g = state.guilds.find((x) => x.id === guildId);
            if (g) g.pinned = res.pinned;
            toast(res.pinned ? '피드 위쪽에 고정했습니다.' : '고정을 해제했습니다.');
          } catch (err) { toast(err.message, { error: true }); }
        },
      });

      wrap.append(h('div', { class: 'guild-hero' },
        h('img', { src: data.guild.icon || '', alt: '' }),
        h('div', { class: 'gh-main' },
          h('h1', { text: data.guild.name }),
          h('p', { text: data.guild.description || (data.guild.memberCount ? data.guild.memberCount.toLocaleString('ko-KR') + '명의 멤버' : '') }),
          h('div', { style: { display: 'flex', gap: '8px', marginTop: '6px' } },
            h('button', { class: 'btn', type: 'button', text: '글쓰기', onClick: () => openComposer() }),
            pinBtn))));

      const panel = h('div');
      const tabs = makeTabs(['최근 글', '채널', '멤버'], async (i) => {
        clear(panel);
        if (i === 0) {
          panel.append(skeletonFeed(3));
          try {
            const feed = await api.feed({ guild: guildId });
            clear(panel);
            panel.append(feed.posts.length
              ? renderFeedList(feed.posts, { showWhere: false })
              : emptyState('comment', '글이 없습니다', '이 서버에서 첫 글을 남겨보세요.'));
          } catch (err) {
            clear(panel);
            panel.append(errorState(err.message));
          }
        } else if (i === 1) {
          if (!data.channels.length) panel.append(emptyState('hash', '볼 수 있는 채널이 없습니다', ''));
          for (const c of data.channels) {
            panel.append(h('button', { class: 'channel-row', type: 'button', onClick: () => nav.go('/c/' + c.id) },
              icon(CHANNEL_ICON[c.kind] || CHANNEL_ICON.text),
              h('div', { class: 'cr-main' }, h('b', { text: c.name }), c.topic ? h('small', { text: c.topic }) : null),
              icon('right', 'muted')));
          }
        } else {
          if (!data.members.length) panel.append(emptyState('user', '멤버를 불러올 수 없습니다', ''));
          const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: '4px', padding: '12px' } });
          for (const m of data.members) {
            grid.append(h('button', { class: 'membercard', type: 'button', onClick: () => nav.go('/u/' + m.id) },
              h('img', { class: 'avatar avatar-48', src: m.avatar, alt: '', loading: 'lazy' }),
              h('span', { text: m.displayName })));
          }
          panel.append(grid);
        }
      });
      wrap.append(tabs.bar, panel);
      tabs.select(0);
    } catch (err) {
      clear(wrap);
      wrap.append(errorState(err.message, () => nav.replace('/g/' + guildId)));
    }
  })();

  return el;
}

/* ------------------------------- 채널 ------------------------------- */

export function channelView(channelId) {
  const wrap = h('div');
  wrap.append(skeletonFeed(4));
  const bar = topbar({ title: '채널', back: true });
  const el = view(bar, wrap);
  let cursor = null;

  (async () => {
    try {
      const data = await api.channel(channelId);
      rememberChannel(data.channel, data.channel?.guildName);
      clear(wrap);
      cursor = data.cursor;
      focusOn(channelId);
      bar.querySelector('.topbar-title').textContent = '#' + (data.channel?.name || '채널');

      wrap.append(data.posts.length
        ? renderFeedList(data.posts, { showWhere: false })
        : emptyState('comment', '아직 글이 없습니다', '첫 글을 남겨보세요.'));

      if (cursor) {
        infinite(wrap, async () => {
          const more = await api.channel(channelId, { cursor });
          cursor = more.cursor;
          return { nodes: more.posts.map((p) => renderPost(p, { showWhere: false })), more: !!cursor };
        });
      }

      const off = on('post:new', (post) => {
        if (post.channelId !== channelId) return;
        const feed = wrap.querySelector('.feed');
        if (feed && !feed.querySelector('[data-post="' + post.id + '"]')) {
          const card = renderPost(post, { showWhere: false });
          feed.prepend(card);
          playArrival(card);
        }
      });
      el._cleanup = () => { off(); focusOn(null); };
    } catch (err) {
      clear(wrap);
      wrap.append(errorState(err.message, () => nav.replace('/c/' + channelId)));
    }
  })();

  return el;
}

/* ------------------------------ 서버 탐색 ------------------------------ */

export function discoverView() {
  const list = h('div');
  list.append(skeletonFeed(3));

  (async () => {
    try {
      const { guilds } = await api.discover();
      clear(list);
      if (!guilds.length) {
        list.append(emptyState('compass', '새로 가입할 서버가 없습니다',
          '이미 Fuse에서 볼 수 있는 서버에 모두 들어가 있습니다.'));
        return;
      }
      for (const g of guilds) {
        const btn = h('button', { class: 'btn', type: 'button', text: '가입' });
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          btn.disabled = true;
          btn.textContent = '가입 중…';
          try {
            await api.joinGuild(g.id);
            btn.textContent = '가입됨';
            toast(g.name + ' 에 가입했습니다.');
            const me = await api.me();
            state.guilds = me.guilds;
            emit('guilds', me.guilds);
          } catch (err) {
            toast(err.message, { error: true });
            btn.disabled = false;
            btn.textContent = '가입';
          }
        });
        list.append(h('div', { class: 'result-row' },
          h('img', { class: 'rr-icon', src: g.icon || '', alt: '' }),
          h('div', { class: 'rr-main' },
            h('b', { text: g.name }),
            h('small', { text: g.description || (g.memberCount ? g.memberCount.toLocaleString('ko-KR') + '명' : '') })),
          btn));
      }
    } catch (err) {
      clear(list);
      list.append(errorState(err.message, () => nav.replace('/discover')));
    }
  })();

  return view(topbar({ title: '서버 둘러보기', back: true }), list);
}

/* ------------------------------- 쪽지 ------------------------------- */

export function dmListView() {
  const list = h('div', { class: 'dm-list' });
  list.append(skeletonFeed(3));

  async function load() {
    try {
      const { conversations } = await api.conversations();
      clear(list);
      if (!conversations.length) {
        list.append(emptyState('mail', '주고받은 쪽지가 없습니다',
          '프로필에서 쪽지 보내기를 누르면 대화가 시작됩니다.'));
        return;
      }
      for (const c of conversations) {
        list.append(h('button', { class: 'dm-row', type: 'button', onClick: () => nav.go('/dm/' + c.user.id) },
          h('img', { class: 'avatar avatar-48', src: c.user.avatar || '', alt: '' }),
          h('div', { class: 'dm-main' },
            h('b', { text: c.user.displayName }),
            h('small', { text: c.last ? (c.last.mine ? '나: ' : '') + c.last.content : '대화를 시작해보세요' })),
          h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '5px' } },
            h('small', { class: 'muted', style: { fontSize: '13px' }, text: c.last ? timeAgo(c.last.at) : '' }),
            c.unread ? h('span', { class: 'dm-unread', text: String(c.unread) }) : null)));
      }
    } catch (err) {
      clear(list);
      list.append(errorState(err.message, load));
    }
  }
  load();

  const el = view(topbar({ title: '쪽지' }), list);
  const off = on('dm', () => load());
  el._cleanup = off;
  return el;
}

export function dmView(userId) {
  const chat = h('div', { class: 'chat' });
  const bar = topbar({ title: '쪽지', back: true });
  const input = h('textarea', { placeholder: '메시지 입력', rows: '1', maxlength: '1800' });
  const sendBtn = h('button', { class: 'send', type: 'button', 'aria-label': '보내기', disabled: true }, morphIcon('up'));

  /* 첨부 */
  const files = [];
  const tray = h('div', { class: 'chat-tray', hidden: true });

  const fileInput = h('input', {
    type: 'file', accept: 'image/*,video/*,audio/*,.pdf,.txt,.zip', multiple: true,
    style: { display: 'none' },
    onChange: (e) => {
      for (const f of e.target.files) {
        if (files.length >= 4) { toast('파일은 4개까지 보낼 수 있습니다.', { error: true }); break; }
        if (f.size > 8 * 1024 * 1024) { toast(f.name + ' 은 8MB를 넘습니다.', { error: true }); continue; }
        files.push(f);
      }
      e.target.value = '';
      renderTray();
    },
  });

  const attachBtn = h('button', {
    class: 'chat-attach', type: 'button', 'aria-label': '사진·파일 첨부',
    onClick: () => fileInput.click(),
  }, icon('image'));

  function renderTray() {
    clear(tray);
    files.forEach((file, i) => {
      const item = h('div', { class: 'tray-item' });
      if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        item.append(h('img', { src: url, alt: file.name, onLoad: () => URL.revokeObjectURL(url) }));
      } else {
        item.append(h('div', { class: 'file-chip' },
          icon(file.type.startsWith('video/') ? 'film' : 'file'),
          h('span', { text: file.name })));
      }
      item.append(h('button', {
        class: 'attach-remove', type: 'button', 'aria-label': '첨부 제거',
        onClick: () => { files.splice(i, 1); renderTray(); },
      }, icon('close')));
      tray.append(item);
    });
    tray.hidden = !files.length;
    sendBtn.disabled = !input.value.trim() && !files.length;
  }

  const el = view(bar, chat,
    h('div', { class: 'chatbar' }, tray,
      h('div', { class: 'chatbar-row' }, attachBtn, input, sendBtn), fileInput));

  let convId = null;

  /** 말풍선 안의 사진·파일 */
  function bubbleMedia(list) {
    if (!list?.length) return null;
    const box = h('div', { class: 'bubble-media' });
    const viewable = list.filter((a) => a.url && (a.isImage || a.isVideo))
      .map((a) => ({ url: a.url, name: a.name || '', video: !!a.isVideo }));
    for (const a of list) {
      if (a.isImage && a.url) {
        box.append(h('img', {
          src: a.url, alt: a.name || '', loading: 'lazy',
          ...(a.width && a.height ? { style: { aspectRatio: a.width + ' / ' + a.height } } : {}),
          onClick: (e) => {
            e.stopPropagation();
            openLightbox(viewable, { index: Math.max(viewable.findIndex((v) => v.url === a.url), 0) });
          },
        }));
      } else if (a.isVideo && a.url) {
        box.append(h('video', { src: a.url, controls: true, preload: 'metadata', playsinline: true }));
      } else {
        box.append(h(a.url ? 'a' : 'div', {
          class: 'bubble-file',
          ...(a.url ? { href: a.url, target: '_blank', rel: 'noopener' } : {}),
        }, icon('file'), h('span', { text: a.name || '파일' })));
      }
    }
    return box;
  }

  function bubble(m, mine) {
    const hasText = !!m.content;
    return h('div', {
      class: 'bubble ' + (mine ? 'mine' : 'theirs') + (hasText ? '' : ' is-media-only'),
      title: fullTime(m.at),
    },
      bubbleMedia(m.attachments),
      hasText ? h('div', { class: 'bubble-text', text: m.content }) : null,
      m.viaDiscord ? h('div', { class: 'bubble-src', text: '디스코드에서 보냄' }) : null);
  }

  function appendMessage(m) {
    const mine = m.from === state.me?.id;
    chat.querySelector('.empty')?.remove();
    const b = bubble(m, mine);
    // 보낸 것은 입력창 쪽에서 튀어오르고, 받은 것은 왼쪽에서 미끄러져 들어온다
    b.classList.add(mine ? 'is-sent' : 'is-received');
    chat.append(b, h('div', { class: 'bubble-time' + (mine ? ' mine' : ''), text: clockTime(m.at) }));
    document.scrollingElement.scrollTo({ top: document.scrollingElement.scrollHeight, behavior: 'smooth' });
  }

  (async () => {
    try {
      const data = await api.conversation(userId);
      convId = data.id;
      clear(chat);
      bar.querySelector('.topbar-title').textContent = data.user.displayName;
      bar.append(h('button', {
        class: 'topbar-action', type: 'button', text: '프로필',
        onClick: () => nav.go('/u/' + userId),
      }));

      if (!data.messages.length) {
        chat.append(emptyState('share', data.user.displayName + ' 님과의 대화',
          '보낸 쪽지는 상대의 디스코드 DM으로도 전달됩니다.'));
      } else {
        for (const m of data.messages) {
          const mine = m.from === state.me?.id;
          chat.append(bubble(m, mine), h('div', { class: 'bubble-time' + (mine ? ' mine' : ''), text: clockTime(m.at) }));
        }
      }
      requestAnimationFrame(() => document.scrollingElement.scrollTo({ top: document.scrollingElement.scrollHeight }));
    } catch (err) {
      clear(chat);
      chat.append(errorState(err.message, () => nav.replace('/dm/' + userId)));
    }
  })();

  autoGrow(input, 140);
  input.addEventListener('input', () => { sendBtn.disabled = !input.value.trim() && !files.length; });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  async function send() {
    const text = input.value.trim();
    if (!text && !files.length) return;

    const form = new FormData();
    form.set('content', text);
    for (const f of files) form.append('files', f);

    input.value = '';
    input.style.height = 'auto';
    files.length = 0;
    renderTray();
    sendBtn.disabled = true;

    // 보내는 동안 버튼이 눌렸다가 튀어오르고, 아이콘이 체크로 잠깐 바뀐다
    sendBtn.classList.add('is-sending');
    setTimeout(() => sendBtn.classList.remove('is-sending'), 420);
    const svg = sendBtn.querySelector('.ic');
    svg?.morphTo?.('check');

    try {
      await api.sendDM(userId, form);
    } catch (err) {
      toast(err.message, { error: true });
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } finally {
      setTimeout(() => svg?.morphTo?.('up'), 520);
    }
  }
  sendBtn.addEventListener('click', send);

  // 내가 보낸 쪽지도 서버 확인 뒤 이 경로로 한 번만 그려진다 (낙관적 추가를 하지 않는 이유)
  const off = on('dm', (payload) => {
    if (convId && payload.conversationId !== convId) return;
    appendMessage(payload.message);
  });
  el._cleanup = off;
  return el;
}

/* ------------------------------- 설정 ------------------------------- */

export function settingsView() {
  const wrap = h('div');

  function switchRow(title, desc, key) {
    const sw = h('div', { class: 'switch' + (state.settings[key] ? ' is-on' : ''), role: 'switch', tabindex: '0', 'aria-checked': String(!!state.settings[key]) });
    const toggle = async () => {
      const next = !state.settings[key];
      sw.classList.toggle('is-on', next);
      sw.setAttribute('aria-checked', String(next));
      state.settings[key] = next;
      try {
        await api.saveSettings({ [key]: next });
        emit('settings', state.settings);
      } catch (err) {
        state.settings[key] = !next;
        sw.classList.toggle('is-on', !next);
        toast(err.message, { error: true });
      }
    };
    const row = h('div', { class: 'setting-row' },
      h('div', { class: 'sr-main' }, h('b', { text: title }), h('small', { text: desc })), sw);
    row.addEventListener('click', toggle);
    sw.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } });
    return row;
  }

  /**
   * 알림 스위치는 브라우저 권한과 묶여 있다.
   * 켤 때 권한을 물어보고, 거부당하면 스위치를 되돌리고 이유를 알려준다.
   */
  function notifyRow() {
    const row = switchRow('알림 받기', '멘션·답글·좋아요·쪽지가 오면 알려줍니다.', 'notifications');
    const sw = row.querySelector('.switch');

    const syncHint = () => {
      const hint = row.querySelector('small');
      if (notifyPermission() === 'denied') {
        hint.textContent = '브라우저에서 이 사이트의 알림이 차단되어 있습니다. 주소창 옆 자물쇠에서 허용해 주세요.';
      } else if (notifyPermission() === 'unsupported') {
        hint.textContent = '이 브라우저는 알림을 지원하지 않아 앱 안에서만 표시됩니다.';
      }
    };
    syncHint();

    row.addEventListener('click', async () => {
      // switchRow 의 클릭 처리가 먼저 값을 뒤집으므로, 켜진 뒤에만 권한을 묻는다
      if (!state.settings.notifications) return;
      const result = await requestNotifyPermission();
      if (result === 'denied') {
        toast('브라우저가 알림을 막고 있어 앱 안에서만 표시됩니다.', { error: true });
      }
      syncHint();
      sw.classList.toggle('is-on', !!state.settings.notifications);
    });

    return row;
  }

  function segmentRow(title, desc, key, options) {
    const seg = h('div', { class: 'segment' });
    const ink = h('div', { class: 'segment-ink' });
    const buttons = options.map(([value, label]) => h('button', {
      class: 'segment-btn' + (state.settings[key] === value ? ' is-active' : ''), type: 'button', text: label,
      onClick: async (e) => {
        e.stopPropagation();
        buttons.forEach((b) => b.classList.remove('is-active'));
        e.currentTarget.classList.add('is-active');
        place(e.currentTarget);
        state.settings[key] = value;
        try {
          await api.saveSettings({ [key]: value });
          emit('settings', state.settings);
        } catch (err) { toast(err.message, { error: true }); }
      },
    }));
    seg.append(ink, ...buttons);

    function place(btn) {
      ink.style.width = btn.offsetWidth + 'px';
      ink.style.transform = 'translateX(' + (btn.offsetLeft - 3) + 'px)';
    }
    whenSized(seg, () => place(buttons.find((b) => b.classList.contains('is-active')) || buttons[0]));

    return h('div', { class: 'setting-row' },
      h('div', { class: 'sr-main' }, h('b', { text: title }), h('small', { text: desc })), seg);
  }

  wrap.append(h('div', { class: 'section-label', text: '화면' }));
  wrap.append(segmentRow('테마', '시스템 설정을 따르거나 직접 고를 수 있습니다.', 'theme',
    [['system', '시스템'], ['light', '라이트'], ['dark', '다크']]));
  wrap.append(switchRow('애니메이션 줄이기', '화면 전환과 등장 효과를 최소화합니다.', 'reduceMotion'));
  wrap.append(switchRow('촘촘하게 보기', '글 사이 여백을 줄입니다.', 'compact'));

  wrap.append(h('div', { class: 'section-label', text: '알림' }));
  wrap.append(notifyRow());

  wrap.append(h('div', { class: 'section-label', text: '피드' }));
  wrap.append(switchRow('시스템 메시지 보기', '입장·부스트 같은 디스코드 알림 메시지도 피드에 표시합니다.', 'showSystemMessages'));
  wrap.append(switchRow('GIF 자동 재생', '움직이는 이미지를 자동으로 재생합니다.', 'autoplayGifs'));

  wrap.append(h('div', { class: 'section-label', text: '계정' }));
  wrap.append(h('button', {
    class: 'setting-row', type: 'button',
    onClick: () => nav.go('/u/' + state.me.id),
  }, h('img', { class: 'avatar avatar-36', src: state.me?.avatar || '', alt: '' }),
     h('div', { class: 'sr-main' }, h('b', { text: state.me?.displayName || '' }), h('small', { text: '@' + (state.me?.username || '') })),
     icon('right', 'muted')));

  wrap.append(h('button', {
    class: 'setting-row', type: 'button',
    onClick: async () => {
      await api.logout();
      location.href = '/login.html';
    },
  }, h('div', { class: 'sr-main' }, h('b', { text: '로그아웃', style: 'color:var(--danger)' }))));

  if (state.demo) {
    wrap.append(h('div', { class: 'section-label', text: '실행 모드' }));
    wrap.append(h('div', { class: 'setting-row' },
      h('div', { class: 'sr-main' },
        h('b', { text: '데모 모드로 실행 중' }),
        h('small', { text: '디스코드에 접속하지 않고 예시 데이터로 동작합니다. .env에 봇 토큰과 OAuth 정보를 넣으면 실제 서버에 연결됩니다.' }))));
  }

  return view(topbar({ title: '설정', back: true }), wrap);
}

export { topbar, view, emptyState, errorState, makeTabs };

/* ----------------------------- 북마크 ----------------------------- */

/**
 * 담아둔 글을 모아 본다.
 *
 * 좋아요와 달리 남에게 보이지 않는다 — 그래서 서버별로 나누지 않고
 * 담은 순서대로만 쌓는다. 나중에 다시 볼 것들이라 최근 것이 위다.
 */
export function bookmarksView() {
  const wrap = h('div');
  const el = view(topbar({ title: '북마크', back: true }), wrap);

  async function load() {
    clear(wrap);
    wrap.append(skeletonFeed(3));
    try {
      const { posts } = await api.bookmarks();
      clear(wrap);
      if (!posts.length) {
        wrap.append(emptyState('bookmark', '아직 담아둔 글이 없습니다',
          '글의 북마크 아이콘을 누르면 여기에 모입니다. 나만 볼 수 있습니다.'));
        return;
      }
      wrap.append(renderFeedList(posts));
    } catch (err) {
      clear(wrap);
      wrap.append(errorState(err.message, load));
    }
  }

  load();

  // 이 화면에서 북마크를 빼면 그 카드는 자리에서 사라져야 한다
  const off = on('bookmarks:changed', ({ channelId, id, saved }) => {
    if (saved) return;
    const card = wrap.querySelector('[data-post="' + id + '"]');
    if (!card) return;
    card.style.transition = 'opacity .2s, transform .2s';
    card.style.opacity = '0';
    card.style.transform = 'scale(.98)';
    setTimeout(() => {
      card.remove();
      if (!wrap.querySelector('.post')) load();
    }, 200);
  });

  el._cleanup = () => off();
  return el;
}
