# Fuse 백엔드 — 디스코드 게이트웨이에 계속 붙어 있어야 하므로
# 서버리스가 아니라 프로세스가 살아 있는 곳에서 돌린다.
FROM node:22-alpine

WORKDIR /app

# 의존성부터 받아 레이어 캐시를 살린다
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY scripts ./scripts

# 좋아요·알림·쪽지가 저장되는 곳. 재시작해도 남기려면 볼륨을 붙일 것.
RUN mkdir -p data
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV HOST=0.0.0.0
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/healthz || exit 1

CMD ["node", "src/index.js"]
