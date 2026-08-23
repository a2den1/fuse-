/* 글쓰기 — 모달이 아니라 하나의 화면이다 (/compose) */

import { h, icon, toast, autoGrow, clear, openOverlay } from './dom.js';
import { api } from './api.js';
import { state, nav, emit, on } from './state.js';
import { plainText } from './markdown.js';
import { attachMentions } from './mention.js';
import { topbar, view, emptyState } from './ui.js';

const LAST_KEY = 'fuse:lastChannel';
const channelCache = new Map(); // guildId -> channels

async function channelsOf(guildId) {
  if (channelCache.has(guildId)) return channelCache.get(guildId);
  const { channels } = await api.guild(guildId);
  channelCache.set(guildId, channels);
  return channels;
}

const CHANNEL_ICON = {
  text: 'hash',
  announcement: 'megaphone',
  voice: 'volume',
  forum: 'forum',
  thread: 'thread',
};

function loadLast() {
  try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch { return null; }
}
function saveLast(ch) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({
      id: ch.id, name: ch.name, kind: ch.kind,
      guild: { id: ch.guild.id, name: ch.guild.name, icon: ch.guild.icon },
    }));
  } catch { /* 사생활 보호 모드 */ }
}

/* ---------------------------- 화면 이동 ---------------------------- */

/** 화면을 넘어가며 들고 갈 의도. 주소만으로도 복원되도록 쿼리로도 남긴다. */
let pendingIntent = null;

export function openComposer(options = {}) {
  pendingIntent = options;
  const q = new URLSearchParams();
  if (options.mode === 'edit' && options.post) q.set('edit', options.post.channelId + '.' + options.post.id);
  else if (options.quote) q.set('quote', options.quote.channelId + '.' + options.quote.id);
  else if (options.replyTo) q.set('reply', options.replyTo.channelId + '.' + options.replyTo.id);
  const qs = q.toString();
  nav.go('/compose' + (qs ? '?' + qs : ''));
}

function takeIntent() {
  const i = pendingIntent;
  pendingIntent = null;
  return i;
}

/** 주소 쿼리만 있고 의도가 없을 때 (새로고침·직접 접속) 서버에서 되살린다 */
async function intentFromQuery(search) {
  const q = new URLSearchParams(search);
  for (const [key, mode] of [['edit', 'edit'], ['quote', 'quote'], ['reply', 'reply']]) {
    const raw = q.get(key);
    if (!raw) continue;
    const dot = raw.lastIndexOf('.');
    if (dot < 0) continue;
    const channelId = raw.slice(0, dot);
    const messageId = raw.slice(dot + 1);
    try {
      const { post } = await api.post(channelId, messageId);
      if (mode === 'edit') return { mode: 'edit', post };
      if (mode === 'quote') return { mode: 'quote', quote: post, channel: channelOf(post) };
      return { replyTo: post, channel: channelOf(post) };
    } catch {
      return {};
    }
  }
  return {};
}

const channelOf = (post) => (post.channel
  ? { id: post.channelId, name: post.channel.name, kind: 'text', guild: post.guild }
  : null);

/* ---------------------------- 채널 선택 ---------------------------- */

function pickerPanel({ current, onPick, onBack }) {
  const wrap = h('div', { class: 'picker' });

  if (!state.guilds.length) {
    wrap.append(emptyState('frown', '올릴 수 있는 서버가 없습니다',
      'Fuse 봇이 들어가 있는 서버에만 글을 쓸 수 있습니다.'));
    return wrap;
  }

  wrap.append(h('div', { class: 'picker-group', text: '어디에 올릴까요' }));

  for (const guild of state.guilds) {
    wrap.append(h('button', {
      class: 'picker-row', type: 'button',
      onClick: async () => {
        try {
          const channels = await channelsOf(guild.id);
          swap(wrap, () => channelListPanel({ guild, channels, current, onPick, onBack }));
        } catch (err) {
          toast(err.message, { error: true });
        }
      },
    },
      h('img', { src: guild.icon || '', alt: '', loading: 'lazy' }),
      h('div', { class: 'pr-main' },
        h('b', { text: guild.name }),
        h('small', { text: guild.memberCount ? guild.memberCount.toLocaleString('ko-KR') + '명' : '서버' })),
      icon('right', 'muted')));
  }
  return wrap;
}

function channelListPanel({ guild, channels, current, onPick, onBack }) {
  const wrap = h('div', { class: 'picker' });
  wrap.append(h('button', {
    class: 'picker-row', type: 'button',
    onClick: () => swap(wrap, () => pickerPanel({ current, onPick, onBack }), { back: true }),
  }, icon('left'), h('div', { class: 'pr-main' }, h('b', { text: guild.name }))));

  const usable = channels.filter((c) => c.kind !== 'forum');
  if (!usable.length) wrap.append(emptyState('hash', '글을 쓸 수 있는 채널이 없습니다', ''));

  for (const ch of usable) {
    wrap.append(h('button', {
      class: 'picker-row' + (ch.id === current?.id ? ' is-active' : ''), type: 'button',
      onClick: () => onPick({ ...ch, guild }),
    },
      icon(CHANNEL_ICON[ch.kind] || CHANNEL_ICON.text, 'muted'),
      h('div', { class: 'pr-main' },
        h('b', { text: ch.name }),
        ch.topic ? h('small', { text: ch.topic }) : null),
      ch.id === current?.id ? icon('check', 'check') : null));
  }
  return wrap;
}

/** 같은 자리에서 패널을 부드럽게 갈아끼운다 (높이 + 슬라이드) */
function swap(oldPanel, build, { back = false } = {}) {
  const container = oldPanel.parentElement;
  if (!container) return null;
  const next = build();
  const startH = container.offsetHeight;

  container.style.overflow = 'hidden';
  clear(container);
  container.append(next);
  const endH = next.offsetHeight;

  next.style.opacity = '0';
  next.style.transform = 'translateX(' + (back ? '-10px' : '10px') + ')';
  container.style.height = startH + 'px';

  requestAnimationFrame(() => {
    container.style.transition = 'height .32s cubic-bezier(.34,1.42,.44,1)';
    container.style.height = endH + 'px';
    next.style.transition = 'opacity .22s ease, transform .32s cubic-bezier(.34,1.42,.44,1)';
    next.style.opacity = '1';
    next.style.transform = 'translateX(0)';
  });

  const done = () => {
    for (const prop of ['height', 'transition', 'overflow']) container.style.removeProperty(prop);
    for (const prop of ['transition', 'transform', 'opacity']) next.style.removeProperty(prop);
  };
  container.addEventListener('transitionend', done, { once: true });
  setTimeout(done, 460);
  return next;
}

/* ------------------------------ 화면 ------------------------------ */

export function composeView(search = location.search) {
  const wrap = h('div', { class: 'compose-wrap' });
  const submitBtn = h('button', { class: 'topbar-action is-primary', type: 'button', text: '게시', disabled: true });
  const bar = topbar({
    title: '새 글',
    actions: [submitBtn],
  });
  // 뒤로 대신 "취소" 를 왼쪽에 둔다
  bar.prepend(h('button', {
    class: 'sh-cancel', type: 'button', text: '취소',
    onClick: () => nav.back(),
  }));

  const el = view(bar, wrap);
  wrap.append(h('div', { class: 'spinner' }));

  (async () => {
    const intent = takeIntent() || (await intentFromQuery(search));
    const mode = intent.mode || 'new';
    let target = intent.channel
      || (mode === 'edit' ? { id: intent.post.channelId, name: intent.post.channel?.name, guild: intent.post.guild } : loadLast());
    const files = [];

    bar.querySelector('.topbar-title').textContent =
      mode === 'edit' ? '글 수정' : intent.replyTo ? '답글' : '새 글';
    submitBtn.textContent = mode === 'edit' ? '저장' : intent.replyTo ? '답글' : '게시';

    const textarea = h('textarea', {
      placeholder: mode === 'edit' ? '내용을 수정하세요'
        : intent.replyTo ? intent.replyTo.author.displayName + ' 님에게 답글 남기기…'
        : '무슨 일이 있었나요?',
      maxlength: '2000',
      rows: '4',
      'aria-label': '내용',
    });
    const mentions = attachMentions(textarea, () => target?.guild?.id || null);

    if (mode === 'edit') {
      // 저장된 원문은 <@아이디> 형태다. 사람이 읽는 @이름 으로 보여주고 저장 때 되돌린다.
      let text = intent.post.content || '';
      for (const [id, user] of Object.entries(intent.post.mentions?.users || {})) {
        const label = '@' + user.name;
        text = text.split('<@' + id + '>').join(label).split('<@!' + id + '>').join(label);
        mentions.seed(user.name, id);
      }
      textarea.value = text;
    }

    const counter = h('small', { class: 'muted compose-counter' });

    const targetBtn = h('button', {
      class: 'pill', type: 'button',
      onClick: () => {
        if (mode === 'edit' || intent.replyTo) return;
        swap(panel, () => pickerPanel({
          current: target,
          onPick: (ch) => {
            target = ch;
            saveLast(ch);
            swap(wrap.firstElementChild, () => buildPanel());
            validate();
          },
        }));
      },
    });

    function syncTarget() {
      clear(targetBtn);
      if (target) {
        targetBtn.append(
          target.guild?.icon ? h('img', { src: target.guild.icon, alt: '' }) : icon('hash'),
          h('span', { text: (target.guild?.name ? target.guild.name + ' · ' : '') + '#' + (target.name || '채널') }),
        );
        if (mode !== 'edit' && !intent.replyTo) targetBtn.append(icon('down'));
      } else {
        targetBtn.append(icon('hash'), h('span', { text: '올릴 채널 고르기' }), icon('down'));
      }
    }

    const attachGrid = h('div', { class: 'attach-grid' });

    function renderAttachments() {
      clear(attachGrid);
      files.forEach((file, i) => {
        const item = h('div', { class: 'attach-item' });
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
          onClick: () => { files.splice(i, 1); renderAttachments(); validate(); },
        }, icon('close')));
        attachGrid.append(item);
      });
      attachGrid.hidden = !files.length;
    }

    const fileInput = h('input', {
      type: 'file', accept: 'image/*,video/*,audio/*,.pdf,.txt,.zip', multiple: true,
      style: { display: 'none' },
      onChange: (e) => {
        for (const f of e.target.files) {
          if (files.length >= 4) { toast('파일은 4개까지 올릴 수 있습니다.', { error: true }); break; }
          if (f.size > 8 * 1024 * 1024) { toast(f.name + ' 은 8MB를 넘습니다.', { error: true }); continue; }
          files.push(f);
        }
        e.target.value = '';
        renderAttachments();
        validate();
      },
    });

    function validate() {
      const len = textarea.value.trim().length;
      counter.textContent = len > 1700 ? len + ' / 2000' : '';
      submitBtn.disabled = !(target && (len > 0 || files.length)) || !!submitBtn.dataset.busy;
    }

    textarea.addEventListener('input', validate);
    textarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
    });

    function buildPanel() {
      return h('div', { class: 'composer' },
        h('img', { class: 'avatar avatar-36', src: state.me?.avatar || '', alt: '' }),
        h('div', { class: 'composer-main' },
          h('div', { class: 'composer-name', text: state.me?.displayName || '' }),
          targetBtn,
          textarea,
          attachGrid,
          mode !== 'edit' ? h('div', { class: 'composer-tools' },
            h('button', { class: 'tool', type: 'button', 'aria-label': '사진·동영상', onClick: () => fileInput.click() }, icon('image')),
            h('button', {
              class: 'tool', type: 'button', 'aria-label': '이모지',
              onClick: (e) => insertEmojiPicker(e.currentTarget, (emoji) => {
                const start = textarea.selectionStart;
                textarea.value = textarea.value.slice(0, start) + emoji + textarea.value.slice(textarea.selectionEnd);
                textarea.selectionStart = textarea.selectionEnd = start + emoji.length;
                textarea.focus();
                validate();
              }),
            }, icon('emoji')),
          ) : null,
          intent.quote ? quoteCard(intent.quote) : null,
          intent.replyTo ? quoteCard(intent.replyTo, '답글 대상') : null,
          counter));
    }

    async function submit() {
      if (submitBtn.disabled) return;
      submitBtn.dataset.busy = '1';
      submitBtn.disabled = true;
      const original = submitBtn.textContent;
      submitBtn.textContent = mode === 'edit' ? '저장 중…' : '올리는 중…';

      const typed = mentions.resolve(textarea.value.trim());

      try {
        if (mode === 'edit') {
          const { post } = await api.editPost(intent.post.channelId, intent.post.id, typed);
          emit('post:patch', post);
          toast('글을 수정했습니다.');
        } else {
          const form = new FormData();
          form.set('channelId', target.id);
          form.set('content', withQuote(typed, intent.quote));
          for (const f of files) form.append('files', f);
          const { post } = intent.replyTo
            ? await api.reply(intent.replyTo.channelId, intent.replyTo.id, form)
            : await api.createPost(form);
          emit('post:created', post);
          toast(intent.replyTo ? '답글을 남겼습니다.' : '글을 올렸습니다.');
        }
        nav.back();
      } catch (err) {
        toast(err.message, { error: true });
        delete submitBtn.dataset.busy;
        submitBtn.textContent = original;
        validate();
      }
    }
    submitBtn.addEventListener('click', submit);

    const panel = buildPanel();
    clear(wrap);
    wrap.append(panel);
    wrap.append(fileInput);

    syncTarget();
    renderAttachments();
    validate();
    autoGrow(textarea, Math.round(innerHeight * 0.45));
    setTimeout(() => textarea.focus(), 60);
  })();

  return el;
}

/**
 * 인용은 본문 앞에 인용문으로 붙인다.
 * 그래야 디스코드 앱에서 봐도 무엇을 인용했는지 그대로 보인다.
 */
function withQuote(text, quoted) {
  if (!quoted) return text;
  const head = plainText(quoted.content, quoted.mentions).slice(0, 160) || '(첨부만 있는 글)';
  return '> ' + head + '\n> — ' + quoted.author.displayName + '\n\n' + text;
}

function quoteCard(post, label) {
  return h('div', { class: 'post-quote' },
    label ? h('small', { class: 'muted', text: label }) : null,
    h('div', { class: 'q-head' },
      h('img', { class: 'avatar avatar-20', src: post.author.avatar, alt: '' }),
      h('span', { text: post.author.displayName })),
    h('div', { class: 'q-body', text: plainText(post.content, post.mentions) || '(첨부만 있는 글)' }));
}

/* 컴포저용 이모지 팔레트 (토스페이스로 그려진다) */
const PALETTE = ['😀', '😂', '🥲', '😍', '🤔', '😭', '😱', '🥳', '😴', '🤝', '👍', '👏', '🙏', '🔥', '✨', '🎉', '❤️', '💯', '🚀', '⚡', '✅', '❌', '👀', '💬', '📌', '🐛', '🎮', '🍀'];

function insertEmojiPicker(anchor, onPick) {
  document.querySelector('.emoji-pop')?.remove();
  const pop = h('div', { class: 'emoji-pop' },
    h('div', { class: 'emoji-grid' }, PALETTE.map((e) =>
      h('button', { type: 'button', text: e, onClick: (ev) => { ev.preventDefault(); ev.stopPropagation(); close(); onPick(e); } }))));

  const close = () => {
    pop.remove();
    document.removeEventListener('mousedown', outside, true);
  };
  const outside = (ev) => { if (!pop.contains(ev.target) && ev.target !== anchor) close(); };

  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(10, Math.min(r.left, innerWidth - pop.offsetWidth - 10)) + 'px';
  const top = r.bottom + 6;
  pop.style.top = (top + pop.offsetHeight > innerHeight - 10 ? Math.max(10, r.top - pop.offsetHeight - 6) : top) + 'px';
  setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
}

/* 인용 / 수정 요청을 받는다 */
export function wireComposeEvents() {
  on('compose:quote', (post) => openComposer({ mode: 'quote', quote: post, channel: channelOf(post) }));
  on('compose:edit', (post) => openComposer({ mode: 'edit', post }));
}

/* ---------------------- 피드 위 인라인 작성창 ---------------------- */

/**
 * 트위터처럼 타임라인 맨 위에서 바로 쓴다.
 *
 * 한 줄짜리로 앉아 있다가 글자가 들어오면 자라난다.
 * 어디에 올릴지는 늘 보이게 둔다 — 디스코드는 채널이 있어서
 * "어디로 가는 글인지" 를 모르면 올리기가 무섭다.
 */
export function inlineComposer() {
  let target = loadLast();
  const files = [];

  const textarea = h('textarea', {
    class: 'ic-text',
    placeholder: '무슨 일이 일어나고 있나요?',
    maxlength: '2000',
    rows: '1',
    'aria-label': '새 글',
  });
  const mentions = attachMentions(textarea, () => target?.guild?.id || null);

  const postBtn = h('button', { class: 'ic-post', type: 'button', text: '게시하기', disabled: true });
  const targetBtn = h('button', { class: 'ic-target', type: 'button' });
  const attachGrid = h('div', { class: 'attach-grid', hidden: true });

  const fileInput = h('input', {
    type: 'file', accept: 'image/*,video/*,audio/*,.pdf,.txt,.zip', multiple: true,
    style: { display: 'none' },
    onChange: (e) => {
      for (const f of e.target.files) {
        if (files.length >= 4) { toast('파일은 4개까지 올릴 수 있습니다.', { error: true }); break; }
        if (f.size > 8 * 1024 * 1024) { toast(f.name + ' 은 8MB를 넘습니다.', { error: true }); continue; }
        files.push(f);
      }
      e.target.value = '';
      renderAttachments();
      validate();
    },
  });

  function renderAttachments() {
    clear(attachGrid);
    files.forEach((file, i) => {
      const item = h('div', { class: 'attach-item' });
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
        onClick: () => { files.splice(i, 1); renderAttachments(); validate(); },
      }, icon('close')));
      attachGrid.append(item);
    });
    attachGrid.hidden = !files.length;
  }

  function syncTarget() {
    clear(targetBtn);
    if (target) {
      targetBtn.title = (target.guild?.name ? target.guild.name + ' · ' : '') + '#' + (target.name || '');
      targetBtn.append(
        target.guild?.icon ? h('img', { src: target.guild.icon, alt: '' }) : icon('hash'),
        h('span', { text: target.name || '채널' }),
      );
    } else {
      targetBtn.title = '올릴 채널 고르기';
      targetBtn.append(icon('hash'), h('span', { text: '채널 고르기' }));
    }
  }

  targetBtn.addEventListener('click', () => {
    openOverlay((close) => {
      const box = h('div', { class: 'picker-sheet' });
      box.append(pickerPanel({
        current: target,
        onPick: (ch) => { target = ch; saveLast(ch); syncTarget(); validate(); close(); },
      }));
      return box;
    });
  });

  function validate() {
    const len = textarea.value.trim().length;
    postBtn.disabled = !(target && (len > 0 || files.length)) || !!postBtn.dataset.busy;
    wrap.classList.toggle('is-open', len > 0 || files.length > 0);
  }

  textarea.addEventListener('input', validate);
  textarea.addEventListener('focus', () => wrap.classList.add('is-focused'));
  textarea.addEventListener('blur', () => {
    if (!textarea.value.trim() && !files.length) wrap.classList.remove('is-focused');
  });
  textarea.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
  });

  async function submit() {
    if (postBtn.disabled) return;
    postBtn.dataset.busy = '1';
    postBtn.disabled = true;
    postBtn.textContent = '올리는 중…';

    const form = new FormData();
    form.set('channelId', target.id);
    form.set('content', mentions.resolve(textarea.value.trim()));
    for (const f of files) form.append('files', f);

    try {
      const { post } = await api.createPost(form);
      emit('post:created', post);
      textarea.value = '';
      files.length = 0;
      renderAttachments();
      autoGrow(textarea, 260);
      wrap.classList.remove('is-open', 'is-focused');
      textarea.blur();
    } catch (err) {
      toast(err.message, { error: true });
    } finally {
      delete postBtn.dataset.busy;
      postBtn.textContent = '게시하기';
      validate();
    }
  }
  postBtn.addEventListener('click', submit);

  const wrap = h('div', { class: 'inline-composer' },
    h('img', { class: 'avatar avatar-36', src: state.me?.avatar || '', alt: '' }),
    h('div', { class: 'ic-main' },
      textarea,
      attachGrid,
      h('div', { class: 'ic-tools' },
        h('button', {
          class: 'tool', type: 'button', 'aria-label': '사진·동영상',
          onClick: () => fileInput.click(),
        }, icon('image')),
        h('button', {
          class: 'tool', type: 'button', 'aria-label': '이모지',
          onClick: (e) => insertEmojiPicker(e.currentTarget, (emoji) => {
            const start = textarea.selectionStart;
            textarea.value = textarea.value.slice(0, start) + emoji + textarea.value.slice(textarea.selectionEnd);
            textarea.selectionStart = textarea.selectionEnd = start + emoji.length;
            textarea.focus();
            validate();
          }),
        }, icon('emoji')),
        h('div', { class: 'ic-spacer' }),
        targetBtn,
        postBtn)),
    fileInput);

  // 아바타는 로그인 정보가 늦게 올 수도 있다
  const offMe = on('me', () => {
    const img = wrap.querySelector('.avatar');
    if (img && state.me?.avatar) img.src = state.me.avatar;
    if (!target) { target = loadLast(); syncTarget(); validate(); }
  });
  wrap._cleanup = () => offMe();

  syncTarget();
  autoGrow(textarea, 260);
  validate();
  return wrap;
}
