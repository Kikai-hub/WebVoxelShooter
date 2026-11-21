# Многоступенчатая сборка: Vite собирает клиент, esbuild — сервер.
# Цели: game (сервер комнаты на Node.js 22) и proxy (Caddy + собранный клиент).

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY shared ./shared
COPY server ./server
COPY client ./client
COPY tools ./tools
RUN npm run typecheck && npm run build

FROM node:22-slim AS game
# версия сборки (коммит и дата) — показывается в меню; передаёт deploy/update.sh
ARG GIT_COMMIT=dev
ARG GIT_DATE=
ENV NODE_ENV=production \
    GAME_PORT=8080 \
    DATA_DIR=/app/data \
    STATIC_DIR=/app/dist/client \
    GIT_COMMIT=$GIT_COMMIT \
    GIT_DATE=$GIT_DATE
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY news.json ./news.json
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/main.js"]

FROM caddy:2.8-alpine AS proxy
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist/client /srv
