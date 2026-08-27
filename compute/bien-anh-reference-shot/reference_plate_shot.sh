#!/usr/bin/env bash
set -euo pipefail

# BIÊN ẢNH EP01 reference-driven documentary shot helper.
# Visual authority is an approved real-world reference plate.
# This does NOT replace the Blender .blend as spatial/continuity evidence;
# it is the final-pixel camera-shot path when procedural CG fails photorealism QC.

INPUT="${1:?usage: reference_plate_shot.sh <input-image> <output-mp4>}"
OUTPUT="${2:?usage: reference_plate_shot.sh <input-image> <output-mp4>}"
FPS="${FPS:-24}"
DURATION="${DURATION:-4}"
WIDTH="${WIDTH:-1280}"
HEIGHT="${HEIGHT:-720}"

# Slow forward documentary push-in. The crop center is deliberately biased toward
# the corridor vanishing point rather than image center. No artificial motion blur,
# no interpolation, no synthetic people, no fake signage.
FRAMES=$((FPS * DURATION))

ffmpeg -y -loop 1 -i "$INPUT" \
  -vf "scale=1600:-2:flags=lanczos,zoompan=z='min(zoom+0.00075,1.072)':x='iw/2-(iw/zoom/2)-55':y='ih/2-(ih/zoom/2)-18':d=${FRAMES}:s=${WIDTH}x${HEIGHT}:fps=${FPS},eq=contrast=1.015:saturation=0.98:brightness=-0.006,format=yuv420p" \
  -t "$DURATION" \
  -an -c:v libx264 -preset medium -crf 17 -movflags +faststart "$OUTPUT"

ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,width,height,r_frame_rate,duration \
  -of json "$OUTPUT"
sha256sum "$OUTPUT"
