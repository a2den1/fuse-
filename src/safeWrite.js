import fs from 'node:fs';

/**
 * 파일을 안전하게 덮어쓴다.
 *
 * 원칙은 임시 파일에 쓰고 rename 으로 바꿔치기 하는 것이다.
 * 중간에 죽어도 반쯤 쓰인 파일이 남지 않기 때문이다.
 *
 * 그런데 클라우드 동기화 폴더나 폴더 리디렉션이 걸린 %APPDATA% 에서는
 * 같은 디렉터리 안인데도 rename 이 EXDEV 로 거부되는 경우가 있다.
 * 그때는 원자성을 포기하더라도 저장 자체는 되게 한다 —
 * 안 그러면 좋아요·알림·쪽지·로그인이 통째로 사라진다.
 */
export function writeFileSafe(file, data, options = {}) {
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, data, options);
    fs.renameSync(tmp, file);
    return 'atomic';
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* 임시 파일이 없을 수도 있다 */ }
    if (err.code !== 'EXDEV' && err.code !== 'EPERM' && err.code !== 'EACCES') throw err;
    fs.writeFileSync(file, data, options);
    return 'direct';
  }
}
