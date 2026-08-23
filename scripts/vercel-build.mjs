/*
 * Vercel 빌드 단계.
 *
 * Vercel 에는 화면(정적 파일)만 올라가고, 디스코드에 붙어 있는 백엔드는
 * 따로 돌아간다. 그 백엔드 주소를 `public/fuse-config.js` 에 박아 넣는다.
 *
 * 필요한 환경변수: FUSE_BACKEND_ORIGIN  (예: https://fuse-api.up.railway.app)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/fuse-config.js');

const origin = (process.env.FUSE_BACKEND_ORIGIN || '').trim().replace(/\/$/, '');

if (!origin) {
  console.warn(
    '\n[build] FUSE_BACKEND_ORIGIN 이 없습니다.\n' +
    '        화면은 올라가지만 로그인과 피드가 동작하지 않습니다.\n' +
    '        Vercel 프로젝트 설정 → Environment Variables 에 백엔드 주소를 넣어주세요.\n',
  );
} else if (!/^https:\/\//.test(origin)) {
  console.error('[build] FUSE_BACKEND_ORIGIN 은 https 여야 합니다 (쿠키가 실려 가려면 필요). 받은 값: ' + origin);
  process.exit(1);
}

fs.writeFileSync(OUT,
  '/* 자동 생성 — scripts/vercel-build.mjs */\n' +
  'window.FUSE_ORIGIN = ' + JSON.stringify(origin) + ';\n');

console.log('[build] 백엔드 주소: ' + (origin || '(같은 출처)'));
