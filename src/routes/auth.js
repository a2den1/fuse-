import crypto from 'node:crypto';
import express from 'express';
import { config } from '../config.js';
import { createSession, setSessionCookie, destroySession, clearSessionCookie, getSession } from '../session.js';

export const router = express.Router();

const API = 'https://discord.com/api/v10';
const STATE_COOKIE = 'fuse_state';

const CDN = 'https://cdn.discordapp.com';

function avatarUrl(u) {
  if (u.avatar) {
    const ext = u.avatar.startsWith('a_') ? 'gif' : 'png';
    return CDN + '/avatars/' + u.id + '/' + u.avatar + '.' + ext + '?size=128';
  }
  // 신규 유저네임 체계는 (id >> 22) % 6, 구 체계는 discriminator % 5
  const index = u.discriminator && u.discriminator !== '0'
    ? Number(u.discriminator) % 5
    : Number((BigInt(u.id) >> 22n) % 6n);
  return CDN + '/embed/avatars/' + index + '.png';
}

function normalizeOAuthUser(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.global_name || u.username,
    avatar: avatarUrl(u),
    banner: u.banner ? CDN + '/banners/' + u.id + '/' + u.banner + '.png?size=512' : null,
    email: u.email || null,
    bot: false,
    accent: u.accent_color ? '#' + u.accent_color.toString(16).padStart(6, '0') : null,
    roles: [],
  };
}

/* ------------------------------ 로그인 ------------------------------ */

router.get('/login', (req, res) => {
  // 데모 모드에서는 디스코드를 거치지 않고 바로 데모 계정으로 들어간다
  if (config.demo) {
    return import('../demo/mock.js').then(({ DEMO_USER }) => {
      const session = createSession({
        userId: DEMO_USER.id,
        user: { ...DEMO_USER },
        accessToken: null,
        refreshToken: null,
      });
      setSessionCookie(res, session);
      res.redirect(config.appUrl + '/');
    });
  }

  const state = crypto.randomBytes(16).toString('base64url');
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true, sameSite: 'lax', maxAge: 10 * 60_000, path: '/',
    secure: config.baseUrl.startsWith('https://'),
  });

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: config.scopes.join(' '),
    state,
    prompt: 'consent',
  });
  res.redirect(API.replace('/api/v10', '') + '/oauth2/authorize?' + params);
});

/* ------------------------------ 콜백 ------------------------------ */

router.get('/callback', async (req, res) => {
  const { code, state, error, error_description: desc } = req.query;

  if (error) {
    return res.redirect(config.appUrl + '/login.html?error=' + encodeURIComponent(desc || error));
  }
  if (!code) {
    return res.redirect(config.appUrl + '/login.html?error=' + encodeURIComponent('인증 코드가 없습니다.'));
  }
  if (!state || state !== req.cookies?.[STATE_COOKIE]) {
    return res.redirect(config.appUrl + '/login.html?error=' + encodeURIComponent('요청이 변조되었습니다. 다시 시도해 주세요.'));
  }
  res.clearCookie(STATE_COOKIE, { path: '/' });

  try {
    const tokenRes = await fetch(API + '/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: config.redirectUri,
      }),
    });
    if (!tokenRes.ok) {
      throw new Error('토큰 교환 실패 (' + tokenRes.status + ') ' + (await tokenRes.text()));
    }
    const token = await tokenRes.json();

    const auth = { Authorization: 'Bearer ' + token.access_token };
    const userRes = await fetch(API + '/users/@me', { headers: auth });
    if (!userRes.ok) throw new Error('사용자 정보를 가져오지 못했습니다.');

    const user = normalizeOAuthUser(await userRes.json());

    /*
     * 소속 서버 목록은 여기서 받아두지 않는다.
     * 로그인 시점의 목록을 붙들고 있으면 그 뒤에 들어간 서버가 보이지 않는다.
     * 어느 서버에 속해 있는지는 필요할 때 봇이 직접 확인한다.
     */

    const session = createSession({
      userId: user.id,
      user,
      accessToken: token.access_token,
      refreshToken: token.refresh_token || null,
      expiresAt: Date.now() + (token.expires_in || 604800) * 1000,
    });
    setSessionCookie(res, session);
    res.redirect(config.appUrl + '/');
  } catch (err) {
    console.error('[auth] 콜백 실패:', err.message);
    res.redirect(config.appUrl + '/login.html?error=' + encodeURIComponent('로그인에 실패했습니다. 다시 시도해 주세요.'));
  }
});

/* ----------------------------- 로그아웃 ----------------------------- */

router.post('/logout', (req, res) => {
  destroySession(req);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/status', (req, res) => {
  const session = getSession(req);
  res.json({ authenticated: !!session, demo: config.demo, user: session?.user || null });
});
