import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 경로를 명시해 어느 디렉터리에서 실행하든 같은 .env 를 읽는다.
const parsed = dotenv.config({ path: path.join(ROOT, '.env') }).parsed || {};

/*
 * 자격증명만은 .env 를 우선한다.
 * 시스템 환경변수에 예전 봇 토큰이 남아 있으면 조용히 그게 이겨서
 * "분명 .env 를 고쳤는데 옛날 봇으로 붙는" 사고가 난다.
 *
 * 반대로 PORT 같은 나머지 값까지 덮어쓰면 `PORT=8080 npm start` 가 먹지 않으므로
 * 덮어쓰기는 아래 세 개로만 좁힌다.
 */
for (const key of ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET']) {
  if (parsed[key]) process.env[key] = parsed[key];
}

const bool = (v, d = false) => {
  if (v === undefined || v === '') return d;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

const port = Number(process.env.PORT || 3000);
const botToken = (process.env.DISCORD_BOT_TOKEN || '').trim();
const clientId = (process.env.DISCORD_CLIENT_ID || '').trim();
const clientSecret = (process.env.DISCORD_CLIENT_SECRET || '').trim();

// 봇 토큰이나 OAuth 자격증명이 없으면 자동으로 데모 모드.
// 데모 모드는 디스코드에 접속하지 않고 목 데이터로 전체 UI를 그대로 굴린다.
const demo = bool(process.env.FUSE_DEMO, !(botToken && clientId && clientSecret));

export const config = {
  dev: process.env.NODE_ENV !== 'production',
  port,
  host: process.env.HOST || '0.0.0.0',
  baseUrl: (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  demo,

  clientId,
  clientSecret,
  botToken,
  get redirectUri() {
    return process.env.DISCORD_REDIRECT_URI || `${this.baseUrl}/auth/callback`;
  },

  // identify  : 기본 프로필
  // email     : 이메일(선택)
  // guilds    : 유저가 속한 서버 목록 — 피드 교집합 계산에 필수
  // guilds.join: 앱 안에서 서버 가입시키기
  // guilds.members.read: 서버별 닉네임/롤 (권한 계산 보조)
  scopes: ['identify', 'email', 'guilds', 'guilds.join', 'guilds.members.read'],

  /**
   * 프런트엔드를 다른 곳(예: Vercel)에 올렸을 때 허용할 출처.
   * 쉼표로 여러 개. 비어 있으면 같은 출처만 쓴다고 보고 CORS를 켜지 않는다.
   */
  allowedOrigins: (process.env.FUSE_ALLOWED_ORIGINS || '')
    .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),

  /** 로그인 끝나고 돌아갈 곳. 프런트를 따로 올렸다면 그 주소. */
  get appUrl() {
    return (process.env.FUSE_APP_URL || this.baseUrl).replace(/\/$/, '');
  },

  sessionSecret: process.env.SESSION_SECRET || 'fuse-dev-secret-change-me',
  sessionTtlMs: 1000 * 60 * 60 * 24 * 30,

  // 데스크톱 앱으로 묶으면 프로그램 폴더가 읽기 전용이라 저장 위치를 밖으로 받는다
  dataDir: process.env.FUSE_DATA_DIR || path.join(ROOT, 'data'),
  publicDir: path.join(ROOT, 'public'),

  // 피드 백필 튜닝
  feed: {
    channelsPerGuild: Number(process.env.FUSE_CHANNELS_PER_GUILD || 12),
    backfillPerChannel: Number(process.env.FUSE_BACKFILL || 40),
    cacheTtlMs: Number(process.env.FUSE_CACHE_TTL || 45_000),
    maxCachedPerChannel: 400,
    pageSize: 25,
  },

  /**
   * 답글을 디스코드에 어떻게 남길지.
   *
   * 웹훅 실행 API에는 message_reference 필드가 없다. 즉 "네이티브 답장"과
   * "회원님 이름·프로필로 보이기"는 동시에 될 수 없다. 하나를 골라야 한다.
   *
   *  reply  (기본) 디스코드 네이티브 답장. 화살표로 원본이 보인다. 다만 작성자는 봇 이름.
   *  webhook 회원님 이름·프사 유지. 답장 화살표 대신 인용문으로 원본을 보여준다.
   *  thread  원본에 스레드를 만들어 그 안에 남긴다 (예전 동작).
   */
  replyMode: ['reply', 'webhook', 'thread'].includes(process.env.FUSE_REPLY_MODE)
    ? process.env.FUSE_REPLY_MODE
    : 'reply',

  // 길드 프리셋: 봇이 들어가 있어도 Fuse에 노출하지 않을 서버
  hiddenGuildIds: (process.env.FUSE_HIDDEN_GUILDS || '').split(',').map((s) => s.trim()).filter(Boolean),

  uploadLimitBytes: Number(process.env.FUSE_UPLOAD_LIMIT || 8 * 1024 * 1024),
};

export const isDemo = () => config.demo;
