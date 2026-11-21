#!/bin/sh
# Обновление без обрыва матча: новый образ, затем drain — комната закрывается
# после окончания текущего матча, после чего контейнеры пересоздаются.
set -e
cd "$(dirname "$0")/.."
. ./.env
git pull
docker compose pull || docker compose build
echo "Ждём конца текущего матча (drain)…"
curl -fsS -X POST "https://${DOMAIN}/api/admin" -H 'content-type: application/json' \
  -d "{\"secret\":\"${ADMIN_SECRET}\",\"cmd\":\"drain\"}" >/dev/null
docker wait "$(docker compose ps -q game)" >/dev/null || true
docker compose up -d
echo "Готово."
