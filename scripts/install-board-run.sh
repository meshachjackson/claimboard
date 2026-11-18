#!/usr/bin/env bash
# Installs the board runner as a launchd job. LABEL defaults to com.example.board-run; set LABEL_PREFIX to change it. Dry run by default.
#
#   bash scripts/install-board-run.sh --print        show the plist, write nothing
#   bash scripts/install-board-run.sh --yes          write it to ~/Library/LaunchAgents and load it
#   bash scripts/install-board-run.sh --uninstall --yes
#
# The plist holds no token. The runner uses the local board and its fixture token unless BOARD_RUN_URL and BOARD_RUN_TOKEN are
# set in the job's environment by hand. Stop it with `touch $CONF/board-run.off`.
set -euo pipefail

LABEL="${LABEL_PREFIX:-com.example}.board-run"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="${BOARD_RUN_NODE:-$(command -v node)}"
CONF="${BOARD_RUN_CONF_DIR:-$ROOT/.data}"   # settings folder: kill switch, spend file, logs
LOGS="$CONF/logs"

# Optional job env, passed through from the shell that runs this installer (set them when you install).
EXTRA_ENV=""
for v in BOARD_RUN_AGENT_ID NUXT_PUBLIC_AGENT_TARGETS; do
  val="${!v:-}"; val="${val//&/&amp;}"; val="${val//</&lt;}"
  [[ -n "$val" ]] && EXTRA_ENV+="    <key>$v</key><string>$val</string>"$'\n'
done

plist() {
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$ROOT/scripts/board-run.mjs</string>
    <string>--cap</string><string>2</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>$HOME</string>
    <key>BOARD_RUN_CONF_DIR</key><string>$CONF</string>
$EXTRA_ENV  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOGS/board-run.log</string>
  <key>StandardErrorPath</key><string>$LOGS/board-run.err.log</string>
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
    echo "Installed and loaded $LABEL. Logs: $LOGS/board-run.log. Stop: touch $CONF/board-run.off" ;;
  *) echo "Nothing installed. Run with --print to see the job, or --yes to install it."; exit 0 ;;
esac
