#!/usr/bin/env bash
# Обновление сайта с GitHub. Запускается таймером vts-update.timer раз в час (ставит deploy/install.sh)
# или вручную:
#   bash deploy/update.sh           — обновить, если на GitHub есть новые коммиты
#   bash deploy/update.sh --force   — пересобрать и перезапустить в любом случае
# Порядок: git → сборка новых образов (игра идёт) → drain (комната закрывается после матча,
# сразу — если людей нет) → запуск новой версии. Данные аккаунтов в томе game_data не трогаются.
set -euo pipefail

# Скрипт сам обновляется из git: работаем из копии, чтобы подмена файла не сломала выполнение.
if [ -z "${VTS_UPDATE_COPY:-}" ]; then
  VTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  tmp="$(mktemp /tmp/vts-update.XXXXXX.sh)"
  cp "${BASH_SOURCE[0]}" "$tmp"
  VTS_UPDATE_COPY="$tmp" VTS_DIR="$VTS_DIR" exec bash "$tmp" "$@"
fi
trap 'rm -f "$VTS_UPDATE_COPY"' EXIT
cd "$VTS_DIR"

log() { echo "$(date '+%F %T') $*"; }

# одно обновление за раз (таймер + ручной запуск)
exec 9>/run/vts-update.lock
if ! flock -n 9; then
  log "Обновление уже идёт — пропуск"
  exit 0
fi

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git fetch --quiet origin "$BRANCH"
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"
if [ "$LOCAL" = "$REMOTE" ] && [ "$FORCE" = 0 ]; then
  log "Обновлений нет (${LOCAL:0:7})"
  exit 0
fi

# сервер — только для развёртывания: локальные правки отслеживаемых файлов не сохраняем
# (.env и данные не в git и не затрагиваются)
git reset --hard --quiet "origin/$BRANCH"
export GIT_COMMIT GIT_DATE
GIT_COMMIT="$(git rev-parse HEAD)"
GIT_DATE="$(git log -1 --format=%cI)"
log "Сборка версии ${GIT_COMMIT:0:7}: $(git log -1 --format=%s)"
docker compose build --pull

game_id="$(docker compose ps -q game 2>/dev/null || true)"
if [ -n "$game_id" ] && [ "$(docker inspect -f '{{.State.Running}}' "$game_id" 2>/dev/null)" = "true" ]; then
  started="$(docker inspect -f '{{.State.StartedAt}}' "$game_id")"
  log "Комната закроется после текущего матча (сразу, если людей нет)…"
  docker compose exec -T game node -e "fetch('http://127.0.0.1:8080/api/admin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({secret:process.env.ADMIN_SECRET,cmd:'drain'})}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    || log "Не удалось отправить drain — перезапуск без ожидания"
  # ждём, пока процесс игры завершится (не дольше 30 минут)
  for _ in $(seq 1 360); do
    state="$(docker inspect -f '{{.State.Running}} {{.State.StartedAt}}' "$game_id" 2>/dev/null || echo 'false -')"
    [ "$state" != "true $started" ] && break
    sleep 5
  done
fi

docker compose up -d --remove-orphans
docker image prune -f >/dev/null || true
log "Готово: работает версия ${GIT_COMMIT:0:7}"
