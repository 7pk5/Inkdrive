#!/usr/bin/env bash
# Rebuilds store/inkdrive-promo.mp4 (silent, 1280x720, ~35 s) from the slides.
#   cd apps/extension && node scripts/make-video.mjs /tmp/slides && cd ../.. && bash store/make-video.sh /tmp/slides
set -euo pipefail
S="${1:?slides folder}"; OUT="$(dirname "$0")/inkdrive-promo.mp4"
D=4; F=0.7; N=9
args=(); filt=""; prev="[0:v]"
for i in $(seq 1 $N); do args+=(-loop 1 -t $((D+1)) -i "$S/s$i.png"); done
for i in $(seq 1 $((N-1))); do
  off=$(awk "BEGIN{print $i*($D-$F)}")
  filt+="${prev}[$i:v]xfade=transition=fade:duration=$F:offset=$off"
  if [ $i -lt $((N-1)) ]; then filt+="[v$i];"; prev="[v$i]"; else filt+=",format=yuv420p[out]"; fi
done
ffmpeg -y -loglevel error "${args[@]}" -filter_complex "$filt" -map "[out]" -r 30 -c:v libx264 -crf 20 -movflags +faststart "$OUT"
echo "wrote $OUT"
