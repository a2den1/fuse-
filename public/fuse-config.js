/*
 * 프런트엔드가 어느 서버에 붙을지.
 *
 * 비워두면 같은 출처(자기 자신)를 씁니다 — 로컬 실행이나 한 대에 통째로 올린 경우.
 * Vercel 처럼 프런트만 따로 올릴 때는 배포 시 이 파일이 백엔드 주소로 다시 쓰입니다.
 * (scripts/vercel-build.mjs 가 FUSE_BACKEND_ORIGIN 환경변수를 읽어 생성)
 */
window.FUSE_ORIGIN = '';
