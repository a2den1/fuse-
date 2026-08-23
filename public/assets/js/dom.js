/* 작은 DOM 헬퍼 — 프레임워크 없이 뷰를 조립한다 */

import { ICONS, ICON_GRID } from './icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'html') el.innerHTML = value;
      else if (key === 'text') el.textContent = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, value);
    }
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function frag(...children) {
  return append(document.createDocumentFragment(), children);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ------------------------------ 아이콘 ------------------------------ */

/**
 * 스트로크 아이콘 하나를 그린다 (Lucide 경로, 24x24 그리드).
 * 이모지 대신 이걸 쓴다 — 굵기·색이 글자와 함께 움직이고 어느 플랫폼에서나 같게 보인다.
 */
export function icon(name, extra = '') {
  const d = ICONS[name];
  if (!d && name) console.warn('[icon] 없는 아이콘:', name);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + ICON_GRID + ' ' + ICON_GRID);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'ic' + (extra ? ' ' + extra : ''));

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d || '');
  svg.append(path);
  svg.dataset.icon = name;
  return svg;
}

/* morphicons 런타임은 처음 필요할 때 한 번만 받아온다 */
let morphLib = null;
export function preloadMorph() {
  morphLib ||= import('/vendor/morphicons/dom.js').catch((err) => {
    console.warn('[icon] 모핑 라이브러리를 불러오지 못했습니다:', err.message);
    return null;
  });
  return morphLib;
}

/**
 * 모양이 바뀌는 아이콘. `el.morphTo('close')` 로 다른 아이콘으로 흘러간다.
 * 라이브러리가 아직 안 왔으면 즉시 교체해서 동작 자체는 끊기지 않게 한다.
 */
export function morphIcon(name, extra = '') {
  const svg = icon(name, extra);
  const path = svg.firstElementChild;
  let controller = null;
  let current = name;

  svg.morphTo = async (next, spring = 'snappy') => {
    if (next === current) return;
    const target = ICONS[next] || next;
    current = next;
    svg.dataset.icon = next;

    const lib = await preloadMorph();
    if (!lib) { path.setAttribute('d', target); return; }
    controller ||= lib.createMorph(path, ICONS[name] || name);
    controller.morphTo(target, spring);
  };

  svg.destroyMorph = () => { controller?.destroy(); controller = null; };
  return svg;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/* ------------------------------ 로고 ------------------------------ */

export const LOGO_VIEWBOX = '0 0 128 170';
export const LOGO_F = 'M56.3463 133.03L37.5303 44.5078L97.0139 31.8642L100.496 48.2482L61.0037 56.6426L65.188 76.3278L100.829 68.752L104.299 85.0749L68.6575 92.6507L76.3372 128.781L56.3463 133.03Z';
export const LOGO_SWOOSH = 'M66.9836 130.769C70.83 148.865 13.6884 154.721 24.1579 116.869C37.3929 69.019 115.393 135.519 115.393 135.519';

export function logoSvg(className = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', LOGO_VIEWBOX);
  svg.setAttribute('fill', 'none');
  if (className) svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');

  const f = document.createElementNS(SVG_NS, 'path');
  f.setAttribute('d', LOGO_F);
  f.setAttribute('fill', 'currentColor');

  const swoosh = document.createElementNS(SVG_NS, 'path');
  swoosh.setAttribute('d', LOGO_SWOOSH);
  swoosh.setAttribute('stroke', 'currentColor');
  swoosh.setAttribute('stroke-width', '19');
  swoosh.setAttribute('fill', 'none');

  svg.append(f, swoosh);
  return svg;
}

/* ------------------------------ 시간 ------------------------------ */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 0) return '방금';
  if (diff < MIN) return '방금';
  if (diff < HOUR) return Math.floor(diff / MIN) + '분';
  if (diff < DAY) return Math.floor(diff / HOUR) + '시간';
  if (diff < 7 * DAY) return Math.floor(diff / DAY) + '일';
  if (diff < 365 * DAY) return Math.floor(diff / (7 * DAY)) + '주';
  return Math.floor(diff / (365 * DAY)) + '년';
}

export function fullTime(ts) {
  return new Date(ts).toLocaleString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function clockTime(ts) {
  return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

export function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return '오늘';
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

/* ------------------------------ 숫자 ------------------------------ */

export function compact(n) {
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + '천';
  if (n < 100_000_000) return Math.floor(n / 10_000) + '만';
  return Math.floor(n / 100_000_000) + '억';
}

/* ------------------------------ 토스트 ------------------------------ */

let toaster = null;

export function toast(message, { error = false, duration = 2600 } = {}) {
  if (!toaster) {
    toaster = h('div', { class: 'toaster', role: 'status', 'aria-live': 'polite' });
    document.body.append(toaster);
  }
  const node = h('div', { class: 'toast' + (error ? ' is-error' : ''), text: message });
  toaster.append(node);
  setTimeout(() => {
    node.classList.add('is-out');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    // 애니메이션이 돌지 않는 환경에서도 반드시 사라지게
    setTimeout(() => node.remove(), 400);
  }, duration);
  return node;
}

/* ---------------------------- 오버레이 공통 ---------------------------- */

export function openOverlay(buildContent, { onClose } = {}) {
  const overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' });
  const close = (result) => {
    if (overlay.dataset.closing) return;
    overlay.dataset.closing = '1';
    overlay.classList.add('is-closing');
    const done = () => {
      overlay.remove();
      document.body.style.removeProperty('overflow');
      onClose?.(result);
    };
    overlay.addEventListener('animationend', done, { once: true });
    setTimeout(done, 320); // 애니메이션이 없을 때의 안전장치
  };

  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  };
  overlay.addEventListener('keydown', onKey);

  overlay.append(buildContent(close));
  document.body.append(overlay);
  document.body.style.overflow = 'hidden';

  // 첫 포커스 대상
  const focusable = overlay.querySelector('textarea, input, button');
  focusable?.focus({ preventScroll: true });

  return { overlay, close };
}

/* ------------------------------ 메뉴 ------------------------------ */

export function openMenu(anchor, items) {
  // 붙일 기준이 없으면 메뉴를 띄우지 않는다 — 화면 구석에 떠 있는 것보다 낫다
  if (!anchor?.getBoundingClientRect) {
    console.warn('[menu] 기준 요소가 없어 메뉴를 열지 않았습니다.');
    return () => {};
  }
  document.querySelector('.menu')?.remove();
  const menu = h('div', { class: 'menu', role: 'menu' });

  for (const item of items) {
    if (item === '-') { menu.append(h('hr')); continue; }
    menu.append(h('button', {
      class: item.danger ? 'danger' : '',
      role: 'menuitem',
      onClick: (e) => { e.stopPropagation(); close(); item.onSelect?.(); },
    }, icon(item.icon), h('span', { text: item.label })));
  }

  const close = () => {
    menu.remove();
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', close, true);
  };
  const outside = (e) => { if (!menu.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  document.body.append(menu);

  const rect = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = rect.right - mw;
  let top = rect.bottom + 6;
  if (left < 8) left = 8;
  if (left + mw > innerWidth - 8) left = innerWidth - mw - 8;
  if (top + mh > innerHeight - 8) top = Math.max(8, rect.top - mh - 6);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';

  setTimeout(() => {
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', close, true);
  }, 0);

  return close;
}

/* ---------------------------- textarea 자동 높이 ---------------------------- */

export function autoGrow(textarea, max = 220) {
  const resize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, max) + 'px';
  };
  textarea.addEventListener('input', resize);
  requestAnimationFrame(resize);
  return resize;
}

/* ------------------------------ 라이트박스 ------------------------------ */

export function openLightbox(src, { video = false } = {}) {
  const box = h('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true' });
  const media = video
    ? h('video', { src, controls: true, autoplay: true, playsinline: true })
    : h('img', { src, alt: '' });
  const close = () => {
    box.remove();
    document.body.style.removeProperty('overflow');
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  box.append(media, h('button', { class: 'lb-close', 'aria-label': '닫기', onClick: close }, icon('close')));
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(box);
  document.body.style.overflow = 'hidden';
}
