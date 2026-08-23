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

app.use(express.static(config.publicDir, {
  index: false,
  // 개발 중에는 캐시를 끈다 — 고친 스크립트가 반영되지 않는 사고를 막는다
  maxAge: config.dev ? 0 : '1h',
  etag: true,
  setHeaders(res, filePath) {
    // 앱 셸은 항상 재검증한다 — 배포 후 옛 화면이 남는 걸 막는다
    if (config.dev || filePath.endsWith('index.html') || filePath.endsWith('login.html')) {
      res.setHeader('Cache-Control', 'no-cache');
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
