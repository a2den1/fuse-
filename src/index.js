import http from 'node:http';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';

import { config, ROOT } from './config.js';
import { getSession } from './session.js';
import * as realtime from './realtime.js';
import * as svc from './service.js';
import { router as authRouter } from './routes/auth.js';
import { router as apiRouter } from './routes/api.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

/*
 * 프런트엔드를 다른 출처에 올린 경우에만 CORS를 켠다.
 * 허용 목록에 없는 출처는 그냥 무시하고 헤더를 붙이지 않는다.
 */
if (config.allowedOrigins.length) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin.replace(/\/$/, ''))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });
}

app.use('/auth', authRouter);
app.use('/api', apiRouter);

if (config.demo) {
  const { router: demoRouter } = await import('./routes/demo.js');
  app.use('/demo', demoRouter);
}

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, demo: config.demo, ready: svc.activeBackend()?.ready ?? false });
});

// morphicons 런타임 — 아이콘 모핑에 쓴다. 의존성 없는 순수 ESM이라 그대로 내보내면 된다.
app.use('/vendor/morphicons', express.static(path.join(ROOT, 'node_modules/morphicons/dist'), {
  index: false,
  maxAge: config.dev ? 0 : '7d',
  setHeaders(res) { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); },
}));

/*
 * 코드(html/css/js)는 절대 붙잡아 두지 않는다.
 *
 * 예전에는 1시간 max-age 를 줬는데, 그러면 브라우저가 재검증조차 하지 않아서
 * 앱을 새로 설치해도 한 시간 동안 옛 화면이 그대로 떴다. 셸만 no-cache 여도
 * 그 셸이 불러오는 스크립트와 스타일이 옛것이면 결국 옛 앱이다.
 *
 * no-cache 는 "쓰지 마라" 가 아니라 "쓰기 전에 물어봐라" 이다.
 * ETag 가 같으면 304 한 줄로 끝나므로 로컬에서는 사실상 공짜다.
 * 내용이 잘 바뀌지 않는 폰트·이미지만 길게 잡아 둔다.
 */
const CODE = /\.(html|css|js|mjs|map)$/i;

app.use(express.static(config.publicDir, {
  index: false,
  etag: true,
  lastModified: true,
  maxAge: 0,
  setHeaders(res, filePath) {
    if (config.dev || CODE.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      // 폰트·아이콘·이미지 — 바뀌면 파일 이름이 바뀐다
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }
  },
}));

// SPA 폴백 — 로그인 안 했으면 로그인 화면으로
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path.startsWith('/demo')) {
    return res.status(404).json({ error: '없는 경로입니다.' });
  }
  if (!getSession(req)) return res.redirect('/login.html');
  res.sendFile(path.join(config.publicDir, 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error('[server]', err);
  res.status(err?.status || 500).json({ error: err?.message || '서버 오류' });
});

const server = http.createServer(app);
realtime.attach(server);

try {
  await svc.boot();
} catch (err) {
  /*
   * 데스크톱 앱 안에서 돌 때는 여기서 프로세스를 죽이면 안 된다.
   * 창도 못 띄운 채 프로세스만 남아 포트와 중복 실행 잠금을 쥐고 있게 되고,
   * 그다음부터는 앱을 눌러도 아무 일이 없는 것처럼 보인다.
   * 부른 쪽이 사정을 알고 처리하도록 그대로 던진다.
   */
  if (process.env.FUSE_EMBEDDED === '1') {
    console.error('[fuse] 디스코드 연결 실패:', err.message);
    throw err;
  }
  console.error('[fuse] 디스코드 연결에 실패해 종료합니다.');
  process.exit(1);
}

server.listen(config.port, config.host, () => {
  console.log('[fuse] http://localhost:' + config.port + ' 에서 실행 중' + (config.demo ? ' (데모 모드)' : ''));
});

const shutdown = () => {
  console.log('\n[fuse] 종료합니다.');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
