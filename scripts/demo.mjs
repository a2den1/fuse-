/* 데모 서버 — 디스코드에 접속하지 않고 가짜 데이터로 화면을 확인할 때 쓴다 */
process.env.FUSE_DEMO = '1';
process.env.FUSE_DATA_DIR ||= new URL('../.demo-data', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
await import('../src/index.js');
