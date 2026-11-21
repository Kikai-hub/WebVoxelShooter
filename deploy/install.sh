#!/usr/bin/env bash
# Установка Voxel Tactical одной командой на чистый сервер Ubuntu или Debian (от root):
#
#   curl -fsSL https://raw.githubusercontent.com/Kikai-hub/WebVoxelShooter/main/deploy/install.sh | sudo bash
#
# С доменом (Caddy сам выпустит HTTPS-сертификат; домен должен указывать на IP сервера):
#
#   curl -fsSL https://raw.githubusercontent.com/Kikai-hub/WebVoxelShooter/main/deploy/install.sh | sudo bash -s -- --domain game.example.com
#
# Параметры: --domain ИМЯ  --dir ПАПКА (/opt/voxel-tactical)  --branch ВЕТКА (main)
#            --repo URL     --no-autoupdate (не ставить ежечасное обновление)
# Повторный запуск безопасен: обновит код, сохранит .env и данные аккаунтов.
set -euo pipefail

REPO="https://github.com/Kikai-hub/WebVoxelShooter.git"
BRANCH="main"
DIR="/opt/voxel-tactical"
DOMAIN=""
AUTOUPDATE=1
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --no-autoupdate) AUTOUPDATE=0; shift ;;
    *) echo "Неизвестный параметр: $1"; exit 1 ;;
  esac
done

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Запустите от root (через sudo)"; exit 1; }
command -v apt-get >/dev/null || { echo "Нужен Ubuntu или Debian (apt-get)"; exit 1; }
# домен: только буквы, цифры, точки и дефисы — значение попадает в .env и Caddyfile
if [ -n "$DOMAIN" ] && ! printf '%s' "$DOMAIN" | grep -Eq '^[A-Za-z0-9.-]+$'; then
  echo "Некорректный домен: $DOMAIN"; exit 1
fi

say "Пакеты: git, curl, openssl"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates openssl >/dev/null

if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  say "Docker и Docker Compose"
  if apt-cache show docker-compose-v2 >/dev/null 2>&1; then
    apt-get install -y -qq docker.io docker-compose-v2 >/dev/null
  else
    # Debian и др.: официальный установщик Docker (с download.docker.com)
    curl -fsSL https://get.docker.com | sh
  fi
fi
systemctl enable --now docker >/dev/null

say "Код игры: $REPO ($BRANCH) → $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --quiet origin "$BRANCH"
  git -C "$DIR" checkout --quiet "$BRANCH"
  git -C "$DIR" reset --hard --quiet "origin/$BRANCH"
else
  git clone --quiet --branch "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"

if [ ! -f .env ]; then
  say "Настройки (.env)"
  ip="$(curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  # ответ внешнего сервиса попадает в sed — пропускаем только строгий IPv4
  printf '%s' "$ip" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$' || ip="$(hostname -I | awk '{print $1}')"
  printf '%s' "$ip" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$' || ip="127.0.0.1"
  if [ -n "$DOMAIN" ]; then
    site="$DOMAIN"; origins="https://$DOMAIN"
  else
    # без домена — обычный HTTP по IP (для теста; для публичного запуска нужен домен и HTTPS)
    site=":80"; origins="http://$ip"
  fi
  secret="$(openssl rand -hex 32)"
  sed -e "s|^DOMAIN=.*|DOMAIN=$site|" \
      -e "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=$origins|" \
      -e "s|^ADMIN_SECRET=.*|ADMIN_SECRET=$secret|" \
      -e "s|^VTS_IMAGE=.*|VTS_IMAGE=voxel-tactical|" \
      .env.example > .env
  chmod 600 .env
elif [ -n "$DOMAIN" ]; then
  sed -i -e "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" -e "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=https://$DOMAIN|" .env
fi
chmod +x deploy/*.sh tools/*.sh 2>/dev/null || true

# брандмауэр: если ufw включён — открыть веб-порты (SSH не трогаем)
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  say "Брандмауэр: открываю 80 и 443"
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
fi

say "Сборка и запуск (первый раз — несколько минут)"
bash deploy/update.sh --force

if [ "$AUTOUPDATE" = 1 ]; then
  say "Автообновление с GitHub раз в час"
  cat > /etc/systemd/system/vts-update.service <<EOF
[Unit]
Description=Voxel Tactical: обновление с GitHub
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash $DIR/deploy/update.sh
EOF
  cat > /etc/systemd/system/vts-update.timer <<EOF
[Unit]
Description=Voxel Tactical: проверка обновлений раз в час

[Timer]
OnCalendar=hourly
RandomizedDelaySec=300
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now vts-update.timer >/dev/null
fi

say "Проверка"
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q game)" 2>/dev/null || true)"
  [ "$status" = "healthy" ] && break
  sleep 3
done
docker compose ps
. ./.env
if [ "${DOMAIN}" = ":80" ]; then url="http://$(curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"; else url="https://$DOMAIN"; fi
echo
echo "Готово. Сайт: $url   (игра: ${status:-?})"
echo "Логи игры:        cd $DIR && docker compose logs -f game"
echo "Обновить вручную: bash $DIR/deploy/update.sh"
[ "$AUTOUPDATE" = 1 ] && echo "Автообновление:   systemctl list-timers vts-update.timer · журнал: journalctl -u vts-update"
