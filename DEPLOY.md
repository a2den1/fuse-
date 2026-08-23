# 배포하기

## 먼저 알아야 할 것

Fuse는 **프로세스가 계속 살아 있어야** 동작합니다.

- 디스코드 **게이트웨이 연결**을 붙잡고 있어야 새 메시지를 받습니다
- 브라우저와 **웹소켓**을 유지해야 실시간 반영이 됩니다
- 메시지 캐시와 로그인 세션이 **메모리**에 있습니다

Vercel의 서버리스 함수는 요청이 끝나면 사라지고, 웹소켓 서버를 띄울 수 없으며,
파일 시스템이 읽기 전용입니다. **그래서 Fuse 전체를 Vercel에만 올릴 수는 없습니다.**

대신 이렇게 나눕니다.

```
Vercel  ─────────────  화면 (HTML/CSS/JS 정적 파일)
   │
   │  API 요청 · 웹소켓
   ▼
백엔드  ─────────────  Express + 디스코드 봇  (Railway / Render / Fly.io / 직접 서버)
   │
   ▼
디스코드
```

화면만 필요하다면 Vercel 배포만으로도 열리지만, 로그인과 피드는 백엔드가 있어야 동작합니다.

---

## 1. 백엔드 먼저 올리기

프로세스가 유지되는 곳이면 어디든 됩니다. `Dockerfile` 이 들어 있습니다.

### Railway / Render 기준

1. 이 저장소를 연결하고 Docker 로 빌드
2. 환경변수를 넣습니다

   ```env
   DISCORD_CLIENT_ID=...
   DISCORD_CLIENT_SECRET=...
   DISCORD_BOT_TOKEN=...

   SESSION_SECRET=길고_임의의_문자열

   # 백엔드 자신의 주소
   BASE_URL=https://fuse-api.up.railway.app

   # 화면이 올라간 Vercel 주소
   FUSE_APP_URL=https://fuse.vercel.app
   FUSE_ALLOWED_ORIGINS=https://fuse.vercel.app
   ```

3. `data/` 에 볼륨을 붙입니다. 안 붙이면 재배포할 때마다 좋아요·알림·쪽지가 사라집니다.
4. 디스코드 개발자 포털 **OAuth2 → Redirects** 에 아래를 추가합니다.

   ```
   https://fuse-api.up.railway.app/auth/callback
   ```

`FUSE_ALLOWED_ORIGINS` 를 넣으면 서버가 그 출처에 대해서만 CORS를 열고,
세션 쿠키를 `SameSite=None; Secure` 로 내보냅니다. **https 가 아니면 로그인이 유지되지 않습니다.**

---

## 2. Vercel 에 화면 올리기

1. Vercel 에서 이 저장소를 Import
2. 빌드 설정은 `vercel.json` 이 이미 잡아둡니다 (빌드 명령 `node scripts/vercel-build.mjs`, 출력 `public`)
3. **Environment Variables** 에 백엔드 주소를 넣습니다

   ```env
   FUSE_BACKEND_ORIGIN=https://fuse-api.up.railway.app
   ```

4. 배포

빌드가 이 값을 `public/fuse-config.js` 에 적어 넣고, 화면은 그 주소로 API와 웹소켓을 붙입니다.
값이 비어 있으면 화면은 뜨지만 로그인이 안 되고, 빌드 로그에 경고가 남습니다.

---

## 한 대에 통째로 올리기 (더 간단)

굳이 나눌 이유가 없다면 백엔드 하나만 띄우면 됩니다. Express 가 화면도 같이 서빙합니다.

```bash
docker build -t fuse .
docker run -d --name fuse -p 3000:3000 --env-file .env -v fuse-data:/app/data fuse
```

이때는 `FUSE_APP_URL` 과 `FUSE_ALLOWED_ORIGINS` 를 비워두세요. 같은 출처가 되어 CORS도 필요 없습니다.

---

## 환경변수 정리

| 이름 | 필수 | 설명 |
|---|---|---|
| `DISCORD_CLIENT_ID` | ✅ | OAuth2 클라이언트 ID |
| `DISCORD_CLIENT_SECRET` | ✅ | OAuth2 시크릿 |
| `DISCORD_BOT_TOKEN` | ✅ | 봇 토큰 |
| `SESSION_SECRET` | ✅ | 로그인 쿠키 서명 키 |
| `BASE_URL` | ✅ | 백엔드 자신의 공개 주소 |
| `PORT` | | 기본 3000 |
| `FUSE_APP_URL` | 나눠 올릴 때 | 로그인 후 돌아갈 화면 주소 |
| `FUSE_ALLOWED_ORIGINS` | 나눠 올릴 때 | CORS 허용 출처 (쉼표로 여러 개) |
| `FUSE_REPLY_MODE` | | `reply`(기본) / `webhook` / `thread` |
| `FUSE_HIDDEN_GUILDS` | | Fuse 에 노출하지 않을 서버 ID |
| `FUSE_UPLOAD_LIMIT` | | 첨부 용량 상한 (바이트, 기본 8MB) |

`FUSE_BACKEND_ORIGIN` 은 Vercel 쪽에만 넣습니다 (빌드 때만 씁니다).

---

## 확인

```bash
curl https://fuse-api.up.railway.app/healthz
```

```json
{ "ok": true, "demo": false, "ready": true }
```

`ready: false` 면 봇이 아직 게이트웨이에 못 붙은 것입니다. 로그에서 특권 인텐트 안내를 확인하세요
([SETUP.md](SETUP.md) 2단계).

---

## 규모가 커지면

지금 구조는 **한 대에서 도는 것**을 전제로 합니다. 세션과 메시지 캐시가 메모리에 있어서
백엔드를 여러 대로 늘리면 로그인이 왔다 갔다 하고 실시간 이벤트가 일부만 전달됩니다.

늘려야 할 때가 오면 이 두 가지부터 밖으로 빼야 합니다.

- 세션 → Redis 같은 공유 저장소 (`src/session.js` 의 `sessions` Map)
- 실시간 이벤트 → Redis pub/sub (`src/realtime.js` 의 `clients` Map)

디스코드 봇 자체는 한 프로세스만 게이트웨이에 붙어야 하므로, 봇과 웹 서버를 분리하는 편이 낫습니다.
