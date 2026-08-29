#!/usr/bin/env bash
set -euo pipefail
OUT="artifacts/creative-farm-smoke"
input="$OUT/audio-master.wav"
tmp="$OUT/audio-master.48k.wav"
test -s "$input"
ffmpeg -hide_banner -loglevel error -y -i "$input" -ar 48000 -c:a pcm_s16le "$tmp"
mv "$tmp" "$input"
(
  cd "$OUT"
  sha256sum poster.svg ui-desktop.png motion.mp4 animation.mp4 vfx-composite.mp4 audio-master.wav cgi-frame.png > SHA256SUMS
)
ffprobe -v error -show_entries stream=sample_rate,channels:format=duration -of json "$input"
