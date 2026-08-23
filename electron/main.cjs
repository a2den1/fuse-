/*
 * Fuse 데스크톱.
 *
 * 서버를 이 프로세스 안에서 띄운다. 그래서 디스코드 게이트웨이 연결도,
 * 웹소켓도, 파일 저장도 전부 평소처럼 동작한다. 호스팅이 필요 없다.
 *
 * 디스코드 자격증명은 저장소가 아니라 사용자 폴더에 둔다.
 *   Windows: %APPDATA%\Fuse\credentials.json
 */
const { app, BrowserWindow, shell, dialog, ipcMain, Menu, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const APP_ROOT = path.join(__dirname, '..');
const USER_DIR = app.getPath('userData');
const CRED_FILE = path.join(USER_DIR, 'credentials.json');
const DATA_DIR = path.join(USER_DIR, 'data');
const LOG_FILE = path.join(USER_DIR, 'fuse.log');

/* ------------------------------ 로그 ------------------------------ */

/*
 * 패키징된 앱은 콘솔이 없어서 console.log 가 어디에도 남지 않는다.
 * 무엇이 잘못됐는지 볼 방법이 있어야 하므로 파일로도 함께 남긴다.
 */
function initLog() {
  try {
    fs.mkdirSync(USER_DIR, { recursive: true });
    // 너무 커지면 한 번 비운다
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 512 * 1024) {
      fs.writeFileSync(LOG_FILE, '');
    }
  } catch { /* 로그를 못 써도 앱은 떠야 한다 */ }

  const stamp = () => new Date().toISOString().slice(11, 23);
  const write = (level, args) => {
    const line = '[' + stamp() + '] ' + level + ' ' +
      args.map((a) => (a instanceof Error ? (a.stack || a.message) : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* noop */ }
  };

  for (const level of ['log', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => { original(...args); write(level.toUpperCase(), args); };
  }

  process.on('uncaughtException', (err) => console.error('처리되지 않은 예외:', err));
  process.on('unhandledRejection', (err) => console.error('처리되지 않은 거부:', err));

  console.log('--- Fuse ' + app.getVersion() + ' 시작 (' + process.platform + ') ---');
  console.log('설정 폴더: ' + USER_DIR);
}
initLog();

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
  // 여기서 넣은 자격증명이 옆에 있는 .env 에 밀리지 않게 한다
  process.env.FUSE_CREDENTIALS_FROM_HOST = '1';
  // 연결에 실패해도 서버가 프로세스를 죽이지 않고 예외를 던지게 한다
  process.env.FUSE_EMBEDDED = '1';

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

/*
 * 새 버전으로 올라왔으면 화면 캐시를 한 번 비운다.
 *
 * 서버가 코드 파일에 no-cache 를 붙이므로 원래는 필요 없지만,
 * 그 이전 버전이 남긴 max-age 캐시는 서버가 뭐라고 하든 만료될 때까지 살아 있다.
 * 설치를 했는데 옛 화면이 뜨는 일은 한 번으로 족하다.
 */
async function clearCacheIfUpgraded() {
  const stamp = path.join(USER_DIR, 'version');
  let seen = null;
  try { seen = fs.readFileSync(stamp, 'utf8').trim(); } catch { /* 첫 실행 */ }
  if (seen === app.getVersion()) return;

  try {
    await session.defaultSession.clearCache();
    console.log('버전이 바뀌어 화면 캐시를 비웠습니다: ' + (seen || '없음') + ' -> ' + app.getVersion());
  } catch (err) {
    console.warn('캐시를 비우지 못했습니다: ' + err.message);
  }
  try { fs.writeFileSync(stamp, app.getVersion()); } catch { /* 다음에 다시 비우면 된다 */ }
}

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

  console.log('창을 엽니다: ' + startUrl);
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // ready-to-show 가 안 오면 창이 영영 안 보인다. 안전장치로 한 번 더 띄운다.
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.warn('ready-to-show 가 오지 않아 창을 강제로 띄웁니다.');
      mainWindow.show();
    }
  }, 4000);

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('페이지 로드 실패 (' + code + ' ' + desc + '): ' + url);
  });

  /*
   * 로그인이 끝나 앱 화면으로 돌아온 순간 쿠키를 디스크에 내린다.
   * 종료할 때만 저장하면, 그전에 강제로 꺼졌을 때 로그인이 날아간다.
   */
  mainWindow.webContents.on('did-navigate', (_e, url) => {
    if (!url.startsWith(ORIGIN) || url.includes('/login.html')) return;
    session.defaultSession.cookies.flushStore()
      .then(() => console.log('로그인 상태를 저장했습니다.'))
      .catch(() => {});
  });

  // 화면 쪽 오류를 앱 로그로 끌어올린다.
  // 이게 없으면 설정 화면이 조용히 죽어도 원인을 볼 방법이 없다.
  // 시그니처가 Electron 버전마다 다르다.
  // 예전: (event, level, message, line, sourceId) / 지금: (details)
  mainWindow.webContents.on('console-message', function onConsole(...args) {
    const first = args[0];
    const isDetails = first && typeof first === 'object' && 'message' in first;
    const level = isDetails ? first.level : args[1];
    const text = isDetails ? first.message : args[2];
    const serious = level === 'error' || level === 'warning' || level === 2 || level === 3;
    if (serious && text) console.error('[화면] ' + text);
  });
  mainWindow.webContents.on('preload-error', (_e, preloadPath, error) => {
    console.error('[preload] ' + preloadPath + ' — ' + error.message);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[화면] 렌더러가 종료됨: ' + details.reason);
  });

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
  console.log('이미 실행 중인 Fuse 가 있어 이 창은 닫습니다.');
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    await clearCacheIfUpgraded();

    const creds = readCredentials();
    if (!creds) {
      console.log('자격증명이 없습니다. 설정 화면을 띄웁니다.');
      createWindow('file://' + path.join(__dirname, 'setup.html'));
      return;
    }

    console.log('자격증명을 찾았습니다. 서버를 시작합니다.');
    applyEnv(creds);

    let failure = null;
    try {
      await startServer();
    } catch (err) {
      failure = err;
      console.error('서버 시작 실패:', err);
    }

    const up = failure ? false : await waitForServer();
    console.log('서버 응답: ' + (up ? '정상' : '없음'));

    if (up) {
      createWindow(ORIGIN);
      return;
    }

    /*
     * 붙지 못했다. 대개 토큰이 바뀌었거나 특권 인텐트가 꺼진 경우다.
     * 여기서 그냥 죽으면 다음 실행 때도 같은 자리에서 막히므로,
     * 이유를 알려주고 설정 화면으로 되돌려 다시 입력할 수 있게 한다.
     */
    const reason = failure && /invalid token/i.test(failure.message)
      ? '봇 토큰이 올바르지 않습니다. 개발자 포털에서 토큰을 다시 확인해 주세요.'
      : failure && /disallowed intents/i.test(failure.message)
        ? '특권 인텐트가 꺼져 있습니다.\n개발자 포털 → Bot → Privileged Gateway Intents 에서\nMESSAGE CONTENT 와 SERVER MEMBERS 를 켜 주세요.'
        : '디스코드에 접속하지 못했습니다.\n' + (failure ? failure.message : '');

    // 잘못된 자격증명은 치워서 설정 화면이 뜨게 한다 (되돌릴 수 있게 보관)
    const rejected = path.join(USER_DIR, 'credentials.rejected.json');
    try {
      try {
        fs.renameSync(CRED_FILE, rejected);
      } catch {
        // 동기화 폴더에서는 rename 이 막히기도 한다. 복사 후 지우는 것으로 대신한다.
        fs.copyFileSync(CRED_FILE, rejected);
        fs.unlinkSync(CRED_FILE);
      }
      console.log('자격증명을 credentials.rejected.json 으로 옮겼습니다.');
    } catch (err) {
      console.warn('자격증명을 옮기지 못했습니다: ' + err.message);
    }

    dialog.showErrorBox('디스코드에 연결하지 못했습니다', reason + '\n\n로그: ' + LOG_FILE);
    createWindow('file://' + path.join(__dirname, 'setup.html'));
  });

  /*
   * 창을 닫으면 확실히 끝내야 한다.
   *
   * 디스코드 게이트웨이 연결과 HTTP·웹소켓 서버가 이벤트 루프를 붙잡고 있어서
   * app.quit() 만으로는 프로세스가 남는 경우가 있다. 그렇게 남은 프로세스가
   * 중복 실행 잠금과 포트를 쥐고 있으면, 다음에 앱을 눌러도 조용히 종료되어
   * "실행이 안 된다" 처럼 보인다. 잠깐 기다린 뒤 강제로 내린다.
   */
  const forceExit = async () => {
    console.log('종료합니다.');

    /*
     * 로그인 쿠키를 먼저 디스크에 내린다.
     * app.exit() 은 정리 과정을 건너뛰기 때문에, 이걸 빼먹으면
     * 서버에는 세션이 남아 있는데 쿠키만 사라져서 다음에 켤 때 다시 로그인해야 한다.
     */
    try {
      await session.defaultSession.cookies.flushStore();
      console.log('로그인 정보를 저장했습니다.');
    } catch (err) {
      console.warn('쿠키 저장 실패: ' + err.message);
    }

    app.quit();
    setTimeout(() => app.exit(0), 1200).unref?.();
  };

  app.on('window-all-closed', forceExit);
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow(ORIGIN);
  });
}
