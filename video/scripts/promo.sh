#!/usr/bin/env bash
# Promo Reel in Kannada and English: rates → voice-over → music composed to the voice timeline → render.
#   npm --workspace video run promo        → video/out/promo-kn.mp4, video/out/promo-en.mp4 (full tour)
#   npm --workspace video run promo:30     → video/out/promo-kn-30.mp4, …-en-30.mp4 (the Reel to post and boost)
#   npm --workspace video run promo:15     → video/out/promo-kn-15.mp4, …-en-15.mp4 (Stories, quick ads)
# Each cut also writes its caption: out/promo-caption-<lang>[-30|-15].txt
set -uo pipefail
cd "$(dirname "$0")/.."
[ -f .daily.env ] && set -a && . ./.daily.env && set +a
export PROMO_CUT="${1:-full}"
SUF=""; [ "$PROMO_CUT" != "full" ] && SUF="-$PROMO_CUT"
node scripts/promo-prepare.mjs || exit 1
# The default track (used when there is no voice-over) is generated, not committed.
[ -f public/music/promo.wav ] || voice/.venv/bin/python scripts/make-music.py >/dev/null 2>&1 || python3 scripts/make-music.py >/dev/null 2>&1 \
  || echo "! Could not compose the default music track."
if [ "${VOICE:-on}" != "off" ]; then
  if ! voice/.venv/bin/python -c "import edge_tts, mutagen, numpy" 2>/dev/null; then
    python3 -m venv voice/.venv && voice/.venv/bin/pip install -q -r voice/requirements.txt || echo "! Voice setup failed."
  fi
  if voice/.venv/bin/python voice/promo_tts.py "out/promo-narration$SUF.json"; then
    # Compose the music to each language's voice timeline, so every cut lands on the beat.
    for lang in ${LANGS:-kn en}; do
      voice/.venv/bin/python scripts/make-music.py --props "out/promo-props-$lang$SUF.json" \
        || echo "! Music for $lang could not be composed; using the default track."
    done
  else
    echo "! Voice-over failed; the promo is made with music only."
  fi
fi
for lang in ${LANGS:-kn en}; do
  echo "Rendering promo $PROMO_CUT ($lang) …"
  npx --no-install remotion render src/index.ts PromoReel "out/promo-$lang$SUF.mp4" --codec h264 --crf 18 \
    --props="./out/promo-props-$lang$SUF.json" --log=error ${RENDER_CONCURRENCY:+--concurrency=$RENDER_CONCURRENCY} || exit 1
  bash scripts/loudnorm.sh "out/promo-$lang$SUF.mp4"
  echo "✓ out/promo-$lang$SUF.mp4"
done
