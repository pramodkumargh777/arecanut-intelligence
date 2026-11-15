#!/usr/bin/env bash
# The daily rates Story in one command, in Kannada and English: fetch rates → render the image → file it with a
# ready-to-send WhatsApp message → (optional) post it to Instagram Stories.
#   npm run story:daily            (from the repo root)
# Settings live in video/.daily.env (see video/README.md, "Daily Story"). Safe to run from the scheduled job.
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -f .daily.env ] && set -a && . ./.daily.env && set +a

notify() { osascript -e "display notification \"$1\" with title \"ಅಡಿಕೆ ನಾಡಿ · Daily Story\"" >/dev/null 2>&1 || true; }
fail() { echo "✗ $1"; notify "$1"; exit 1; }
echo "── $(date '+%Y-%m-%d %H:%M') daily Story"

PROPS_NAME=story node scripts/fetch-rates.mjs || fail "Rates fetch failed; no Story made."

for lang in ${LANGS:-kn en}; do
  echo "Rendering Story ($lang) …"
  npx --no-install remotion still src/index.ts DailyStory "out/story-$lang.png" \
    --props="./out/story-props-$lang.json" --log=error || fail "Story render failed ($lang)."
done
node scripts/finish-story.mjs || fail "Could not file today's Story."

# STORY_POST=off when scripts/publish-daily.sh runs this: it posts the Story itself, with everything else.
if [ "${STORY_POST:-on}" = "on" ] && [ -n "${IG_USER_ID:-}" ] && [ -n "${IG_ACCESS_TOKEN:-}" ]; then
  node scripts/publish/run.mjs --only instagram-story && notify "Story posted to Instagram. WhatsApp image is ready." \
    || { echo "! Instagram posting failed; the image is still ready to post by hand."; notify "Instagram posting failed; post it by hand."; }
else
  notify "Today's Story is ready for WhatsApp and Instagram."
fi
