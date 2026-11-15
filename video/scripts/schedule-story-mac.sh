#!/usr/bin/env bash
# Runs the daily Story automatically every morning on this Mac (launchd). If the Mac is asleep at that time, it runs
# when it wakes.   bash video/scripts/schedule-story-mac.sh [HH:MM]   (default 09:30, after the 09:00 data collection)
#                  bash video/scripts/schedule-story-mac.sh --remove
set -euo pipefail
LABEL="com.adikenaadi.dailystory"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ "${1:-}" = "--remove" ]; then rm -f "$PLIST"; echo "Daily Story schedule removed."; exit 0; fi
TIME="${1:-09:30}"; H=$((10#${TIME%%:*})); M=$((10#${TIME##*:}))
VIDEO="$(cd "$(dirname "$0")/.." && pwd)"
NODE_DIR="$(dirname "$(command -v node)")"
mkdir -p "$VIDEO/out/stories" "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$VIDEO/scripts/story.sh</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>$H</integer><key>Minute</key><integer>$M</integer></dict>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$NODE_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>StandardOutPath</key><string>$VIDEO/out/stories/story.log</string>
  <key>StandardErrorPath</key><string>$VIDEO/out/stories/story.log</string>
</dict></plist>
PL
launchctl bootstrap "gui/$(id -u)" "$PLIST"
printf 'Scheduled daily at %02d:%02d. Log: %s/out/stories/story.log\n' "$H" "$M" "$VIDEO"
echo "Run it now to test:  launchctl kickstart gui/$(id -u)/$LABEL"
case "$VIDEO" in "$HOME"/Desktop/*|"$HOME"/Documents/*|"$HOME"/Downloads/*)
  echo "Note: macOS blocks background jobs from Desktop/Documents/Downloads. If the log shows 'Operation not permitted',"
  echo "give /bin/bash Full Disk Access (System Settings → Privacy & Security), or move the repo to e.g. ~/Projects.";;
esac
