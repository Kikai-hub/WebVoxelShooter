#!/bin/sh
# Устаревшее имя: обновление теперь в deploy/update.sh (git → сборка → drain → запуск).
exec bash "$(dirname "$0")/../deploy/update.sh" "$@"
