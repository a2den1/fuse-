/*
 * 알림.
 *
 * 앱이 앞에 떠 있으면 화면 위쪽에 카드로 띄우고,
 * 다른 탭에 가 있거나 창이 내려가 있으면 브라우저 알림으로 보낸다.
 */

import { h, icon } from './dom.js';
import { state, nav, on } from './state.js';
import { plainText } from './markdown.js';

const COPY = {
  like: ['heart', 'kind-like', '님이 회원님의 글을 좋아합니다'],
  reply: ['reply', 'kind-reply', '님이 답글을 남겼습니다'],
  mention: ['at', 'kind-mention', '님이 회원님을 언급했습니다'],
  dm: ['mail', 'kind-dm', '님이 쪽지를 보냈습니다'],
};

let deck = null;

export function canNotify() {
  return typeof Notification !== 'undefined';
}

export function notifyPermission() {
  return canNotify() ? Notification.permission : 'unsupported';
}

/** 설정에서 켤 때 호출 — 브라우저 권한 창을 띄운다 */
export async function requestNotifyPermission() {
  if (!canNotify()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

const pathOf = (item) => (item.kind === 'dm'
  ? '/dm/' + item.actor.id
  : item.channelId && item.targetId ? '/p/' + item.channelId + '/' + item.targetId : '/activity');

/* --------------------------- 화면 안 알림 --------------------------- */

function showInApp(item) {
  if (!deck) {
    deck = h('div', { class: 'notice-deck', role: 'status', 'aria-live': 'polite' });
    document.body.append(deck);
  }
  const [iconName, kindClass, phrase] = COPY[item.kind] || COPY.mention;

  const card = h('button', {
    class: 'notice', type: 'button',
    onClick: () => { close(); nav.go(pathOf(item)); },
  },
    h('div', { class: 'notice-av' },
      h('img', { class: 'avatar avatar-36', src: item.actor?.avatar || '', alt: '' }),
      h('div', { class: 'kind ' + kindClass }, icon(iconName))),
    h('div', { class: 'notice-main' },
      h('div', { class: 'notice-line' }, h('b', { text: item.actor?.displayName || '누군가' }), phrase),
      item.excerpt ? h('div', { class: 'notice-excerpt', text: plainText(item.excerpt) }) : null));

  const close = () => {
    if (card.dataset.closing) return;
    card.dataset.closing = '1';
    card.classList.add('is-out');
    const gone = () => card.remove();
    card.addEventListener('animationend', gone, { once: true });
    setTimeout(gone, 400);
  };

  deck.append(card);
  setTimeout(close, 5200);
  return card;
}

/* --------------------------- 브라우저 알림 --------------------------- */

function showSystem(item) {
  if (!canNotify() || Notification.permission !== 'granted') return false;
  const [, , phrase] = COPY[item.kind] || COPY.mention;
  try {
    const n = new Notification((item.actor?.displayName || '누군가') + phrase, {
      body: plainText(item.excerpt || '').slice(0, 120),
      icon: item.actor?.avatar || '/assets/img/favicon.svg',
      badge: '/assets/img/favicon.svg',
      tag: 'fuse-' + item.kind + '-' + (item.targetId || item.id),
      renotify: false,
    });
    n.onclick = () => {
      window.focus();
      nav.go(pathOf(item));
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------ 배선 ------------------------------ */

export function wireNotifications() {
  on('activity:new', (item) => {
    if (!item) return;
    if (state.settings.notifications === false) return;

    // 보고 있으면 화면 안에서, 아니면 시스템 알림으로
    if (document.visibilityState === 'visible') showInApp(item);
    else if (!showSystem(item)) showInApp(item);

    bumpTitle();
  });

  on('dm', (payload) => {
    // 쪽지 화면을 보고 있는 중이면 알림이 겹치므로 건너뛴다
    if (location.pathname.startsWith('/dm/')) return;
    if (payload?.message?.from === state.me?.id) return;
    bumpTitle();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') restoreTitle();
  });
}

/* 안 읽은 수를 탭 제목에도 얹는다 */
const BASE_TITLE = 'Fuse';

export function bumpTitle() {
  const n = state.unread;
  document.title = n > 0 ? '(' + (n > 99 ? '99+' : n) + ') ' + BASE_TITLE : BASE_TITLE;
}

export function restoreTitle() {
  document.title = state.unread > 0 ? '(' + (state.unread > 99 ? '99+' : state.unread) + ') ' + BASE_TITLE : BASE_TITLE;
}

export { showInApp };
