/* 디스코드 마크다운 → 안전한 HTML
   원문을 먼저 이스케이프한 뒤, 우리가 만든 태그만 넣는다. */

const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => escapeMap[c]);

const CDN = 'https://cdn.discordapp.com';

/**
 * 치환 토큰.
 * 사설 사용 영역(PUA) 문자로 감싼다 — 이스케이프에도 마크다운 정규식에도 걸리지 않고,
 * 사용자가 입력한 평범한 숫자와 헷갈릴 일도 없다.
 */
const TOK_OPEN = "";
const TOK_CLOSE = "";
const TOK_RE = new RegExp(TOK_OPEN + '([0-9]+)' + TOK_CLOSE, 'g');

function makeTokenizer() {
  const slots = [];
  return {
    put(html) {
      slots.push(html);
      return TOK_OPEN + (slots.length - 1) + TOK_CLOSE;
    },
    restore(text) {
      return text.replace(TOK_RE, (_, i) => slots[Number(i)] ?? '');
    },
  };
}

function timestamp(unix, style) {
  const date = new Date(Number(unix) * 1000);
  if (Number.isNaN(date.getTime())) return '';
  const opts = {
    t: { hour: '2-digit', minute: '2-digit' },
    T: { hour: '2-digit', minute: '2-digit', second: '2-digit' },
    d: { year: 'numeric', month: '2-digit', day: '2-digit' },
    D: { year: 'numeric', month: 'long', day: 'numeric' },
    f: { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' },
    F: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' },
  };
  if (style === 'R') {
    const diff = date.getTime() - Date.now();
    const abs = Math.abs(diff);
    const unit = abs < 60_000 ? ['초', 1000]
      : abs < 3_600_000 ? ['분', 60_000]
      : abs < 86_400_000 ? ['시간', 3_600_000]
      : ['일', 86_400_000];
    const n = Math.round(abs / unit[1]);
    return diff < 0 ? n + unit[0] + ' 전' : n + unit[0] + ' 후';
  }
  return date.toLocaleString('ko-KR', opts[style] || opts.f);
}

/**
 * @param {string} raw
 * @param {{users?:object, roles?:object, channels?:object}} mentions
 */
export function renderMarkdown(raw, mentions = {}) {
  if (!raw) return '';
  const t = makeTokenizer();
  // CRLF 정규화. 정규식의 `.` 은 \r 을 매칭하지 않아서, 이걸 빼먹으면
  // 폼으로 올라온 글(멀티파트는 CRLF로 인코딩된다)의 인용·목록·제목이 전부 깨진다.
  let text = String(raw).replace(/\r\n?/g, '\n');

  // 1) 코드 블록 / 인라인 코드 먼저 빼둔다 (안에서는 마크다운이 동작하지 않는다)
  text = text.replace(/```(?:([a-zA-Z0-9+#-]*)\n)?([\s\S]*?)```/g, (_, lang, code) =>
    t.put('<pre><code' + (lang ? ' class="lang-' + esc(lang) + '"' : '') + '>' + esc(code.replace(/\n$/, '')) + '</code></pre>'));
  text = text.replace(/`([^`\n]+)`/g, (_, code) => t.put('<code>' + esc(code) + '</code>'));

  // 2) 이 시점부터는 전부 이스케이프된 문자열만 다룬다
  text = esc(text);

  // 3) 링크
  text = text.replace(/\bhttps?:\/\/[^\s<>"']+/g, (url) => {
    const clean = url.replace(/[.,;:)\]]+$/, '');
    const tail = url.slice(clean.length);
    const href = clean.replace(/&amp;/g, '&');
    const label = clean.length > 62 ? clean.slice(0, 62) + '…' : clean;
    return t.put('<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer nofollow">' + label + '</a>') + tail;
  });

  // 4) 멘션 / 커스텀 이모지 / 타임스탬프 (이스케이프되어 &lt; &gt; 형태다)
  text = text.replace(/&lt;a?:([\w~]+):(\d+)&gt;/g, (_, name, id) =>
    t.put('<img class="emoji" src="' + CDN + '/emojis/' + id + '.webp?size=44" alt=":' + esc(name) + ':" loading="lazy">'));

  text = text.replace(/&lt;t:(-?\d+)(?::([tTdDfFR]))?&gt;/g, (_, unix, style) =>
    t.put('<span class="mention" title="' + esc(new Date(Number(unix) * 1000).toISOString()) + '">' + esc(timestamp(unix, style)) + '</span>'));

  text = text.replace(/&lt;@!?(\d+)&gt;/g, (_, id) => {
    const name = mentions.users?.[id]?.name;
    return t.put('<a class="mention" href="/u/' + id + '" data-nav>@' + esc(name || '사용자') + '</a>');
  });

  text = text.replace(/&lt;@&amp;(\d+)&gt;/g, (_, id) => {
    const role = mentions.roles?.[id];
    const style = role?.color ? ' style="color:' + esc(role.color) + ';background:' + esc(role.color) + '22"' : '';
    return t.put('<span class="mention"' + style + '>@' + esc(role?.name || '역할') + '</span>');
  });

  text = text.replace(/&lt;#(\d+)&gt;/g, (_, id) => {
    const name = mentions.channels?.[id]?.name;
    return t.put('<a class="mention" href="/c/' + id + '" data-nav>#' + esc(name || '채널') + '</a>');
  });

  text = text.replace(/@(everyone|here)\b/g, (m) => t.put('<span class="mention">' + m + '</span>'));

  // 5) 블록 요소
  const lines = text.split('\n');
  const out = [];
  let quote = null;
  let list = null;

  const flush = () => {
    if (quote) { out.push('<blockquote>' + quote.join('<br>') + '</blockquote>'); quote = null; }
    if (list) { out.push('<ul>' + list.map((li) => '<li>' + li + '</li>').join('') + '</ul>'); list = null; }
  };

  for (const line of lines) {
    const q = line.match(/^&gt;\s?(.*)$/);
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    const hd = line.match(/^(#{1,3})\s+(.*)$/);
    const sub = line.match(/^-#\s+(.*)$/);

    if (q) {
      if (list) flush();
      (quote ||= []).push(q[1]);
      continue;
    }
    if (li) {
      if (quote) flush();
      (list ||= []).push(li[1]);
      continue;
    }
    flush();
    if (sub) out.push('<small class="muted">' + sub[1] + '</small>');
    else if (hd) out.push('<h' + hd[1].length + ' class="md-h">' + hd[2] + '</h' + hd[1].length + '>');
    else out.push(line);
  }
  flush();
  text = out.join('\n');

  // 6) 인라인 서식 — 긴 마커부터
  text = text
    .replace(/\|\|([\s\S]+?)\|\|/g, '<span class="spoiler" role="button" tabindex="0">$1</span>')
    .replace(/\*\*\*([^\n]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^\n]+?)__/g, '<u>$1</u>')
    .replace(/~~([^\n]+?)~~/g, '<s>$1</s>')
    .replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+?)_(?!_)/g, '$1<em>$2</em>');

  // 7) 코드/링크/멘션 복원
  const html = t.restore(text);

  // 블록 요소에 붙은 줄바꿈은 지운다.
  // 본문은 white-space: pre-wrap 이라 그대로 두면 빈 줄이 하나 더 생긴다.
  return html
    .replace(/\n+(<(?:blockquote|ul|pre|h[1-3])\b)/g, '$1')
    .replace(/(<\/(?:blockquote|ul|pre|h[1-3])>)\n+/g, '$1');
}

/** 목록·미리보기용 순수 텍스트 */
export function plainText(raw, mentions = {}) {
  if (!raw) return '';
  return String(raw)
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, ' 코드 ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<a?:([\w~]+):\d+>/g, ':$1:')
    .replace(/<@!?(\d+)>/g, (_, id) => '@' + (mentions.users?.[id]?.name || '사용자'))
    .replace(/<@&(\d+)>/g, (_, id) => '@' + (mentions.roles?.[id]?.name || '역할'))
    .replace(/<#(\d+)>/g, (_, id) => '#' + (mentions.channels?.[id]?.name || '채널'))
    .replace(/<t:(-?\d+)(?::[tTdDfFR])?>/g, ' 시각 ')
    .replace(/[*_~|>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
