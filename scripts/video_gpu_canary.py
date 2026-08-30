import hashlib, json, shutil, subprocess, time
from pathlib import Path
from gradio_client import Client, handle_file

SPACE = 'zerogpu-aoti/wan2-2-fp8da-aoti-faster'
API = '/generate_video'
OUT = Path('evidence/video-gpu-runtime-canary')

started = time.time()
ppm = Path('/tmp/daube-public-canary.ppm')
w = h = 64
ppm.write_text(f"P3\n{w} {h}\n255\n" + ' '.join(['255 230 0'] * w * h) + '\n', encoding='ascii')

client = Client(SPACE, verbose=False)
result = client.predict(
    handle_file(str(ppm)),
    'A tiny yellow paper square gently lifts once in a clean white studio, locked camera, minimal motion.',
    1, '', 0.5, 1.0, 1.0, 42, False,
    api_name=API,
)
item = result[0] if isinstance(result, (tuple, list)) else result
source = getattr(item, 'path', None) or (item if isinstance(item, str) else None)
if not source or not Path(source).is_file():
    raise SystemExit('Wan2.2 ZeroGPU returned no video file')

OUT.mkdir(parents=True, exist_ok=True)
video = OUT / 'wan2.2-video-canary.mp4'
shutil.copyfile(source, video)
sha = hashlib.sha256(video.read_bytes()).hexdigest()
probe = subprocess.run([
    'ffprobe','-v','error','-select_streams','v:0',
    '-show_entries','stream=codec_name,width,height,r_frame_rate,duration',
    '-show_entries','format=duration,size','-of','json',str(video)
], check=True, capture_output=True, text=True)
media = json.loads(probe.stdout)
stream = (media.get('streams') or [{}])[0]
fmt = media.get('format') or {}
duration = float(stream.get('duration') or fmt.get('duration') or 0)
size = int(fmt.get('size') or video.stat().st_size)
ok = size > 0 and duration > 0 and bool(stream.get('codec_name'))
receipt = {
    'schema':'daube.public-video-gpu-canary.v1',
    'status':'GPU_EXECUTION_COMPLETED' if ok else 'GPU_EXECUTION_FAILED',
    'provider':'huggingface-zerogpu-community','space_id':SPACE,'api_name':API,
    'workload':'image-to-video-canary','requested_duration_seconds':0.5,'inference_steps':1,
    'elapsed_seconds':round(time.time()-started,3),
    'media':{'codec':stream.get('codec_name'),'width':stream.get('width'),'height':stream.get('height'),
             'frame_rate':stream.get('r_frame_rate'),'duration_seconds':duration,'size_bytes':size,
             'sha256':sha,'decode_probe_ok':ok},
    'paid_spend_authorized':False,'authentication_used':False,'private_assets_used':False,
}
(OUT/'receipt.json').write_text(json.dumps(receipt, indent=2, sort_keys=True)+'\n', encoding='utf-8')
print(json.dumps(receipt, sort_keys=True))
if not ok:
    raise SystemExit('Video artifact failed decode/media probe')
