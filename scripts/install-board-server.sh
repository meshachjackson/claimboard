#!/usr/bin/env bash
# Installs the board server (pnpm dev on port 3000) as a launchd job (<LABEL_PREFIX>.board-server). Dry run by default.
#
#   bash scripts/install-board-server.sh --print        show the plist, write nothing
#   bash scripts/install-board-server.sh --yes          write it to ~/Library/LaunchAgents and load it
#   bash scripts/install-board-server.sh --uninstall --yes
#
# The runner (<LABEL_PREFIX>.board-run) needs this server up. The plist holds no token and no secret; the board reads .env itself.
# It does not pass --host, so the board answers on this Mac only. If the app's preview already holds port 3000, stop that first.
set -euo pipefail

LABEL="${LABEL_PREFIX:-com.example}.board-server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONF="${BOARD_RUN_CONF_DIR:-$ROOT/.data}"   # settings folder: kill switch, spend file, logs
LOGS="$CONF/logs"

plist() {
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>. "\$HOME/.nvm/nvm.sh" &amp;&amp; nvm exec 24 pnpm dev</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>$HOME</string>
    <key>BOARD_RUN_CONF_DIR</key><string>$CONF</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOGS/board-server.log</string>
  <key>StandardErrorPath</key><string>$LOGS/board-server.err.log</string>
</dict>
</plist>
PLIST
}

mode="${1:-}"
yes=0; [[ " $* " == *" --yes "* ]] && yes=1

case "$mode" in
  --print) plist ;;
  --uninstall)
    if [[ $yes -ne 1 ]]; then echo "Would unload $LABEL and delete $PLIST. Add --yes to do it."; exit 0; fi
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Removed $LABEL." ;;
  --yes)
    mkdir -p "$LOGS" "$HOME/Library/LaunchAgents"
    plist > "$PLIST"
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "Installed and loaded $LABEL. Logs: $LOGS/board-server.log. Stop: bash scripts/install-board-server.sh --uninstall --yes" ;;
  *) echo "Nothing installed. Run with --print to see the job, or --yes to install it."; exit 0 ;;
esac
