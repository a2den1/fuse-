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

/*
 * 이미 만들어 둔 게 로고보다 새것이면 그냥 넘어간다.
 *
 * 이 단계는 아이콘 하나 그리자고 Electron 창을 띄운다. 앱이 떠 있거나
 * 앞선 실행이 남아 있으면 같은 사용자 폴더를 두고 다투다가 캐시를 못 만들고
 * 그대로 멈춰 선다. 빌드가 통째로 거기서 멈춰 버리므로,
 * 다시 그릴 이유가 없으면 아예 띄우지 않는다.
 */
const OUT_PNG = path.join(OUT_DIR, 'icon.png');
if (fs.existsSync(OUT_PNG) && fs.statSync(OUT_PNG).mtimeMs >= fs.statSync(SVG).mtimeMs) {
  console.log('[icon] 로고가 그대로라 다시 그리지 않습니다: ' + path.relative(ROOT, OUT_PNG));
  process.exit(0);
}

// 혹시 창이 뜨지 못하고 매달리더라도 빌드까지 붙잡고 있지는 않게
const bail = setTimeout(() => {
  console.error('[icon] 아이콘을 그리지 못했습니다 (시간 초과). 있던 아이콘을 그대로 씁니다.');
  process.exit(fs.existsSync(OUT_PNG) ? 0 : 1);
}, 30_000);
bail.unref?.();

app.whenReady().then(async () => {
  clearTimeout(bail);
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
