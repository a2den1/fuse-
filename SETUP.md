# 디스코드 봇 연동하기

`.env`가 비어 있으면 Fuse는 **데모 모드**로 뜹니다. 아래 4단계를 마치면 실제 디스코드에 붙습니다.

---

## 1. 애플리케이션 만들기

<https://discord.com/developers/applications> → **New Application** → 이름 `Fuse`

### OAuth2 탭

- `CLIENT ID` 와 `CLIENT SECRET`(Reset Secret) 복사
- **Redirects** 에 아래를 정확히 그대로 추가하고 저장

  ```
  http://localhost:5195/auth/callback
  ```

  > 끝의 `/auth/callback` 까지 한 글자도 다르면 로그인이 `invalid_redirect_uri` 로 실패합니다.
  > 나중에 도메인에 올리면 그 주소도 여기에 추가하고 `.env`의 `BASE_URL` 을 바꾸세요.

### Bot 탭

- **Reset Token** 으로 봇 토큰 발급 후 복사 (이 화면을 벗어나면 다시 못 봅니다)

---

## 2. 특권 인텐트 켜기 — 안 켜면 봇이 아예 안 뜹니다

**Bot → Privileged Gateway Intents** 에서 두 개를 켜고 저장합니다.

| 인텐트 | 왜 필요한가 |
|---|---|
| **MESSAGE CONTENT INTENT** | 글 내용을 읽습니다. 없으면 피드가 전부 빈 글이 됩니다 |
| **SERVER MEMBERS INTENT** | 멤버 목록과 "이 사람이 이 채널을 볼 수 있는가" 계산 |

둘 중 하나라도 꺼져 있으면 서버 실행 시 이런 안내가 뜨고 종료됩니다.

```
[bot] 특권 인텐트가 꺼져 있습니다.
      ... Privileged Gateway Intents 에서 MESSAGE CONTENT INTENT 와
      SERVER MEMBERS INTENT 를 켜 주세요.
```

> 봇이 서버 100개를 넘으면 디스코드 심사를 받아야 이 인텐트를 계속 쓸 수 있습니다.

---

## 3. `.env` 채우기

`E:\Fuse\.env` 를 열어 세 줄을 채웁니다.

```env
DISCORD_CLIENT_ID=여기에_클라이언트_ID
DISCORD_CLIENT_SECRET=여기에_클라이언트_시크릿
DISCORD_BOT_TOKEN=여기에_봇_토큰

PORT=5195
BASE_URL=http://localhost:5195
SESSION_SECRET=아무_긴_임의_문자열
```

`SESSION_SECRET` 은 로그인 쿠키 서명에 쓰이니 기본값 그대로 두지 마세요.

---

## 4. 서버에 봇 초대하기

아래 주소의 `여기에_클라이언트_ID` 만 바꿔서 브라우저로 여세요.
필요한 권한이 이미 다 들어 있습니다.

```
https://discord.com/oauth2/authorize?client_id=여기에_클라이언트_ID&scope=bot%20applications.commands&permissions=309774634048
```

권한 숫자 `309774634048` 에 들어 있는 것들:

| 권한 | 없으면 |
|---|---|
| 채널 보기 / 메시지 기록 읽기 | 피드에 아무것도 안 뜸 |
| 메시지 보내기 | 글쓰기 실패 |
| **웹훅 관리** | 글이 회원님 이름 대신 봇 이름으로 올라감 |
| 공개 스레드 만들기 / 스레드에서 보내기 | 답글이 스레드 대신 인용문으로 남음 |
| 반응 추가 | 리액션 동작 안 함 |
| 파일 첨부 / 링크 첨부 | 사진과 미리보기가 안 올라감 |

**중요:** 봇을 초대한 서버에 **회원님 계정도 가입되어 있어야** 그 서버의 글이 피드에 나옵니다.
Fuse는 "봇이 있는 서버" ∩ "내가 있는 서버" 만 보여줍니다.

---

## 실행

```bash
npm start
```

이렇게 뜨면 성공입니다.

```
[bot] Fuse#1234 로 접속. 길드 3개
[fuse] http://localhost:5195 에서 실행 중
```

`(데모 모드)` 가 붙어 있으면 `.env` 세 값 중 하나가 비어 있는 겁니다.

---

## 잘 안 될 때

| 증상 | 원인 |
|---|---|
| `(데모 모드)` 로 뜬다 | `.env` 의 CLIENT_ID / SECRET / BOT_TOKEN 중 빈 값이 있음 |
| `disallowed intents` | 2단계 인텐트를 안 켬 |
| 로그인 후 `invalid_redirect_uri` | Redirects 주소가 `BASE_URL` + `/auth/callback` 과 다름 |
| 피드가 비어 있음 | 봇은 있는데 내 계정이 그 서버에 없음, 또는 봇에게 채널 보기 권한이 없음 |
| 글은 보이는데 내용이 비어 있음 | MESSAGE CONTENT INTENT 꺼짐 |
| 내 글이 봇 이름으로 올라감 | 웹훅 관리 권한 없음 |
| 답글이 스레드가 아니라 인용문으로 남음 | 공개 스레드 만들기 권한 없음 |
| 로그인은 되는데 서버 목록이 비어 있음 | OAuth 동의 화면에서 `guilds` 권한을 거부함 — 다시 로그인 |

시스템 환경변수에 예전 `DISCORD_TOKEN` 같은 값이 남아 있어도 괜찮습니다.
`config.js` 가 `.env` 를 우선하도록(`override: true`) 되어 있습니다.

---

## 답글 방식 바꾸기

디스코드 **웹훅 실행 API에는 `message_reference` 필드가 없습니다.** 즉
"네이티브 답장(화살표로 원본이 딸려 보이는 그것)"과 "내 이름·프사로 보이기"는 동시에 안 됩니다.
`.env` 의 `FUSE_REPLY_MODE` 로 고릅니다.

| 값 | 디스코드에서 보이는 모습 | 작성자 표시 |
|---|---|---|
| `reply` (기본) | 진짜 답장. 원본이 화살표로 딸려 보임 | **봇 이름** |
| `webhook` | 원본이 인용문으로 본문 앞에 붙음 | 내 이름·프사 |
| `thread` | 원본에 스레드가 생기고 그 안에 남음 | 내 이름·프사 |

어느 쪽이든 **Fuse 화면에서는 항상 내 이름과 프로필로 보입니다.** 차이는 디스코드 쪽 표시뿐입니다.

```env
FUSE_REPLY_MODE=reply
```

## 계정과 권한에 대해

- Fuse는 **회원님의 계정 비밀번호나 유저 토큰을 쓰지 않습니다.** 공식 OAuth2와 봇 토큰만 씁니다.
- 요청하는 OAuth 범위는 `identify` `email` `guilds` `guilds.join` `guilds.members.read` 입니다.
- 글은 웹훅으로 회원님의 이름·프로필 사진을 달고 올라갑니다. 디스코드 공식 기능입니다.
- **회원님이 디스코드에서 볼 수 없는 채널은 Fuse에도 절대 나오지 않습니다.** 요청마다 역할과
  채널 권한 오버라이트를 그대로 계산하고, 실시간 이벤트도 같은 검사를 통과해야 전달됩니다.
