/* Fuse 앱 셸 + 라우터 */

import { h, icon, clear, logoSvg, preloadMorph } from './dom.js';
import { api } from './api.js';
import { state, nav, on, emit } from './state.js';
import { connect } from './live.js';
import { openComposer, wireComposeEvents, composeView } from './compose.js';
import { patchPostEl, removePostEl, forEachPostEl, refreshMetaCounts } from './post.js';
import { view, topbar, emptyState } from './ui.js';
import { wireNotifications, restoreTitle } from './notify.js';
import * as views from './views.js';

/* ------------------------------ 테마 ------------------------------ */

const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const root = document.documentElement;
  const theme = state.settings.theme || 'system';
  root.dataset.theme = theme;
  root.classList.toggle('is-dark', theme === 'system' && darkQuery.matches);
  root.dataset.motion = state.settings.reduceMotion ? 'off' : 'on';
  root.dataset.compact = state.settings.compact ? 'on' : 'off';
  // 다음 방문에서 테마가 번쩍이지 않도록 기억해 둔다
  try { localStorage.setItem('fuse:theme', theme); } catch { /* 저장소 접근 불가 */ }
}
darkQuery.addEventListener('change', applyTheme);

const prefersReducedMotion = () =>
  state.settings.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------ 라우팅 ------------------------------ */

const ROUTES = [
  [/^\/$/, () => views.homeView()],
  [/^\/search$/, () => views.searchView(new URLSearchParams(location.search).get('q') || '')],
  [/^\/activity$/, () => views.activityView()],
  [/^\/discover$/, () => views.discoverView()],
  [/^\/settings$/, () => views.settingsView()],
  [/^\/dm$/, () => views.dmListView()],
  [/^\/dm\/([^/]+)$/, (m) => views.dmView(m[1])],
  [/^\/u\/([^/]+)$/, (m) => views.profileView(m[1])],
  [/^\/g\/([^/]+)$/, (m) => views.guildView(m[1])],
  [/^\/c\/([^/]+)$/, (m) => views.channelView(m[1])],
  [/^\/p\/([^/]+)\/([^/]+)$/, (m) => views.postView(m[1], m[2], takeSeed())],
  [/^\/compose$/, () => composeView(location.search)],
];

let currentEl = null;
let seed = null;
const scrollMemory = new Map();

function takeSeed() {
  const s = seed;
  seed = null;
  return s;
}

function resolve(pathname) {
  for (const [re, build] of ROUTES) {
    const m = pathname.match(re);
    if (m) return () => build(m);
  }
  return () => view(
    topbar({ title: '없는 페이지', back: true }),
    emptyState('compass', '페이지를 찾을 수 없습니다', '주소를 다시 확인해 주세요.'),
  );
}

const main = h('main', { class: 'main' });
const column = h('div', { class: 'column', id: 'column' });
main.append(column);

function paint(pathname) {
  currentEl?._cleanup?.();
  document.querySelector('.menu')?.remove();
  document.querySelector('.emoji-pop')?.remove();

  const build = resolve(pathname);
  let next;
  try {
    next = build();
  } catch (err) {
    // 화면 하나가 터져도 이전 화면이 유령처럼 남지 않도록 여기서 받아낸다
    console.error('[router] 화면을 그리지 못했습니다:', err);
    next = view(
      topbar({ title: '오류', back: true }),
      emptyState('frown', '화면을 열지 못했습니다', err?.message || '알 수 없는 오류'),
    );
  }
  clear(column);
  column.append(next);
  currentEl = next;
  syncNav(pathname);

  // 스크롤은 바로 맞춘다. rAF 로 미루면 뒤이어 재는 위치가 어긋나
  // (카드가 위로 올라가는 전환처럼) 좌표를 쓰는 애니메이션이 틀어진다.
  const saved = scrollMemory.get(history.state?.key);
  document.scrollingElement.scrollTo({ top: saved || 0, behavior: 'instant' });
}

/**
 * 누른 글이 목록에 있던 자리에서 상세 화면 맨 위로 올라가는 전환.
 *
 * View Transition 은 화면 전체를 크로스페이드하지만, 우리가 원하는 건
 * "그 카드만 위로 미끄러지고 나머지가 뒤따라 펼쳐지는" 움직임이라
 * 카드 위치를 직접 재서 FLIP 으로 붙인다.
 */
function riseToTop(fromEl) {
  if (!fromEl) return null;
  const from = fromEl.getBoundingClientRect();

  return () => {
    const target = column.querySelector('[data-morph-target]');
    if (!target) return;
    const to = target.getBoundingClientRect();

    const dy = from.top - to.top;
    const dx = from.left - to.left;
    const scale = to.width ? from.width / to.width : 1;
    if (Math.abs(dy) < 2 && Math.abs(dx) < 2) return;

    target.animate(
      [
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale.toFixed(4) + ')' },
        { transform: 'none' },
      ],
      { duration: 460, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
    );

    // 아래 내용은 카드를 뒤따라 살짝 늦게 펼쳐진다
    let delay = 40;
    for (const node of [...target.parentElement.children]) {
      if (node === target || node.contains(target)) continue;
      node.animate(
        [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }],
        { duration: 380, delay, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'backwards' },
      );
      delay += 45;
    }
  };
}

/* 화면 전환 시 요소가 서로 이어지도록 이름을 붙였다 뗀다 */
const MORPH = [
  ['.avatar', 'morph-avatar'],
  ['.post-author', 'morph-author'],
  ['.post-content', 'morph-content'],
];

function tagMorph(root) {
  if (!root) return;
  for (const [sel, name] of MORPH) {
    const el = root.querySelector(sel);
    if (el) el.style.viewTransitionName = name;
  }
}

function untagMorph() {
  for (const [, name] of MORPH) {
    for (const el of document.querySelectorAll('[style*="' + name + '"]')) {
      el.style.removeProperty('view-transition-name');
    }
  }
}

function transition(run, morphFrom) {
  // 글 카드에서 출발할 때는 화면 크로스페이드 대신 카드가 위로 올라가는 움직임을 쓴다
  const rise = morphFrom?.classList?.contains('post') ? riseToTop(morphFrom) : null;

  if (rise) {
    run();
    untagMorph();
    // 바로 실행한다 — getBoundingClientRect 가 레이아웃을 강제하므로 rAF 를 기다릴 필요가 없고,
    // 기다리면 백그라운드 탭에서는 아예 실행되지 않는다.
    if (!prefersReducedMotion()) rise();
    return;
  }

  if (!document.startViewTransition || prefersReducedMotion()) {
    run();
    untagMorph();
    return;
  }
  tagMorph(morphFrom);
  const t = document.startViewTransition(() => {
    run();
    // 새 화면 쪽 짝을 즉시 붙여줘야 두 요소가 이어진다
    tagMorph(column.querySelector('[data-morph-target]'));
  });
  // 전환이 중간에 취소될 수 있다 (빠른 연속 이동, 백그라운드 탭 등).
  // 세 프로미스를 모두 받아줘야 처리되지 않은 거부가 콘솔을 더럽히지 않는다.
  t.finished.then(untagMorph, untagMorph);
  t.ready.catch(() => {});
  t.updateCallbackDone.catch(() => {});
}

function rememberScroll() {
  if (history.state?.key) scrollMemory.set(history.state.key, document.scrollingElement.scrollTop);
}

nav.go = (path, opts = {}) => {
  if (path === location.pathname + location.search) return;
  rememberScroll();
  if (opts.seed) seed = opts.seed;
  const key = Math.random().toString(36).slice(2);
  transition(() => {
    history.pushState({ key }, '', path);
    paint(location.pathname);
  }, opts.morphFrom);
};

nav.replace = (path) => {
  rememberScroll();
  transition(() => {
    history.replaceState(history.state || {}, '', path);
    paint(location.pathname);
  });
};

nav.back = () => {
  if (history.length > 1) history.back();
  else nav.go('/');
};

addEventListener('popstate', () => {
  transition(() => paint(location.pathname));
});

/* 앱 안 링크는 새로고침 없이 이동 */
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-nav]');
  if (!link) return;
  const url = new URL(link.href, location.origin);
  if (url.origin !== location.origin) return;
  e.preventDefault();
  nav.go(url.pathname + url.search);
});

/* ------------------------------ 내비게이션 ------------------------------ */

const NAV_ITEMS = [
  { path: '/', icon: 'home', label: '홈' },
  { path: '/search', icon: 'search', label: '검색' },
  { path: null, icon: 'plus', label: '새 글', action: () => openComposer(), accent: true },
  { path: '/activity', icon: 'heart', label: '알림', badge: true },
  { path: 'profile', icon: 'user', label: '프로필' },
];

const navGroups = []; // { buttons, pill } — 레일과 탭바 두 벌
const railLinks = []; // 레일 아래쪽 바로가기 (쪽지·설정)

const targetOf = (item) => (item.path === 'profile' ? '/u/' + state.me?.id : item.path);

function makeNavButton(item, { labelled = false } = {}) {
  const badge = h('span', { class: 'badge', hidden: true });
  const btn = h('button', {
    class: 'nav-btn' + (item.accent ? ' nav-accent' : ''),
    type: 'button', 'aria-label': item.label, title: item.label,
    onClick: () => {
      if (item.action) return item.action();
      const target = targetOf(item);
      if (location.pathname === target) {
        document.scrollingElement.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        nav.go(target);
      }
    },
  },
    h('span', { class: 'nav-ico' }, icon(item.icon), item.badge ? badge : null),
    labelled ? h('span', { class: 'nav-label', text: item.label }) : null);

  btn._item = item;
  btn._badge = item.badge ? badge : null;
  return btn;
}

/** 애플 탭바처럼 활성 항목 뒤로 알약이 미끄러진다 */
function makeNavGroup(className, { labelled = false } = {}) {
  const pill = h('div', { class: 'nav-pill', hidden: true });
  const buttons = NAV_ITEMS.map((item) => makeNavButton(item, { labelled }));
  const bar = h('nav', { class: className }, pill, ...buttons);
  const group = { bar, pill, buttons, labelled };
  navGroups.push(group);
  return bar;
}

function placePill(group, btn) {
  const { pill } = group;
  if (!btn || !btn.offsetWidth) { pill.hidden = true; return; }
  const target = btn.querySelector('.nav-ico') || btn;
  pill.hidden = false;
  pill.style.width = target.offsetWidth + 'px';
  pill.style.height = target.offsetHeight + 'px';
  pill.style.transform = 'translate(' + (btn.offsetLeft + target.offsetLeft) + 'px,'
    + (btn.offsetTop + target.offsetTop) + 'px)';
}

function syncNav(pathname) {
  for (const btn of railLinks) {
    const active = !!btn._path && pathname.startsWith(btn._path);
    btn.classList.toggle('is-active', active);
    btn.querySelector('.ic')?.classList.toggle('is-filled', active);
  }

  for (const group of navGroups) {
    let activeBtn = null;
    for (const btn of group.buttons) {
      const target = targetOf(btn._item);
      const active = !!target && pathname === target;
      btn.classList.toggle('is-active', active);
      btn.querySelector('.ic')?.classList.toggle('is-filled', active);
      if (active) activeBtn = btn;
    }
    // 알약이 처음 놓일 때는 미끄러지지 않게 (레이아웃 전 0에서 날아오는 것 방지)
    if (group.pill.hidden && activeBtn) group.pill.style.transition = 'none';
    placePill(group, activeBtn);
    if (group.pill.style.transition === 'none') {
      requestAnimationFrame(() => group.pill.style.removeProperty('transition'));
      setTimeout(() => group.pill.style.removeProperty('transition'), 60);
    }
  }
}

addEventListener('resize', () => syncNav(location.pathname));

function syncBadge() {
  const n = state.unread;
  for (const group of navGroups) {
    for (const btn of group.buttons) {
      if (!btn._badge) continue;
      btn._badge.hidden = !n;
      btn._badge.textContent = n > 99 ? '99+' : String(n);
      if (n) {
        btn._badge.classList.add('pop');
        setTimeout(() => btn._badge.classList.remove('pop'), 240);
      }
    }
  }
}

function buildRail() {
  const logo = h('a', {
    class: 'rail-logo', href: '/', 'aria-label': 'Fuse 홈',
    onClick: (e) => { e.preventDefault(); nav.go('/'); },
  }, logoSvg());

  // 쪽지와 설정은 메뉴 안에 숨기지 않는다 — 자주 쓰는 곳이라 바로 보여야 한다
  const railLink = (iconName, label, path) => {
    const btn = h('button', {
      class: 'nav-btn rail-link', type: 'button', 'aria-label': label, title: label,
      onClick: () => nav.go(path),
    }, h('span', { class: 'nav-ico' }, icon(iconName)));
    btn._path = path;
    railLinks.push(btn);
    return btn;
  };

  const moreBtn = h('button', {
    class: 'nav-btn rail-link', type: 'button', 'aria-label': '더보기', title: '더보기',
    onClick: async (e) => {
      // currentTarget 은 이벤트 처리가 끝나면 null 이 된다. await 하기 전에 붙잡아 둔다.
      const anchor = e.currentTarget;
      const { openMenu } = await import('./dom.js');
      openMenu(anchor, [
        { icon: 'compass', label: '서버 둘러보기', onSelect: () => nav.go('/discover') },
        '-',
        { icon: 'logout', label: '로그아웃', danger: true,
          onSelect: async () => { await api.logout(); location.href = '/login.html'; } },
      ]);
    },
  }, h('span', { class: 'nav-ico' }, icon('menu')));

  return h('div', { class: 'rail' },
    logo,
    makeNavGroup('rail-nav'),
    h('div', { class: 'rail-foot' },
      railLink('mail', '쪽지', '/dm'),
      railLink('settings', '설정', '/settings'),
      moreBtn));
}

function buildMobileBar() {
  const mark = logoSvg();
  return h('div', { class: 'mobilebar' },
    h('button', {
      class: 'bar-btn', type: 'button', 'aria-label': '쪽지',
      onClick: () => nav.go('/dm'),
    }, icon('mail')),
    h('a', { class: 'mobilebar-logo', href: '/', 'aria-label': 'Fuse 홈', onClick: (e) => { e.preventDefault(); nav.go('/'); } }, mark),
    h('button', {
      class: 'bar-btn', type: 'button', 'aria-label': '설정',
      onClick: () => nav.go('/settings'),
    }, icon('settings')));
}

/** 애플 스타일 떠 있는 유리 탭바 — 아이콘만 */
function buildTabbar() {
  return h('div', { class: 'tabdock' }, makeNavGroup('tabbar'));
}

/* ------------------------------ 전역 이벤트 ------------------------------ */

function wireGlobalEvents() {
  on('post:patch', (post) => patchPostEl(post));
  on('post:remove', (ref) => removePostEl(ref));

  on('post:like', (data) => {
    forEachPostEl(data.channelId + ':' + data.id, (el) => {
      const btn = el.querySelector('.act-like');
      if (!btn) return;
      const label = btn.querySelector('.act-count');
      if (label) label.textContent = data.likeCount ? String(data.likeCount) : '';
      if (data.liked !== undefined) {
        btn.classList.toggle('is-on', data.liked);
        btn.querySelector('.ic')?.classList.toggle('is-filled', data.liked);
      }
      if (el._post) {
        el._post.likeCount = data.likeCount;
        if (data.liked !== undefined) el._post.liked = data.liked;
        refreshMetaCounts(el, el._post);
      }
    });
  });

  on('post:created', (post) => {
    // 내가 쓴 글은 서버 브로드캐스트보다 먼저 도착하므로 여기서 반영한다
    if (location.pathname === '/') emit('post:new', post);
  });

  on('activity:new', () => syncBadge());
  on('unread', () => { syncBadge(); restoreTitle(); });
  on('settings', () => applyTheme());

  on('guilds', (guilds) => { state.guilds = guilds; });

  on('live:status', (status) => {
    document.documentElement.dataset.live = status;
  });
}

/* 스크롤에 따라 상단바 경계선을 켠다 */
function wireStickyHeader() {
  const update = () => {
    const scrolled = document.scrollingElement.scrollTop > 4;
    for (const bar of document.querySelectorAll('.topbar')) bar.classList.toggle('is-stuck', scrolled);
  };
  addEventListener('scroll', update, { passive: true });
  update();
}

/* 스포일러 열기 */
document.addEventListener('click', (e) => {
  const spoiler = e.target.closest('.post-content .spoiler');
  if (spoiler) {
    e.stopPropagation();
    spoiler.classList.toggle('is-open');
  }
});

/* 단축키 */
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'n') { e.preventDefault(); openComposer(); }
  if (e.key === '/') { e.preventDefault(); nav.go('/search'); }
  if (e.key === 'g') { e.preventDefault(); nav.go('/'); }
});

/* ------------------------------ 부팅 ------------------------------ */

async function boot() {
  let me;
  try {
    me = await api.me();
  } catch (err) {
    if (err.status === 401) return; // api.js 가 로그인 화면으로 보낸다
    document.body.append(h('div', { class: 'login' },
      h('div', { class: 'login-card' },
        h('div', { class: 'error', text: err.message }),
        h('button', { class: 'pill', type: 'button', text: '다시 시도', onClick: () => location.reload() }))));
    return;
  }

  state.me = me.user;
  state.guilds = me.guilds;
  state.settings = me.settings;
  state.unread = me.unread;
  state.demo = me.demo;
  state.bot = me.bot;

  applyTheme();
  preloadMorph(); // 아이콘 모핑 런타임을 미리 받아둔다 (첫 클릭이 끊기지 않게)

  // 모바일 상단바는 컬럼 밖에 둔다 — 화면을 갈아끼울 때 살아남아야 한다
  main.prepend(buildMobileBar());
  const shell = h('div', { class: 'shell' }, buildRail(), main);
  document.body.append(shell, buildTabbar());

  wireGlobalEvents();
  wireComposeEvents();
  wireNotifications();
  wireStickyHeader();
  syncBadge();
  restoreTitle();

  if (!history.state?.key) history.replaceState({ key: 'root' }, '', location.pathname + location.search);
  paint(location.pathname);
  connect();
}

boot();
