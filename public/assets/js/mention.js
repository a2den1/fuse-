/*
 * @멘션 자동완성.
 *
 * 입력창에는 사람이 읽을 수 있는 `@이름` 을 넣고, 보낼 때 `<@아이디>` 로 바꾼다.
 * 디스코드 원문에 raw 태그를 그대로 타이핑하게 만들면 쓸 수 없기 때문이다.
 */

import { h, clear } from './dom.js';
import { api } from './api.js';

const cache = new Map(); // guildId -> {at, members}
const TTL = 60_000;

async function membersOf(guildId, query) {
  if (!guildId) return [];
  const key = guildId;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) {
    return filter(hit.members, query);
  }
  try {
    const { members } = await api.guildMembers(guildId);
    cache.set(key, { at: Date.now(), members });
    return filter(members, query);
  } catch {
    return [];
  }
}

function filter(members, query) {
  const q = query.toLowerCase();
  if (!q) return members.slice(0, 8);
  return members
    .filter((m) => m.displayName.toLowerCase().includes(q) || m.username.toLowerCase().includes(q))
    .slice(0, 8);
}

/** 커서 바로 앞의 `@검색어` 를 찾아낸다 */
function activeToken(textarea) {
  const pos = textarea.selectionStart;
  const before = textarea.value.slice(0, pos);
  const m = before.match(/(^|[\s(\[])@([^\s@]{0,24})$/);
  if (!m) return null;
  return { query: m[2], start: pos - m[2].length - 1, end: pos };
}

/**
 * @param {HTMLTextAreaElement} textarea
 * @param {() => string|null} getGuildId 현재 대상 서버 id
 */
export function attachMentions(textarea, getGuildId) {
  /** 입력창에 넣은 표시 이름 → 실제 사용자 id */
  const picked = new Map();

  let pop = null;
  let items = [];
  let index = 0;
  let token = null;
  let seq = 0;

  function closePop() {
    pop?.remove();
    pop = null;
    items = [];
    token = null;
  }

  function place() {
    if (!pop) return;
    const r = textarea.getBoundingClientRect();
    const width = Math.min(280, Math.max(200, r.width));
    pop.style.width = width + 'px';
    let left = Math.min(r.left, innerWidth - width - 10);
    pop.style.left = Math.max(10, left) + 'px';
    const below = r.bottom + 6;
    pop.style.top = (below + pop.offsetHeight > innerHeight - 10
      ? Math.max(10, r.top - pop.offsetHeight - 6)
      : below) + 'px';
  }

  function highlight() {
    if (!pop) return;
    [...pop.children].forEach((row, i) => row.classList.toggle('is-active', i === index));
    pop.children[index]?.scrollIntoView({ block: 'nearest' });
  }

  function choose(member) {
    if (!token) return;
    const label = '@' + member.displayName;
    const value = textarea.value;
    textarea.value = value.slice(0, token.start) + label + ' ' + value.slice(token.end);
    const caret = token.start + label.length + 1;
    textarea.selectionStart = textarea.selectionEnd = caret;
    picked.set(member.displayName, member.id);
    closePop();
    textarea.focus();
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function render(list) {
    if (!list.length) return closePop();
    if (!pop) {
      pop = h('div', { class: 'mention-pop', role: 'listbox' });
      document.body.append(pop);
    }
    clear(pop);
    index = 0;
    items = list;
    for (const m of list) {
      pop.append(h('button', {
        class: 'mention-row', type: 'button', role: 'option',
        onMousedown: (e) => { e.preventDefault(); choose(m); },
      },
        h('img', { class: 'avatar avatar-28', src: m.avatar || '', alt: '', loading: 'lazy' }),
        h('div', { class: 'mr-main' },
          h('b', { text: m.displayName }),
          h('small', { text: '@' + m.username }))));
    }
    highlight();
    place();
  }

  async function update() {
    token = activeToken(textarea);
    if (!token) return closePop();
    const mine = ++seq;
    const list = await membersOf(getGuildId(), token.query);
    if (mine !== seq) return;        // 더 최신 입력이 진행 중
    if (!activeToken(textarea)) return closePop();
    render(list);
  }

  textarea.addEventListener('input', update);
  textarea.addEventListener('click', update);
  textarea.addEventListener('blur', () => setTimeout(closePop, 120));

  textarea.addEventListener('keydown', (e) => {
    if (!pop || !items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); index = (index + 1) % items.length; highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); index = (index - 1 + items.length) % items.length; highlight(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(items[index]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); }
  });

  window.addEventListener('resize', place);

  return {
    /** 이미 있는 멘션을 되살릴 때 (글 수정) 매핑을 미리 넣어둔다 */
    seed(displayName, id) {
      picked.set(displayName, id);
    },

    /** 보내기 직전: 화면에 보이던 `@이름` 을 디스코드 멘션 문법으로 바꾼다 */
    resolve(text) {
      let out = text;
      // 긴 이름부터 치환해야 짧은 이름이 앞부분만 잡아먹지 않는다
      const names = [...picked.keys()].sort((a, b) => b.length - a.length);
      for (const name of names) {
        const id = picked.get(name);
        out = out.split('@' + name).join('<@' + id + '>');
      }
      return out;
    },
    close: closePop,
  };
}
