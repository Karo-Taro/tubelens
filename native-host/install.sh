#!/usr/bin/env bash
# Установка помощника загрузки TubeLens (macOS / Linux).
# Запуск:   bash install.sh [EXTENSION_ID]
# Удаление: bash install.sh --uninstall
set -euo pipefail

UNINSTALL=0
if [ "${1:-}" = "--uninstall" ]; then UNINSTALL=1; shift; fi
EXT_ID="${1:-mnaoadllhdlnmdccgppbbicpplfihceh}"
HERE="$(cd "$(dirname "$0")" && pwd)"
NAME="com.tubelens.dl"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
VENV="$DATA/tubelens/venv"        # вне папки расширения
CFG_DIR="$DATA/TubeLens"           # здесь же helper.log (см. tubelens_dl.py)
PORT="${TUBELENS_PORT:-47321}"

if [ "$(uname)" = "Darwin" ]; then
  BASE="$HOME/Library/Application Support"
  DIRS=("$BASE/Google/Chrome" "$BASE/Microsoft Edge" "$BASE/BraveSoftware/Brave-Browser" "$BASE/Chromium")
  AGENT="$HOME/Library/LaunchAgents/com.tubelens.helper.plist"
else
  BASE="${XDG_CONFIG_HOME:-$HOME/.config}"
  DIRS=("$BASE/google-chrome" "$BASE/microsoft-edge" "$BASE/BraveSoftware/Brave-Browser" "$BASE/chromium")
  UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  UNIT="$UNIT_DIR/tubelens-helper.service"
fi

# ---------------------------------------------------------------- удаление
if [ "$UNINSTALL" = 1 ]; then
  for d in "${DIRS[@]}"; do rm -f "$d/NativeMessagingHosts/$NAME.json"; done
  if [ "$(uname)" = "Darwin" ]; then
    launchctl unload "$AGENT" 2>/dev/null || true
    rm -f "$AGENT"
  elif command -v systemctl >/dev/null; then
    systemctl --user disable --now tubelens-helper.service 2>/dev/null || true
    rm -f "$UNIT"
    systemctl --user daemon-reload 2>/dev/null || true
  fi
  rm -f "$HERE/tubelens_dl.sh"
  echo "Помощник отключён. Окружение Python и настройки остались в $DATA/tubelens и $CFG_DIR — удалите их вручную, если не нужны."
  exit 0
fi

# ---------------------------------------------------------------- установка
command -v python3 >/dev/null || { echo "Нужен Python 3 (brew install python / apt install python3 python3-venv)"; exit 1; }

mkdir -p "$(dirname "$VENV")"
[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
"$VENV/bin/python" -m pip install -U pip "yt-dlp[default]"

# конфиг помощника: какому расширению разрешён доступ (свои CLI-команды из "cli" сохраняются)
mkdir -p "$CFG_DIR"
"$VENV/bin/python" - "$CFG_DIR/config.json" "chrome-extension://$EXT_ID" <<'PY'
import json, sys
path, origin = sys.argv[1], sys.argv[2]
try:
    cfg = json.load(open(path, encoding="utf-8"))
except Exception:
    cfg = {}
cfg["allowed_origins"] = [origin]
json.dump(cfg, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY

cat > "$HERE/tubelens_dl.sh" <<EOF
#!/usr/bin/env bash
export PATH="\$PATH:/usr/local/bin:/opt/homebrew/bin:\$HOME/.local/bin:\$HOME/.deno/bin"
exec "$VENV/bin/python" -u "$HERE/tubelens_dl.py" "\$@"
EOF
chmod +x "$HERE/tubelens_dl.sh"

MANIFEST=$(cat <<EOF
{
  "name": "$NAME",
  "description": "TubeLens downloader (yt-dlp)",
  "path": "$HERE/tubelens_dl.sh",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF
)

for d in "${DIRS[@]}"; do
  mkdir -p "$d/NativeMessagingHosts"
  echo "$MANIFEST" > "$d/NativeMessagingHosts/$NAME.json"
done

# Локальный HTTP-помощник 127.0.0.1:$PORT с автозапуском (для браузеров без Native Messaging).
# Отключить: TUBELENS_NO_AUTOSTART=1 bash install.sh   или   bash install.sh --uninstall
if [ "${TUBELENS_NO_AUTOSTART:-0}" != 1 ]; then
  if [ "$(uname)" = "Darwin" ]; then
    mkdir -p "$(dirname "$AGENT")"
    cat > "$AGENT" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.tubelens.helper</string>
  <key>ProgramArguments</key><array>
    <string>$HERE/tubelens_dl.sh</string><string>--serve</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
</dict></plist>
EOF
    launchctl unload "$AGENT" 2>/dev/null || true
    launchctl load "$AGENT" && echo "HTTP-помощник запущен (LaunchAgent com.tubelens.helper)."
  elif command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; then
    mkdir -p "$UNIT_DIR"
    cat > "$UNIT" <<EOF
[Unit]
Description=TubeLens helper (yt-dlp + CLI AI) on 127.0.0.1:$PORT

[Service]
ExecStart="$HERE/tubelens_dl.sh" --serve
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable tubelens-helper.service >/dev/null
    systemctl --user restart tubelens-helper.service && echo "HTTP-помощник запущен (systemd --user tubelens-helper)."
  else
    echo "Автозапуск не настроен (нет systemd --user). Запускайте вручную: \"$HERE/tubelens_dl.sh\" --serve &"
  fi
fi

command -v ffmpeg >/dev/null || echo "ffmpeg не найден — для 1080p+/MP3 установите его (brew install ffmpeg / apt install ffmpeg)."
command -v deno >/dev/null || echo "deno не найден — YouTube требует JS-движок: curl -fsSL https://deno.land/install.sh | sh"
echo "Готово! Перезапустите браузер и откройте TubeLens → Загрузки."
