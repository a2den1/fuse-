/* 화면들이 함께 쓰는 조각들.
   views.js 와 compose.js 가 서로를 import 하지 않도록 여기로 뺐다. */

import { h, icon, toast } from './dom.js';
import { nav } from './state.js';

export function topbar({ title = '', back = false, actions = [] } = {}) {
  const bar = h('div', { class: 'topbar' });
  if (back) {
    bar.append(h('button', {
      class: 'topbar-back', type: 'button', 'aria-label': '뒤로',
      onClick: () => nav.back(),
    }, icon('back')));
  }
  bar.append(h('div', { class: 'topbar-title', text: title }));
  for (const a of actions) bar.append(a);
  return bar;
}

export function view(...children) {
  return h('div', { class: 'view' }, ...children);
}

export function emptyState(iconName, title, desc, action = null) {
  return h('div', { class: 'empty' }, icon(iconName), h('b', { text: title }), h('span', { text: desc }), action);
}

export function errorState(message, retry) {
  return h('div', { class: 'empty' },
    icon('frown'),
    h('b', { text: '불러오지 못했습니다' }),
    h('span', { text: message }),
    retry ? h('button', { class: 'pill', type: 'button', text: '다시 시도', style: { marginTop: '14px' }, onClick: retry }) : null);
}

/**
 * 요소가 실제 크기를 갖는 순간 콜백을 부른다.
 * requestAnimationFrame 하나만 믿으면 (백그라운드 탭 등) 레이아웃이 늦게 잡힐 때
 * 표시가 0 자리에 멈춰 있게 된다.
 */
export function whenSized(el, fn) {
  let done = false;
  const run = () => {
    if (done || !el.offsetWidth) return;
    done = true;
    ro.disconnect();
    fn();
  };
  const ro = new ResizeObserver(run);

  if (el.offsetWidth) { done = true; fn(); return () => {}; }
  ro.observe(el);
  requestAnimationFrame(run);
  // rAF와 ResizeObserver는 페인트에 묶여 있어 보이지 않는 탭에서는 돌지 않는다.
  setTimeout(run, 0);
  setTimeout(run, 250);
  return () => ro.disconnect();
}

/**
 * 무한 스크롤 — 목록 끝에 센티널을 두고 화면에 들어오면 더 불러온다.
 * loadMore 는 { nodes: Node[], more: boolean } 을 돌려준다.
 */
export function infinite(container, loadMore) {
  const sentinel = h('div', { style: { height: '1px' } });
  container.append(sentinel);
  let busy = false;
  let done = false;

  const io = new IntersectionObserver(async (entries) => {
    if (!entries[0].isIntersecting || busy || done) return;
    busy = true;
    const spinner = h('div', { class: 'spinner' });
    sentinel.before(spinner);
    try {
      const result = await loadMore();
      for (const node of result?.nodes || []) sentinel.before(node);
      if (!result?.more) { done = true; io.disconnect(); }
    } catch (err) {
      toast(err.message, { error: true });
      done = true;
      io.disconnect();
    } finally {
      spinner.remove();
      busy = false;
    }
  }, { rootMargin: '600px 0px' });

  io.observe(sentinel);
  return () => io.disconnect();
}

/** 탭 + 밑줄 잉크 애니메이션 */
export function makeTabs(items, onChange, activeIndex = 0) {
  const ink = h('div', { class: 'tab-ink' });
  const bar = h('div', { class: 'tabs' });
  const buttons = items.map((label, i) => h('button', {
    class: 'tab' + (i === activeIndex ? ' is-active' : ''), type: 'button', text: label,
    onClick: () => select(i),
  }));
  bar.append(...buttons, ink);

  function place(i) {
    const btn = buttons[i];
    if (!btn || !btn.offsetWidth) return;
    ink.style.width = btn.offsetWidth + 'px';
    ink.style.transform = 'translateX(' + btn.offsetLeft + 'px)';
  }
  function select(i) {
    buttons.forEach((b, j) => b.classList.toggle('is-active', j === i));
    place(i);
    onChange(i);
  }
  whenSized(bar, () => place(buttons.findIndex((b) => b.classList.contains('is-active')) || activeIndex));
  window.addEventListener('resize', () => place(buttons.findIndex((b) => b.classList.contains('is-active'))));
  return { bar, select, place };
}
