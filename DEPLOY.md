# 배포하기

## 가장 쉬운 길 — 한 번 클릭

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/a2den1/fuse-)

`render.yaml` 이 화면·백엔드·디스코드 봇을 한 서비스로 묶어 올립니다.
배포 화면에서 **디스코드 값 3개만** 입력하면 끝입니다.

| 물어보는 것 | 어디서 가져오나 |
|---|---|
| `DISCORD_CLIENT_ID` | 개발자 포털 → OAuth2 |
| `DISCORD_CLIENT_SECRET` | 개발자 포털 → OAuth2 → Reset Secret |
| `DISCORD_BOT_TOKEN` | 개발자 포털 → Bot → Reset Token |

`SESSION_SECRET` 은 Render 가 임의로 만들고, `BASE_URL` 은 배포 주소로 자동으로 채워집니다.
저장 공간(`/app/data`)도 붙어 있어서 재배포해도 좋아요·알림·쪽지가 남습니다.

배포가 끝나면 나온 주소를 **개발자 포털 → OAuth2 → Redirects** 에 추가하세요.

```
https://fuse-xxxx.onrender.com/auth/callback
```

> Free 플랜은 15분 놀면 서비스가 잠들어 봇 연결이 끊깁니다. `starter` 이상을 쓰세요.

---

## 왜 Vercel 하나로는 안 되나

Fuse는 **프로세스가 계속 살아 있어야** 동작합니다.

- 디스코드 **게이트웨이 연결**을 붙잡고 있어야 새 메시지를 받습니다
- 브라우저와 **웹소켓**을 유지해야 실시간 반영이 됩니다
- 메시지 캐시와 로그인 세션이 **메모리**에 있습니다

Vercel 의 서버리스 함수는 응답이 끝나면 사라지고, 웹소켓 서버를 띄울 수 없으며,
파일 시스템이 읽기 전용입니다. 환경변수를 아무리 잘 넣어도 이 세 가지는 해결되지 않습니다.
억지로 올리면 배포는 되지만 **봇이 계속 끊기고 실시간이 죽고 로그인이 유지되지 않습니다.**

Vercel 을 꼭 쓰고 싶다면 화면만 올리고 백엔드는 따로 두면 됩니다. 아래 방법입니다.

---

## Vercel(화면) + 별도 백엔드

```
Vercel  ──  화면 (HTML/CSS/JS 정적 파일)
   │  API · 웹소켓
   ▼
백엔드  ──  Express + 디스코드 봇  (Render / Railway / Fly.io / 직접 서버)
```

### 1. 백엔드 먼저

위의 Render 버튼으로 올리되, 환경변수를 두 개 더 넣습니다.

```env
FUSE_APP_URL=https://fuse.vercel.app
FUSE_ALLOWED_ORIGINS=https://fuse.vercel.app
```

이 값이 있으면 서버가 그 출처에만 CORS 를 열고, 세션 쿠키를 `SameSite=None; Secure` 로 내보냅니다.
**https 가 아니면 로그인이 유지되지 않습니다.**

### 2. Vercel 에 화면

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/a2den1/fuse-&env=FUSE_BACKEND_ORIGIN&envDescription=백엔드%20주소%20(예:%20https://fuse-xxxx.onrender.com))

환경변수 하나만 넣으면 됩니다.

```env
FUSE_BACKEND_ORIGIN=https://fuse-xxxx.onrender.com
```

빌드가 이 값을 `public/fuse-config.js` 에 적어 넣고, 화면은 그 주소로 API 와 웹소켓을 붙입니다.
값이 없으면 화면은 뜨지만 로그인이 안 되고 빌드 로그에 경고가 남습니다.

마지막으로 **개발자 포털 Redirects** 에는 **백엔드** 주소를 넣어야 합니다 (Vercel 주소가 아니라).

---

## 직접 서버에 (Docker)

```bash
docker build -t fuse .
```

```bash
docker run -d --name fuse -p 3000:3000 --env-file .env -v fuse-data:/app/data fuse
```

이때는 `FUSE_APP_URL` 과 `FUSE_ALLOWED_ORIGINS` 를 비워두세요. 같은 출처라 CORS 가 필요 없습니다.

---

## 환경변수

| 이름 | 필수 | 설명 |
|---|---|---|
| `DISCORD_CLIENT_ID` | ✅ | OAuth2 클라이언트 ID |
| `DISCORD_CLIENT_SECRET` | ✅ | OAuth2 시크릿 |
| `DISCORD_BOT_TOKEN` | ✅ | 봇 토큰 |
| `SESSION_SECRET` | ✅ | 로그인 쿠키 서명 키 (길고 임의로) |
| `BASE_URL` | ✅ | 백엔드 자신의 공개 주소 |
| `PORT` | | 기본 3000 |
| `FUSE_APP_URL` | 나눠 올릴 때 | 로그인 후 돌아갈 화면 주소 |
| `FUSE_ALLOWED_ORIGINS` | 나눠 올릴 때 | CORS 허용 출처 (쉼표로 여러 개) |
| `FUSE_BACKEND_ORIGIN` | Vercel 쪽에만 | 화면이 붙을 백엔드 주소 (빌드 때만 사용) |
| `FUSE_REPLY_MODE` | | `reply`(기본) / `webhook` / `thread` |
| `FUSE_HIDDEN_GUILDS` | | Fuse 에 노출하지 않을 서버 ID |
| `FUSE_UPLOAD_LIMIT` | | 첨부 용량 상한 (바이트, 기본 8MB) |

**이 값들은 저장소에 넣지 않습니다.** `.env` 는 `.gitignore` 에 있습니다.
봇 토큰이 깃허브에 올라가면 디스코드가 자동으로 감지해 토큰을 폐기하고,
그 전에 누군가 가져가면 회원님 서버에서 봇으로 무엇이든 할 수 있습니다.
`SESSION_SECRET` 이 새면 남이 로그인 쿠키를 위조해 다른 사용자로 접속할 수 있습니다.

---

## 확인

```bash
curl https://fuse-xxxx.onrender.com/healthz
```

```json
{ "ok": true, "demo": false, "ready": true }
```

`ready: false` 면 봇이 아직 게이트웨이에 못 붙은 것입니다.
로그에서 특권 인텐트 안내를 확인하세요 ([SETUP.md](SETUP.md) 2단계).

---

## 규모가 커지면

지금 구조는 **한 대에서 도는 것**을 전제로 합니다. 세션과 메시지 캐시가 메모리에 있어서
백엔드를 여러 대로 늘리면 로그인이 왔다 갔다 하고 실시간 이벤트가 일부만 전달됩니다.

늘려야 할 때가 오면 이 둘부터 밖으로 빼야 합니다.

- 세션 → Redis 같은 공유 저장소 (`src/session.js` 의 `sessions` Map)
- 실시간 이벤트 → Redis pub/sub (`src/realtime.js` 의 `clients` Map)

디스코드 봇은 한 프로세스만 게이트웨이에 붙어야 하므로, 봇과 웹 서버를 나누는 편이 낫습니다.
