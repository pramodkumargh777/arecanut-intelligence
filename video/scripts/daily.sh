#!/usr/bin/env bash
# The whole daily Reel in one command, in Kannada and English: fetch rates → voice-over → render → captions.
#   npm run video:daily            (from the repo root)
# Optional settings live in video/.daily.env (see video/README.md). Safe to run from the scheduled job.
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -f .daily.env ] && set -a && . ./.daily.env && set +a

notify() { osascript -e "display notification \"$1\" with title \"ಅಡಿಕೆ ನಾಡಿ · Daily Reel\"" >/dev/null 2>&1 || true; }
fail() { echo "✗ $1"; notify "$1"; exit 1; }
# CUT=30 makes the 30-second Story cut instead (…-30.mp4), leaving the full video's files alone.
SUF=""; [ "${CUT:-}" = "30" ] && SUF="-30"
echo "── $(date '+%Y-%m-%d %H:%M') daily Reel${SUF:+ (30-second cut)}"

node scripts/fetch-rates.mjs || fail "Rates fetch failed; nothing rendered."

if [ "${VOICE:-on}" = "off" ]; then
  echo "Voice off (VOICE=off)."
else
  # Small one-time setup (edge-tts, mutagen, numpy); repeated runs skip it.
  if ! voice/.venv/bin/python -c "import edge_tts, mutagen, numpy" 2>/dev/null; then
    echo "Setting up voice (one time)…"
    python3 -m venv voice/.venv && voice/.venv/bin/pip install -q --upgrade pip && voice/.venv/bin/pip install -q -r voice/requirements.txt \
      || echo "! Voice setup failed."
  fi
  voice/.venv/bin/python voice/tts.py || { echo "! Voice-over failed for a language; that video is made without voice."; notify "Voice failed for a language; see the log."; }
fi

# Music bed composed to each language's scene timings (after the voice, which sets them). A licensed track at
# public/music/bed.mp3, when present, is used instead.
[ -f public/music/bed.mp3 ] || for lang in ${LANGS:-kn en}; do
  voice/.venv/bin/python scripts/make-music.py --daily "out/today-props-$lang$SUF.json" >/dev/null \
    || echo "! Music for $lang could not be composed; that video is made without music."
done

for lang in ${LANGS:-kn en}; do
  echo "Rendering $lang …"
  npx --no-install remotion render src/index.ts DailyRates "out/daily-rates-$lang$SUF.mp4" --codec h264 --crf 18 \
    --props="./out/today-props-$lang$SUF.json" --log=error ${RENDER_CONCURRENCY:+--concurrency=$RENDER_CONCURRENCY} || fail "Render failed ($lang)."
  bash scripts/loudnorm.sh "out/daily-rates-$lang$SUF.mp4"
done
node scripts/finish.mjs || fail "Could not file today's Reel."
notify "Today's Reels (Kannada + English) are ready in video/out/daily."
