#!/usr/bin/env bash
# Brings a rendered video's sound to -14 LUFS (what Instagram and YouTube play at), true peak -1.5 dB, in two passes,
# so the Kannada and English videos, daily and promo, all play equally loud. The picture is copied untouched.
#   bash scripts/loudnorm.sh out/daily-rates-kn.mp4
# Without ffmpeg it leaves the file as it is.
set -uo pipefail
in="$1"
command -v ffmpeg >/dev/null || { echo "! ffmpeg not found; loudness left as rendered."; exit 0; }
stats=$(ffmpeg -hide_banner -nostats -i "$in" -vn -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
get() { echo "$stats" | sed -n "s/.*\"$1\" : \"\([^\"]*\)\".*/\1/p"; }
[ -n "$(get input_i)" ] || { echo "! Could not measure loudness of $in; left as rendered."; exit 0; }
tmp="${in%.mp4}.loud.mp4"
ffmpeg -hide_banner -loglevel error -y -i "$in" -c:v copy \
  -af "loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=$(get input_i):measured_TP=$(get input_tp):measured_LRA=$(get input_lra):measured_thresh=$(get input_thresh):offset=$(get target_offset):linear=true" \
  -ar 48000 -c:a aac -b:a 192k -movflags +faststart "$tmp" && mv "$tmp" "$in" || { rm -f "$tmp"; echo "! Loudness step failed for $in; left as rendered."; }
