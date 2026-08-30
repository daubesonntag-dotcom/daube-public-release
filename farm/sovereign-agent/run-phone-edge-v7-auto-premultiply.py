#!/usr/bin/env python3
import hashlib, json, math, os, shutil, subprocess, sys
from pathlib import Path

PROFILE=Path.home()/'.local/share/daube-phone-edge/perf-profile-v7.json'
MAX_PIXELS=512*512

def fail(code,msg):
    print(json.dumps({'schema':'daube.phone-edge-v7-auto-premultiply.v1','status':'FAIL','error':msg,'paidSpendAuthorized':False,'privateAssetsUsed':False},separators=(',',':'))); raise SystemExit(code)

def run_json(cmd):
    p=subprocess.run(cmd,text=True,capture_output=True)
    if p.returncode!=0: fail(p.returncode,f'child_failed:{cmd[0]}:{p.returncode}:{p.stderr.strip()}')
    receipt=None
    for line in reversed([x.strip() for x in p.stdout.splitlines() if x.strip()]):
        try: receipt=json.loads(line); break
        except json.JSONDecodeError: pass
    return receipt

def fingerprint(paths):
    h=hashlib.sha256()
    for p in paths:
        q=Path(p); h.update(str(q).encode()); h.update(q.read_bytes())
    return h.hexdigest()

def main():
    if len(sys.argv)!=3: fail(2,'usage: auto-premultiply INPUT_RGBA8_BIN OUTPUT_RGBA8_BIN')
    inp,out=Path(sys.argv[1]),Path(sys.argv[2])
    if not inp.is_file(): fail(3,'input_missing')
    size=inp.stat().st_size
    if size<=0 or size%4: fail(3,'input_invalid_rgba8')
    pixels=size//4
    if pixels>MAX_PIXELS: fail(4,'pixels_above_verified_envelope')
    v5=shutil.which('daube-phone-edge-v5-batch'); v6=shutil.which('daube-phone-edge-v6-premultiply')
    if not v5 or not v6: fail(5,'v5_or_v6_runtime_missing')
    chosen='v5'; reason='conservative_verified_fallback'; bp=None
    if PROFILE.exists():
        try:
            p=json.loads(PROFILE.read_text(encoding='utf-8'))
            if p.get('status')=='CALIBRATED' and p.get('runtimeFingerprint')==fingerprint([v5,v6]):
                bp=p.get('breakpointPixels')
                if isinstance(bp,int) and bp>0 and pixels>=bp: chosen='v6'; reason='calibrated_breakpoint'
        except Exception: pass
    if pixels==MAX_PIXELS and chosen=='v5': chosen='v6'; reason='verified_512_winner'
    runtime=v6 if chosen=='v6' else v5
    child=run_json([runtime,str(inp),str(out)])
    if not out.is_file() or out.stat().st_size!=size: fail(6,'output_invalid')
    result={'schema':'daube.phone-edge-v7-auto-premultiply.v1','status':'PASS','variant':chosen,'reason':reason,'pixels':pixels,'breakpointPixels':bp,'runtime':runtime,'childReceipt':child,'privateAssetsUsed':False,'paidSpendAuthorized':False}
    print(json.dumps(result,separators=(',',':')))

if __name__=='__main__': main()
