/*
 * 앱 아이콘 만들기.
 *
 *   npm run build:appicon
 *
 * 로고 SVG 를 Electron 창에 그려 캡처한 뒤 build/icon.png 로 저장합니다.
 * (electron-builder 가 이 PNG 로 .ico 를 만들어 줍니다)
 */
const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const SVG = path.join(ROOT, 'public/assets/img/favicon.svg');
const OUT_DIR = path.join(ROOT, 'build');
const SIZE = 512;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const svg = fs.readFileSync(SVG, 'utf8');

  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true },
  });

  // 여백 없이 아이콘만 꽉 차게
  const html =
    '<!doctype html><meta charset="utf-8">' +
    '<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}' +
    'svg{display:block;width:' + SIZE + 'px;height:' + SIZE + 'px}</style>' +
    svg;

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 350));   // 렌더가 끝날 시간

  const image = await win.webContents.capturePage();
  if (image.isEmpty()) {
    console.error('[icon] 캡처에 실패했습니다.');
    app.exit(1);
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 원본 + electron-builder 가 참고할 크기들
  for (const size of [512, 256]) {
    const resized = size === SIZE ? image : image.resize({ width: size, height: size, quality: 'best' });
    const file = path.join(OUT_DIR, size === 256 ? 'icon.png' : 'icon@512.png');
    fs.writeFileSync(file, resized.toPNG());
    console.log('[icon] ' + path.relative(ROOT, file) + '  ' + size + 'x' + size);
  }

  win.destroy();
  app.exit(0);
});
