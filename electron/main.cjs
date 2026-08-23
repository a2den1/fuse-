/*
 * Fuse 데스크톱.
 *
 * 서버를 이 프로세스 안에서 띄운다. 그래서 디스코드 게이트웨이 연결도,
 * 웹소켓도, 파일 저장도 전부 평소처럼 동작한다. 호스팅이 필요 없다.
 *
 * 디스코드 자격증명은 저장소가 아니라 사용자 폴더에 둔다.
 *   Windows: %APPDATA%\Fuse\credentials.json
 */
const { app, BrowserWindow, shell, dialog, ipcMain, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const APP_ROOT = path.join(__dirname, '..');
const USER_DIR = app.getPath('userData');
const CRED_FILE = path.join(USER_DIR, 'credentials.json');
const DATA_DIR = path.join(USER_DIR, 'data');

const PORT = Number(process.env.FUSE_PORT || 5195);
const ORIGIN = 'http://localhost:' + PORT;

let mainWindow = null;
let serverStarted = false;

/* ---------------------------- 자격증명 ---------------------------- */

function readCredentials() {
  try {
    const raw = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'));
    const ok = ['clientId', 'clientSecret', 'botToken'].every((k) => String(raw[k] || '').trim());
    return ok ? raw : null;
  } catch {
    return null;
  }
}

function writeCredentials(values) {
  fs.mkdirSync(USER_DIR, { recursive: true });
  fs.writeFileSync(CRED_FILE, JSON.stringify(values, null, 2), { mode: 0o600 });
}

/** 서버가 읽는 곳은 환경변수다. 파일에서 읽어 여기에 옮겨 담는다. */
function applyEnv(creds) {
  process.env.DISCORD_CLIENT_ID = creds.clientId.trim();
  process.env.DISCORD_CLIENT_SECRET = creds.clientSecret.trim();
  process.env.DISCORD_BOT_TOKEN = creds.botToken.trim();
  process.env.PORT = String(PORT);
  process.env.BASE_URL = ORIGIN;
  process.env.FUSE_DATA_DIR = DATA_DIR;
  process.env.NODE_ENV = 'production';

  // 로그인 쿠키 서명 키 — 이 컴퓨터에서 한 번 만들어 두고 계속 쓴다
  if (!creds.sessionSecret) {
    creds.sessionSecret = require('node:crypto').randomBytes(32).toString('base64url');
    writeCredentials(creds);
  }
  process.env.SESSION_SECRET = creds.sessionSecret;
}

/* ------------------------------ 서버 ------------------------------ */

async function startServer() {
  if (serverStarted) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // src/index.js 는 ESM 이라 동적 import 로 불러온다
  await import('../src/index.js');
  serverStarted = true;
}

/** 서버가 실제로 응답할 때까지 기다린다 (게이트웨이 접속에 몇 초 걸린다) */
async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(ORIGIN + '/healthz');
      if (res.ok) return true;
    } catch {
      /* 아직 안 뜸 */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/* ------------------------------ 창 ------------------------------ */

function createWindow(startUrl) {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 360,
    minHeight: 560,
    backgroundColor: '#000000',
    show: false,
    autoHideMenuBar: true,
    title: 'Fuse',
    icon: path.join(APP_ROOT, 'public/assets/img/app-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(startUrl);

  // 외부 링크는 기본 브라우저로 (디스코드 로그인은 앱 안에서 진행)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    const allowed = target.origin === ORIGIN || target.hostname.endsWith('discord.com');
    if (!allowed) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

/* ---------------------------- 첫 실행 ---------------------------- */

ipcMain.handle('fuse:save-credentials', async (_event, values) => {
  try {
    writeCredentials(values);
    applyEnv(values);
    await startServer();
    const up = await waitForServer();
    if (!up) return { ok: false, error: '서버가 응답하지 않습니다. 봇 토큰과 특권 인텐트를 확인해 주세요.' };
    mainWindow.loadURL(ORIGIN);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('fuse:open-external', (_event, url) => shell.openExternal(url));
ipcMain.handle('fuse:redirect-uri', () => ORIGIN + '/auth/callback');

/* ------------------------------ 부팅 ------------------------------ */

// 두 번 실행되면 게이트웨이가 두 번 붙어 문제가 생긴다
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);

    const creds = readCredentials();
    if (!creds) {
      // 자격증명이 없으면 설정 화면부터
      createWindow('file://' + path.join(__dirname, 'setup.html'));
      return;
    }

    applyEnv(creds);
    try {
      await startServer();
    } catch (err) {
      dialog.showErrorBox('Fuse 를 시작하지 못했습니다', err.message);
      app.quit();
      return;
    }

    const up = await waitForServer();
    if (!up) {
      dialog.showErrorBox(
        'Fuse 를 시작하지 못했습니다',
        '디스코드에 접속하지 못했습니다.\n\n' +
        '개발자 포털에서 MESSAGE CONTENT INTENT 와 SERVER MEMBERS INTENT 가\n' +
        '켜져 있는지, 봇 토큰이 맞는지 확인해 주세요.\n\n' +
        '설정 파일: ' + CRED_FILE,
      );
    }
    createWindow(up ? ORIGIN : 'file://' + path.join(__dirname, 'setup.html'));
  });

  app.on('window-all-closed', () => app.quit());
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow(ORIGIN);
  });
}
