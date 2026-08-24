/*
 * 데스크톱 앱과 같은 자격증명·같은 데이터로 서버만 띄운다.
 * 앱 안에서는 개발자 도구를 붙이기 번거로워서, 같은 상태를 브라우저에서 볼 때 쓴다.
 * (앱을 끄고 쓸 것 — 같은 폴더에 둘이 쓰면 서로 덮어쓴다)
 */
import path from 'node:path';
process.env.FUSE_DATA_DIR ||= path.join(process.env.APPDATA, 'fuse', 'data');
await import('../src/index.js');
