#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

V5_BIN="$HOME/.local/bin/daube-phone-edge-v5-batch"
LEGACY_BIN="$HOME/.local/lib/daube-sovereign-agent/daube-vulkan-rgba-premultiply"
THERMAL_PROBE="$HOME/.local/lib/daube-sovereign-agent/daube-thermal-headroom-probe"
NCNN_REVISION="3bb3b9a32e7c7aae303d426295084fa3e5603bb6"
NCNN_URL="https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/${NCNN_REVISION}/farm/sovereign-agent/pilot-ncnn-vulkan-synthetic-inference.sh"

case "${PREFIX:-}" in
  *com.termux*) ;;
  *) echo "ERROR: run inside Termux on Android" >&2; exit 2 ;;
esac

[[ -x "$V5_BIN" ]] || { echo "ERROR: v5 batch runtime missing; run install-phone-edge-v5-fastpath.sh first" >&2; exit 3; }
[[ -x "$LEGACY_BIN" ]] || { echo "ERROR: legacy Vulkan runtime missing" >&2; exit 4; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

thermal_guard() {
  local phase="$1"
  local thermal_json='{}'
  local battery_json='{}'
  if [[ -x "$THERMAL_PROBE" ]]; then
    thermal_json="$($THERMAL_PROBE 10 2>/dev/null || printf '{}')"
  fi
  if command -v termux-battery-status >/dev/null 2>&1; then
    battery_json="$(termux-battery-status 2>/dev/null || printf '{}')"
  fi
  python - "$phase" "$thermal_json" "$battery_json" <<'PY'
import json,sys
phase=sys.argv[1]
def parse(s):
    try:return json.loads(s)
    except Exception:return {}
t=parse(sys.argv[2]); b=parse(sys.argv[3])
headroom=t.get('headroom')
status_code=t.get('thermalStatusCode')
percent=b.get('percentage')
temp=b.get('temperature')
reasons=[]
if isinstance(headroom,(int,float)) and headroom >= 0.90: reasons.append('thermal_headroom_guard')
if isinstance(status_code,(int,float)) and status_code > 2: reasons.append('thermal_status_guard')
if isinstance(percent,(int,float)) and percent < 35: reasons.append('battery_floor')
if isinstance(temp,(int,float)) and temp > 42: reasons.append('battery_temperature_ceiling')
print(json.dumps({'phase':phase,'thermal':t,'battery':b,'ready':not reasons,'reasons':reasons},separators=(',',':')))
if reasons: raise SystemExit(23)
PY
}

before="$(thermal_guard before)"

python - "$work" "$LEGACY_BIN" "$V5_BIN" <<'PY'
from __future__ import annotations
import hashlib,json,os,subprocess,sys,time
from pathlib import Path

work=Path(sys.argv[1]); legacy=sys.argv[2]; v5=sys.argv[3]
TILE_PIXELS=4096

def make_input(side:int)->bytes:
    n=side*side
    out=bytearray(n*4)
    for i in range(n):
        out[4*i+0]=(i*17+11)&255
        out[4*i+1]=(i*29+23)&255
        out[4*i+2]=(i*43+37)&255
        out[4*i+3]=(i*61+53)&255
    return bytes(out)

def reference(inp:bytes)->bytes:
    out=bytearray(len(inp))
    for i in range(0,len(inp),4):
        a=inp[i+3]
        out[i]=(inp[i]*a+127)//255
        out[i+1]=(inp[i+1]*a+127)//255
        out[i+2]=(inp[i+2]*a+127)//255
        out[i+3]=a
    return bytes(out)

def run(cmd):
    t=time.perf_counter()
    cp=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,check=False)
    ms=(time.perf_counter()-t)*1000
    if cp.returncode!=0:
        raise SystemExit(f'command_failed:{cp.returncode}:{cmd[0]}:{cp.stderr[-500:]}')
    return ms,cp.stdout.strip()

def run_legacy(inp:bytes,side:int):
    chunks=[]; total_ms=0.0; receipts=[]
    for tile_index,offset_px in enumerate(range(0,side*side,TILE_PIXELS)):
        count=min(TILE_PIXELS,side*side-offset_px)
        tile=inp[offset_px*4:(offset_px+count)*4]
        ip=work/f'legacy-{side}-{tile_index}.in'; op=work/f'legacy-{side}-{tile_index}.out'
        ip.write_bytes(tile)
        ms,stdout=run([legacy,str(ip),str(op)])
        total_ms+=ms; receipts.append(stdout)
        chunks.append(op.read_bytes())
    return b''.join(chunks),total_ms,receipts

def run_v5(inp:bytes,side:int):
    ip=work/f'v5-{side}.in'; op=work/f'v5-{side}.out'
    ip.write_bytes(inp)
    ms,stdout=run([v5,str(ip),str(op)])
    return op.read_bytes(),ms,stdout

# 224x224: apples-to-apples legacy-vs-persistent comparison.
inp224=make_input(224); expected224=reference(inp224)
legacy_out,legacy_ms,_=run_legacy(inp224,224)
v5_out224,v5_ms224,v5_receipt224=run_v5(inp224,224)
if legacy_out!=expected224: raise SystemExit('legacy_cpu_reference_mismatch')
if v5_out224!=expected224: raise SystemExit('v5_224_cpu_reference_mismatch')

# 512x512: maximum admitted persistent-batch size.
inp512=make_input(512); expected512=reference(inp512)
v5_out512,v5_ms512,v5_receipt512=run_v5(inp512,512)
if v5_out512!=expected512: raise SystemExit('v5_512_cpu_reference_mismatch')

try:r224=json.loads(v5_receipt224)
except Exception:r224={}
try:r512=json.loads(v5_receipt512)
except Exception:r512={}
if r224.get('contextReusedAcrossTiles') is not True or r224.get('contextCreates')!=1 or r224.get('pipelineCreates')!=1:
    raise SystemExit('v5_context_reuse_receipt_invalid_224')
if r512.get('contextReusedAcrossTiles') is not True or r512.get('dispatches')!=64:
    raise SystemExit('v5_context_reuse_receipt_invalid_512')

result={
  'schema':'daube.phone-edge-v5-one-shot-vulkan-canary.v1',
  'status':'PASS',
  'deviceName':r512.get('deviceName'),
  'backend':'vulkan',
  'legacy224Ms':round(legacy_ms,2),
  'persistent224Ms':round(v5_ms224,2),
  'speedup224x':round(legacy_ms/v5_ms224,3) if v5_ms224>0 else None,
  'persistent512Ms':round(v5_ms512,2),
  'persistent512Dispatches':r512.get('dispatches'),
  'contextCreates':r512.get('contextCreates'),
  'pipelineCreates':r512.get('pipelineCreates'),
  'contextReusedAcrossTiles':r512.get('contextReusedAcrossTiles'),
  'cpuReferenceVerified224':True,
  'cpuReferenceVerified512':True,
  'input224Sha256':hashlib.sha256(inp224).hexdigest(),
  'output224Sha256':hashlib.sha256(v5_out224).hexdigest(),
  'input512Sha256':hashlib.sha256(inp512).hexdigest(),
  'output512Sha256':hashlib.sha256(v5_out512).hexdigest(),
  'privateAssetsUsed':False,
  'paidSpendAuthorized':False,
}
(work/'vulkan-result.json').write_text(json.dumps(result,separators=(',',':')),encoding='utf-8')
print(json.dumps(result,separators=(',',':')))
PY

vulkan_result="$(cat "$work/vulkan-result.json")"
after="$(thermal_guard after)"

ncnn_result="$(curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$NCNN_URL" | bash)"

python - "$before" "$vulkan_result" "$after" "$ncnn_result" <<'PY'
import json,sys
def p(x):
    try:return json.loads(x)
    except Exception:return {'raw':x}
before,vulkan,after,ncnn=map(p,sys.argv[1:5])
if vulkan.get('status')!='PASS': raise SystemExit('vulkan_canary_not_pass')
if ncnn.get('status')!='PASS' or ncnn.get('inferenceExecuted') is not True or ncnn.get('valuesVerified') is not True:
    raise SystemExit('ncnn_synthetic_inference_not_pass')
print(json.dumps({
 'schema':'daube.phone-edge-v5-full-canary.v1',
 'status':'PASS',
 'thermalBefore':before,
 'vulkan':vulkan,
 'thermalAfter':after,
 'ncnn':ncnn,
 'truthBoundary':{
   'persistentVulkanRuntimeProven':True,
   'persistentVsLegacyMeasured':True,
   'ncnnSyntheticVulkanInferenceProven':True,
   'fusedPremultiplyLumaRuntimeProven':False,
   'externalModelInferenceProven':False
 },
 'privateAssetsUsed':False,
 'paidSpendAuthorized':False
},separators=(',',':')))
PY
