/*
 * 당겨서 새로고침.
 *
 * 표시기는 Fuse 로고다. 당길수록 로고의 도화선(swoosh)이 끝에서부터 타들어가고,
 * 불꽃이 선을 따라 달린다. 끝까지 타면 놓는 순간 새로고침.
 */

import { h } from './dom.js';
import { LOGO_VIEWBOX, LOGO_F, LOGO_SWOOSH } from './dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const TRIGGER = 76;   // 이만큼 당기면 발동
const MAX = 130;      // 더 당겨도 여기까지만 따라온다

function buildIndicator() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', LOGO_VIEWBOX);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const f = document.createElementNS(SVG_NS, 'path');
  f.setAttribute('d', LOGO_F);
  f.setAttribute('fill', 'currentColor');
  f.setAttribute('class', 'ptr-f');

  const fuse = document.createElementNS(SVG_NS, 'path');
  fuse.setAttribute('d', LOGO_SWOOSH);
  fuse.setAttribute('stroke', 'currentColor');
  fuse.setAttribute('stroke-width', '19');
  fuse.setAttribute('stroke-linecap', 'round');
  fuse.setAttribute('fill', 'none');
  fuse.setAttribute('class', 'ptr-fuse');

  // 불꽃 — 도화선이 타는 지점에 얹는다
  const spark = document.createElementNS(SVG_NS, 'circle');
  spark.setAttribute('r', '13');
  spark.setAttribute('class', 'ptr-spark');
  spark.setAttribute('fill', 'currentColor');

  svg.append(fuse, f, spark);

  const wrap = h('div', { class: 'ptr' }, h('div', { class: 'ptr-mark' }, svg));
  return { wrap, svg, fuse, spark, f };
}

/**
 * @param {HTMLElement} host 표시기를 넣을 컨테이너 (컬럼)
 * @param {() => Promise<void>} onRefresh
 */
export function attachPullToRefresh(host, onRefresh) {
  const { wrap, fuse, spark } = buildIndicator();
  host.prepend(wrap);

  const total = fuse.getTotalLength();
  fuse.style.strokeDasharray = total;

  let startY = 0;
  let pull = 0;
  let dragging = false;
  let busy = false;

  const atTop = () => (document.scrollingElement?.scrollTop ?? 0) <= 0;

  /** 0~1 진행도를 그림에 반영 */
  function paint(progress) {
    const p = Math.max(0, Math.min(1, progress));
    // 도화선은 끝에서부터 사라진다
    fuse.style.strokeDashoffset = String(-total * p);

    // 불꽃은 아직 남아있는 도화선의 끝(타는 지점)에 놓는다
    const point = fuse.getPointAtLength(total * (1 - p) * 0.999 + total * p * 0);
    const burn = fuse.getPointAtLength(Math.max(0, total * (1 - p)));
    spark.setAttribute('cx', burn.x);
    spark.setAttribute('cy', burn.y);
    spark.style.opacity = p > 0.02 && p < 0.99 ? '1' : '0';
    spark.style.transform = 'scale(' + (0.7 + Math.sin(p * Math.PI) * 0.6) + ')';
    spark.style.transformOrigin = burn.x + 'px ' + burn.y + 'px';
    void point;

    wrap.style.setProperty('--ptr-progress', p.toFixed(3));
  }

  function setPull(px) {
    pull = Math.max(0, Math.min(MAX, px));
    const eased = pull <= TRIGGER ? pull : TRIGGER + (pull - TRIGGER) * 0.35;
    wrap.style.height = eased + 'px';
    wrap.classList.toggle('is-ready', pull >= TRIGGER);
    paint(pull / TRIGGER);
  }

  function reset(immediate = false) {
    wrap.classList.toggle('is-snapping', !immediate);
    wrap.style.height = '0px';
    pull = 0;
    paint(0);
    setTimeout(() => wrap.classList.remove('is-snapping'), 340);
  }

  async function fire() {
    busy = true;
    wrap.classList.add('is-loading');
    wrap.style.height = TRIGGER + 'px';
    try {
      // 응답이 즉시 와도 타는 장면이 보이도록 최소 시간은 붙잡아 둔다
      await Promise.all([onRefresh(), new Promise((r) => setTimeout(r, 480))]);
    } catch {
      /* 호출한 쪽에서 토스트로 알린다 */
    } finally {
      busy = false;
      wrap.classList.remove('is-loading');
      reset();
    }
  }

  /* ---- 터치 ---- */

  const onStart = (e) => {
    if (busy || !atTop()) return;
    dragging = true;
    startY = e.touches ? e.touches[0].clientY : e.clientY;
  };

  const onMove = (e) => {
    if (!dragging || busy) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const delta = y - startY;

    // 위로 스크롤 중이면 당기기를 취소한다
    if (delta <= 0) { if (pull) reset(true); dragging = false; return; }
    if (!atTop()) { dragging = false; if (pull) reset(true); return; }

    // 당기는 동안에는 페이지가 같이 움직이지 않게 막는다
    if (e.cancelable) e.preventDefault();
    setPull(delta);
  };

  const onEnd = () => {
    if (!dragging || busy) return;
    dragging = false;
    if (pull >= TRIGGER) fire();
    else reset();
  };

  host.addEventListener('touchstart', onStart, { passive: true });
  host.addEventListener('touchmove', onMove, { passive: false });
  host.addEventListener('touchend', onEnd);
  host.addEventListener('touchcancel', onEnd);

  paint(0);

  return {
    /** 데스크톱·테스트용 — 손가락 없이 같은 동작을 돌린다 */
    simulate(px) {
      if (busy) return;
      dragging = true;   // release() 가 실제 손가락일 때와 똑같이 동작하도록
      setPull(px);
    },
    release: onEnd,
    refresh: fire,
    destroy() {
      host.removeEventListener('touchstart', onStart);
      host.removeEventListener('touchmove', onMove);
      host.removeEventListener('touchend', onEnd);
      host.removeEventListener('touchcancel', onEnd);
      wrap.remove();
    },
  };
}
