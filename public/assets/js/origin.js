/*
 * 백엔드 주소.
 *
 * 같은 서버가 프런트와 API를 모두 주면 빈 문자열이고, 그때는 상대 경로로 요청한다.
 * Vercel 에 프런트만 올린 경우에는 fuse-config.js 가 백엔드 주소를 넣어준다.
 */

const raw = (typeof window !== 'undefined' && window.FUSE_ORIGIN) || '';
export const API_ORIGIN = raw.replace(/\/$/, '');

/** 다른 출처에 붙는가 — 쿠키와 CORS 처리가 달라진다 */
export const isCrossOrigin = !!API_ORIGIN && API_ORIGIN !== location.origin;

export const apiUrl = (path) => API_ORIGIN + path;

export function wsUrl(path = '/ws') {
  if (!API_ORIGIN) {
    return (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + path;
  }
  return API_ORIGIN.replace(/^http/, 'ws') + path;
}

/**
 * 출처가 다르면 쿠키를 실어 보내야 로그인 세션이 유지된다.
 * 같은 출처면 same-origin 으로 두는 편이 안전하다.
 */
export const credentialsMode = isCrossOrigin ? 'include' : 'same-origin';
