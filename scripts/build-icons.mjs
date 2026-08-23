/**
 * 아이콘 빌드 스크립트.
 *
 * Lucide 아이콘(스트로크)을 morphicons 의 canonicalD 로 한 개의 path `d` 문자열로 눌러
 * `public/assets/js/icons.js` 를 만든다.
 *
 * 이렇게 해두면 브라우저는 lucide 패키지를 받을 필요가 없고,
 * morphicons 는 이 `d` 문자열끼리 바로 모핑할 수 있다.
 *
 *   npm run build:icons
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lucide from 'lucide';
import { canonicalD } from 'morphicons/dom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/assets/js/icons.js');

/** 화면에서 쓰는 이름 → Lucide 내보내기 이름 */
const ICONS = {
  // 내비게이션
  home: 'House',
  search: 'Search',
  plus: 'Plus',
  bell: 'Bell',
  user: 'User',
  mail: 'Mail',
  settings: 'Settings',
  compass: 'Compass',
  menu: 'Menu',
  close: 'X',

  // 글 액션
  heart: 'Heart',
  comment: 'MessageCircle',
  repost: 'Repeat2',
  share: 'Send',

  // 메뉴
  more: 'Ellipsis',
  edit: 'SquarePen',
  copy: 'Copy',
  link: 'Link',
  trash: 'Trash2',
  check: 'Check',
  logout: 'LogOut',
  pin: 'Pin',
  reply: 'Reply',
  discord: 'MessageSquare',

  // 이동
  back: 'ArrowLeft',
  up: 'ArrowUp',
  right: 'ChevronRight',
  left: 'ChevronLeft',
  down: 'ChevronDown',

  // 채널
  hash: 'Hash',
  megaphone: 'Megaphone',
  volume: 'Volume2',
  forum: 'MessagesSquare',
  thread: 'MessageSquareText',

  // 컴포저
  image: 'Image',
  emoji: 'Smile',
  emojiPlus: 'SmilePlus',
  at: 'AtSign',

  // 빈 상태 / 기타
  inbox: 'Inbox',
  bellOff: 'BellOff',
  frown: 'Frown',
  pen: 'PenLine',
  building: 'Building2',
  users: 'Users',
  sparkles: 'Sparkles',
  bug: 'Bug',
  info: 'Info',
  eyeOff: 'EyeOff',

  // 파일
  file: 'File',
  fileText: 'FileText',
  fileZip: 'FileArchive',
  fileCode: 'FileCode',
  film: 'Film',
  music: 'Music',
};

const missing = [];
const entries = [];

for (const [name, exportName] of Object.entries(ICONS)) {
  const node = lucide[exportName];
  if (!node) {
    missing.push(name + ' (' + exportName + ')');
    continue;
  }
  entries.push([name, canonicalD(node)]);
}

if (missing.length) {
  console.error('[icons] Lucide 에 없는 이름:', missing.join(', '));
  process.exit(1);
}

const body = entries
  .map(([name, d]) => '  ' + JSON.stringify(name) + ': ' + JSON.stringify(d) + ',')
  .join('\n');

const file = `/* 자동 생성 — 고치지 마세요. \`npm run build:icons\` 로 다시 만듭니다.
   출처: Lucide (ISC), morphicons 의 canonicalD 로 단일 path 로 평탄화.
   전부 24x24 그리드의 스트로크 아이콘이라 서로 모핑할 수 있습니다. */

export const ICON_GRID = 24;

export const ICONS = {
${body}
};

export const iconNames = Object.keys(ICONS);
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, file);
console.log('[icons] ' + entries.length + '개 아이콘 → ' + path.relative(ROOT, OUT));
