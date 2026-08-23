import express from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { getSession } from '../session.js';
import * as svc from '../service.js';

export const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploadLimitBytes, files: 4 },
});

/** async 핸들러의 예외를 에러 미들웨어로 넘긴다 */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use((req, res, next) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: '로그인이 필요합니다.', code: 'UNAUTHENTICATED' });
  req.session = session;
  next();
});

const filesFrom = (req) => (req.files || []).map((f) => ({
  buffer: f.buffer, name: f.originalname, mimetype: f.mimetype, size: f.size,
}));

/* ------------------------------- 기본 ------------------------------- */

router.get('/me', wrap(async (req, res) => {
  res.json(await svc.me(req.session));
}));

router.get('/guilds', wrap(async (req, res) => {
  res.json({ guilds: await svc.guildsFor(req.session) });
}));

/* ------------------------------- 피드 ------------------------------- */

router.get('/feed', wrap(async (req, res) => {
  const before = req.query.cursor ? Number(req.query.cursor) : null;
  res.json(await svc.feed(req.session, {
    guildId: req.query.guild || null,
    before: Number.isFinite(before) ? before : null,
    limit: Math.min(Number(req.query.limit) || config.feed.pageSize, 50),
  }));
}));

router.get('/channel/:channelId', wrap(async (req, res) => {
  const before = req.query.cursor ? Number(req.query.cursor) : null;
  res.json(await svc.channelFeed(req.session, req.params.channelId, {
    before: Number.isFinite(before) ? before : null,
  }));
}));

router.get('/post/:channelId/:messageId', wrap(async (req, res) => {
  res.json(await svc.detail(req.session, req.params.channelId, req.params.messageId));
}));

/* ------------------------------ 글쓰기 ------------------------------ */

router.post('/post', upload.array('files', 4), wrap(async (req, res) => {
  const post = await svc.createPost(req.session, {
    channelId: req.body.channelId,
    content: req.body.content || '',
    files: filesFrom(req),
  });
  res.status(201).json({ post });
}));

router.post('/post/:channelId/:messageId/reply', upload.array('files', 4), wrap(async (req, res) => {
  const post = await svc.createReply(req.session, {
    channelId: req.params.channelId,
    messageId: req.params.messageId,
    content: req.body.content || '',
    files: filesFrom(req),
  });
  res.status(201).json({ post });
}));

router.patch('/post/:channelId/:messageId', wrap(async (req, res) => {
  const post = await svc.editPost(req.session, req.params.channelId, req.params.messageId, req.body.content);
  res.json({ post });
}));

router.delete('/post/:channelId/:messageId', wrap(async (req, res) => {
  res.json(await svc.deletePost(req.session, req.params.channelId, req.params.messageId));
}));

/* --------------------------- 좋아요·리액션 --------------------------- */

router.post('/post/:channelId/:messageId/like', wrap(async (req, res) => {
  res.json(await svc.like(req.session, req.params.channelId, req.params.messageId));
}));

router.post('/post/:channelId/:messageId/react', wrap(async (req, res) => {
  const post = await svc.react(
    req.session, req.params.channelId, req.params.messageId,
    req.body.emoji, req.body.on !== false,
  );
  res.json({ post });
}));

// 누가 눌렀는지 — 칩에 마우스를 올렸을 때만 물어본다
router.get('/post/:channelId/:messageId/reactors', wrap(async (req, res) => {
  const users = await svc.reactionUsers(
    req.session, req.params.channelId, req.params.messageId, String(req.query.emoji || ''),
  );
  res.json({ users });
}));

/* ------------------------------- 탐색 ------------------------------- */

router.get('/search', wrap(async (req, res) => {
  res.json(await svc.search(req.session, req.query.q || ''));
}));

router.get('/discover', wrap(async (req, res) => {
  res.json({ guilds: await svc.discover(req.session) });
}));

router.post('/guild/:guildId/join', wrap(async (req, res) => {
  res.json(await svc.joinGuild(req.session, req.params.guildId));
}));

router.post('/guild/:guildId/pin', wrap(async (req, res) => {
  res.json(svc.togglePin(req.session, req.params.guildId));
}));

router.get('/guild/:guildId', wrap(async (req, res) => {
  res.json(await svc.guildDetail(req.session, req.params.guildId));
}));

router.get('/guild/:guildId/members', wrap(async (req, res) => {
  res.json({ members: await svc.members(req.session, req.params.guildId, req.query.q || '') });
}));

/* ------------------------------ 프로필 ------------------------------ */

router.get('/user/:userId', wrap(async (req, res) => {
  res.json(await svc.profile(req.session, req.params.userId));
}));

router.patch('/profile', wrap(async (req, res) => {
  res.json(svc.updateProfile(req.session, req.body));
}));

/* ------------------------------- 알림 ------------------------------- */

router.get('/activity', wrap(async (req, res) => {
  res.json(svc.activity(req.session));
}));

router.post('/activity/read', wrap(async (req, res) => {
  res.json(svc.readActivity(req.session));
}));

/* ------------------------------- 쪽지 ------------------------------- */

router.get('/dm', wrap(async (req, res) => {
  res.json({ conversations: await svc.listConversations(req.session) });
}));

router.get('/dm/:userId', wrap(async (req, res) => {
  res.json(await svc.getConversation(req.session, req.params.userId));
}));

router.post('/dm/:userId', upload.array('files', 4), wrap(async (req, res) => {
  res.status(201).json({
    message: await svc.sendDM(req.session, req.params.userId, req.body.content, filesFrom(req)),
  });
}));

/* ------------------------------- 설정 ------------------------------- */

router.get('/settings', wrap(async (req, res) => {
  res.json(svc.getSettings(req.session));
}));

router.patch('/settings', wrap(async (req, res) => {
  res.json(svc.patchSettings(req.session, req.body));
}));

/* ------------------------------- 기타 ------------------------------- */

router.post('/typing', wrap(async (req, res) => {
  await svc.typing(req.session, req.body.channelId);
  res.json({ ok: true });
}));

/* ------------------------------ 에러 처리 ------------------------------ */

router.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '파일이 너무 큽니다. ' + Math.round(config.uploadLimitBytes / 1024 / 1024) + 'MB까지 올릴 수 있습니다.' });
  }
  if (err?.code === 'LIMIT_FILE_COUNT') {
    return res.status(413).json({ error: '파일은 한 번에 4개까지 올릴 수 있습니다.' });
  }
  const status = err?.status || 500;
  if (status >= 500) console.error('[api]', err);
  res.status(status).json({ error: err?.message || '알 수 없는 오류가 발생했습니다.' });
});
