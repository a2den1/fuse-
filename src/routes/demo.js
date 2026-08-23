/** 데모 모드 전용 정적 자산 — 외부 이미지 없이 아바타/서버 아이콘을 그려준다 */
import express from 'express';

export const router = express.Router();

const PALETTE = ['#f0913a', '#5b8def', '#57c98a', '#c96fd8', '#e05c6e', '#3fb9c4', '#d8a13f', '#8b7ff0', '#5aa469', '#e0708f'];

const pick = (seed) => {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

const LABELS = {
  100: '에', 101: '소', 102: '민', 103: '유', 104: '도',
  105: '서', 106: '지', 107: '하', 108: '태', 109: '나', 1: 'F',
  g1: 'R', g2: '프', g3: 'F', g4: '인', g5: '사',
};

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp(((n >> 16) & 255) + amount);
  const g = clamp(((n >> 8) & 255) + amount);
  const b = clamp((n & 255) + amount);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

function svg({ id, rounded }) {
  const base = pick(id);
  const label = LABELS[id] || String(id).slice(-1).toUpperCase();
  const radius = rounded ? 26 : 64;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="' + shade(base, 26) + '"/>' +
    '<stop offset="1" stop-color="' + shade(base, -26) + '"/>' +
    '</linearGradient></defs>' +
    '<rect width="128" height="128" rx="' + radius + '" fill="url(#g)"/>' +
    '<text x="64" y="64" fill="#fff" font-size="56" font-weight="700" text-anchor="middle" ' +
    'dominant-baseline="central" font-family="Pretendard, system-ui, sans-serif">' + label + '</text>' +
    '</svg>';
}

function serve(res, body) {
  res.type('image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(body);
}

router.get('/avatar/:id.svg', (req, res) => serve(res, svg({ id: req.params.id, rounded: false })));
router.get('/guild/:id.svg', (req, res) => serve(res, svg({ id: req.params.id, rounded: true })));

// 데모에서 올린 첨부 파일을 되돌려준다
router.get('/upload/:key/:name', async (req, res) => {
  const { uploads } = await import('../demo/mock.js');
  const file = uploads.get(req.params.key);
  if (!file) return res.status(404).end();
  res.type(file.mimetype || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(file.buffer);
});
