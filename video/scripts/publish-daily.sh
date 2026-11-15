#!/usr/bin/env bash
# Every morning, one command: today's rates → Story image + daily video (Kannada + English) → posted to YouTube Shorts,
# Instagram (Reel + Story) and the Facebook Page — each platform only if it is set up in video/.daily.env.
#   npm run daily:publish            (from the repo root)
# Safe to run again: posts already made for this report date are skipped, so a re-run retries only what failed.
# When there are no new rates since the last run (holiday, Sunday), it stops before making anything. FORCE=1 overrides.
# The log of each run is kept in video/out/publish-<date>.log.
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -f .daily.env ] && set -a && . ./.daily.env && set +a
mkdir -p out
exec > >(tee -a "out/publish-$(date +%F).log") 2>&1

notify() { osascript -e "display notification \"$1\" with title \"ಅಡಿಕೆ ನಾಡಿ · Daily post\"" >/dev/null 2>&1 || true; }
echo "══ $(date '+%Y-%m-%d %H:%M') daily post"

node scripts/publish/run.mjs --fresh
case $? in
  0) ;;
  10) notify "No new rates since the last post; nothing posted."; exit 0 ;;
  *) notify "Could not reach the rates API; nothing posted."; exit 1 ;;
esac

STORY_POST=off bash scripts/story.sh || { notify "Story image failed; nothing posted."; exit 1; }
bash scripts/daily.sh || { notify "Daily video failed; nothing posted."; exit 1; }

node scripts/publish/run.mjs
code=$?
[ -s out/publish-attention.txt ] && notify "$(head -c 180 out/publish-attention.txt | tr -d '"`')"
if [ $code -eq 0 ]; then
  notify "Posted today's rates everywhere. WhatsApp image and message are ready in video/out/stories."
else
  notify "Some posts failed (see video/out/publish-$(date +%F).log). Run the same command again to retry only those."
fi
exit $code
