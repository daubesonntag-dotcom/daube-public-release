#!/usr/bin/env bash
set -euo pipefail

OUT="artifacts/creative-farm-smoke"
rm -rf "$OUT"
mkdir -p "$OUT"

cat > "$OUT/poster.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350" role="img" aria-labelledby="title desc">
  <title id="title">D’AUBE Creative Farm Smoke Poster</title>
  <desc id="desc">A green evidence poster generated deterministically by the D’AUBE creative farm smoke test.</desc>
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#071d14"/><stop offset="1" stop-color="#15a866"/></linearGradient></defs>
  <rect width="1080" height="1350" fill="url(#g)"/>
  <circle cx="850" cy="220" r="150" fill="#c9ffe2" fill-opacity=".18"/>
  <text x="90" y="180" fill="#dfffee" font-family="sans-serif" font-size="38" letter-spacing="8">D’AUBE SONNTAG</text>
  <text x="90" y="620" fill="white" font-family="serif" font-size="118">Creative Farm</text>
  <text x="90" y="730" fill="#bdf7d7" font-family="sans-serif" font-size="46">CODE · MOTION · VFX · CGI</text>
  <text x="90" y="1180" fill="#dfffee" font-family="sans-serif" font-size="32">Meaning, made visible. · GREEN EVIDENCE</text>
</svg>
SVG

cat > "$OUT/ui.html" <<'HTML'
<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>D’AUBE Creative Farm UI</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#06130e;color:#eafff1;font-family:Arial,sans-serif}.wrap{min-height:100vh;display:grid;place-items:center;padding:48px}.panel{width:min(1100px,100%);border:1px solid #2a7150;border-radius:28px;padding:64px;background:linear-gradient(135deg,#0a2117,#0c3523);box-shadow:0 30px 100px #0008}.eyebrow{letter-spacing:.25em;color:#90efba}.status{display:inline-flex;gap:10px;align-items:center;margin-top:24px;padding:10px 14px;border-radius:999px;background:#0e4d31}.dot{width:10px;height:10px;border-radius:50%;background:#56f39b;box-shadow:0 0 18px #56f39b}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:36px}.card{padding:24px;border:1px solid #23583f;border-radius:18px;background:#0b281b}h1{font:72px/1.02 Georgia,serif;margin:18px 0}@media(max-width:700px){h1{font-size:48px}.grid{grid-template-columns:1fr}.panel{padding:30px}}</style>
<body><main class="wrap"><section class="panel"><div class="eyebrow">D’AUBE CREATIVE FARM · SMOKE</div><h1>One farm.<br>Many creative harvests.</h1><p>UI, campaign, motion, VFX, CGI and media outputs share one evidence contract.</p><div class="status"><span class="dot"></span> bounded runtime test</div><div class="grid"><div class="card">Web / UI</div><div class="card">Motion / VFX</div><div class="card">CGI / Render</div></div></section></main></body></html>
HTML

CHROME="$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser || true)"
if [[ -z "$CHROME" ]]; then echo "chrome_missing" >&2; exit 21; fi
"$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars --window-size=1440,900 --screenshot="$PWD/$OUT/ui-desktop.png" "file://$PWD/$OUT/ui.html" >/tmp/daube-creative-chrome.log 2>&1

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "color=c=0x071d14:s=1280x720:r=30:d=2" \
  -vf "drawtext=text='D AUBE  MOTION':fontcolor=white:fontsize=64:x='(w-text_w)/2 + 70*sin(t*3.14159)':y='(h-text_h)/2',fade=t=in:st=0:d=.35,fade=t=out:st=1.55:d=.35" \
  -c:v libx264 -pix_fmt yuv420p "$OUT/motion.mp4"

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "color=c=0x0b281b:s=640x360:r=24:d=1.5" \
  -vf "drawtext=text='ANIMATION':fontcolor=0x9bffc5:fontsize=42:x='mod(t*220\,w+text_w)-text_w':y='(h-text_h)/2'" \
  -c:v libx264 -pix_fmt yuv420p "$OUT/animation.mp4"

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "color=c=0x08140e:s=640x360:r=24:d=1.5" \
  -f lavfi -i "color=c=0x2be384@0.72:s=220x220:r=24:d=1.5" \
  -filter_complex "[1:v]format=rgba,colorchannelmixer=aa=0.72[fg];[0:v][fg]overlay=x='40+120*t':y='70+25*sin(t*5)'" \
  -c:v libx264 -pix_fmt yuv420p "$OUT/vfx-composite.mp4"

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "sine=frequency=220:sample_rate=48000:duration=2" \
  -af "afade=t=in:st=0:d=.15,afade=t=out:st=1.7:d=.3,loudnorm=I=-18:TP=-2:LRA=7" \
  -c:a pcm_s16le "$OUT/audio-master.wav"

cat > "$OUT/blender-smoke.py" <<'PY'
import bpy, math, os
from mathutils import Vector
out = os.environ['DAUBE_CGI_OUT']
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.render.resolution_x=512; scene.render.resolution_y=512; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'; scene.render.filepath=out
scene.world.color=(0.015,0.04,0.025)
bpy.ops.mesh.primitive_plane_add(size=14, location=(0,0,0)); plane=bpy.context.object
mat=bpy.data.materials.new('Ground'); mat.diffuse_color=(0.025,0.10,0.065,1); plane.data.materials.append(mat)
bpy.ops.mesh.primitive_cube_add(size=2.4, location=(0,0,1.2)); cube=bpy.context.object
cube.rotation_euler=(math.radians(8),math.radians(18),math.radians(12))
cm=bpy.data.materials.new('DawnGreen'); cm.diffuse_color=(0.04,0.55,0.26,1); cube.data.materials.append(cm)
bpy.ops.mesh.primitive_torus_add(major_radius=2.2, minor_radius=.12, location=(0,0,2.0), rotation=(math.radians(90),0,0)); torus=bpy.context.object
tm=bpy.data.materials.new('Ring'); tm.diffuse_color=(0.45,1.0,0.68,1); torus.data.materials.append(tm)
bpy.ops.object.light_add(type='AREA', location=(3,-4,6)); key=bpy.context.object; key.data.energy=900; key.data.shape='DISK'; key.data.size=5
key.rotation_euler=(math.radians(25),0,math.radians(35))
bpy.ops.object.light_add(type='AREA', location=(-4,1,3)); fill=bpy.context.object; fill.data.energy=500; fill.data.size=4
bpy.ops.object.camera_add(location=(7,-9,6), rotation=(math.radians(67),0,math.radians(38))); cam=bpy.context.object
scene.camera=cam
def look_at(obj, target=(0,0,1.4)):
    direction=Vector(target)-obj.location
    obj.rotation_euler=direction.to_track_quat('-Z','Y').to_euler()
look_at(cam)
bpy.ops.render.render(write_still=True)
PY

if ! command -v blender >/dev/null 2>&1; then echo "blender_missing" >&2; exit 22; fi
DAUBE_CGI_OUT="$PWD/$OUT/cgi-frame.png" blender -b --python "$OUT/blender-smoke.py" >/tmp/daube-blender.log 2>&1

(
  cd "$OUT"
  sha256sum poster.svg ui-desktop.png motion.mp4 animation.mp4 vfx-composite.mp4 audio-master.wav cgi-frame.png > SHA256SUMS
)

echo "creative_farm_smoke_generated"
