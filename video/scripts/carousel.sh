#!/usr/bin/env bash
# Renders an Instagram carousel (one PNG per slide, 1080×1350).
#   npm --workspace video run carousel                      → out/carousel/new-garden/slide-01.png …
#   bash scripts/carousel.sh <CompositionId> <folder-name>  (for a new carousel registered in src/Root.tsx)
set -euo pipefail
cd "$(dirname "$0")/.."
ID="${1:-CarouselNewGarden}"; NAME="${2:-new-garden}"
OUT="out/carousel/$NAME"; mkdir -p "$OUT"
N=$(node -e "import('./src/data/carousels/newGarden.ts').then(m=>console.log(m.NEW_GARDEN.slides.length))")
for ((i=0; i<N; i++)); do
  npx --no-install remotion still src/index.ts "$ID" "$OUT/slide-$(printf %02d $((i+1))).png" --frame=$i --log=error
done
echo "✓ $N slides in video/$OUT"
