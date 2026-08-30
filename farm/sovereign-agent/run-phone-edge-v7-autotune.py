#!/usr/bin/env python3
import hashlib, json, math, os, shutil, statistics, subprocess, tempfile, time
from pathlib import Path

SIZES=(224,256,320,384,448,512)
REPEATS=2
THERMAL_HOLD=0.80
PROFILE=Path.home()/'.local/share/daube-phone-edge/perf-profile-v7.json'

def run_json(cmd):
    p=subprocess.run(cmd,text=True,capture_output=True)
    if p.returncode!=0: raise RuntimeError(f'command_failed:{cmd[0]}:{p.returncode}:{p.stderr.strip()}')
    for line in reversed([x.strip() for x in p.stdout.splitlines() if x.strip()]):
        try:return json.loads(line)
        except json.JSONDecodeError:pass
    raise RuntimeError(f'json_missing:{cmd[0]}')

def thermal_guard(stage):
    probe=shutil.which('daube-phone-edge-thermal-headroom')
    if not probe: raise RuntimeError('thermal_probe_missing')
    row=run_json([probe])
    if not row.get('supported'): raise RuntimeError('thermal_headroom_unsupported')
    head=float(row.get('headroom',99))
    code=int(row.get('thermalStatusCode',99))
    if head>=THERMAL_HOLD or code>1: raise RuntimeError(f'thermal_hold:{stage}:{head}:{code}')
    return row

def rgba(side):
    out=bytearray(side*side*4)
    for i in range(side*side):
        b=i*4; out[b]=(i*17+3)&255; out[b+1]=(i*29+11)&255; out[b+2]=(i*43+19)&255; out[b+3]=(i*31+127)&255
    return bytes(out)

def premul(raw):
    out=bytearray(raw)
    for i in range(0,len(out),4):
        a=out[i+3]
        for c in (0,1,2): out[i+c]=(out[i+c]*a+127)//255
    return bytes(out)

def timed(cmd):
    t=time.perf_counter(); receipt=run_json(cmd); return (time.perf_counter()-t)*1000,receipt

def median(cmd,out,expected):
    vals=[]
    for _ in range(REPEATS):
        thermal_guard('repeat')
        ms,_=timed(cmd); vals.append(ms)
        if Path(out).read_bytes()!=expected: raise RuntimeError('cpu_reference_mismatch')
    return statistics.median(vals)

def fingerprint(paths):
    h=hashlib.sha256()
    for p in paths:
        q=Path(p); h.update(str(q).encode()); h.update(q.read_bytes())
    return h.hexdigest()

def derive_breakpoint(rows):
    # Require a meaningful win (>=5%) and prefer the first point that is not contradicted later.
    winners=[r for r in rows if r['v6Ms'] <= r['v5Ms']*0.95]
    for r in winners:
        later=[x for x in rows if x['side']>=r['side']]
        if later and all(x['v6Ms'] <= x['v5Ms']*1.02 for x in later): return r['side']
    return winners[-1]['side'] if winners else 513

def main():
    v5=shutil.which('daube-phone-edge-v5-batch'); v6=shutil.which('daube-phone-edge-v6-premultiply')
    if not v5 or not v6: raise RuntimeError('v5_or_v6_runtime_missing')
    before=thermal_guard('before')
    rows=[]
    with tempfile.TemporaryDirectory(prefix='daube-v7-') as td:
        root=Path(td)
        for side in SIZES:
            raw=rgba(side); ref=premul(raw)
            inp=root/f'in-{side}.rgba'; o5=root/f'v5-{side}.rgba'; o6=root/f'v6-{side}.rgba'; inp.write_bytes(raw)
            v5ms=median([v5,str(inp),str(o5)],o5,ref)
            v6ms=median([v6,str(inp),str(o6)],o6,ref)
            rows.append({'side':side,'pixels':side*side,'v5Ms':round(v5ms,3),'v6Ms':round(v6ms,3),'v6VsV5':round(v5ms/v6ms,3),'cpuReferenceVerified':True,'thermalSafe':True})
    after=thermal_guard('after')
    bp=derive_breakpoint(rows)
    profile={'schema':'daube.phone-edge-v7-autotune-profile.v1','status':'CALIBRATED','device':'Mali-G615 MC6','breakpointSide':bp,'breakpointPixels':bp*bp if bp<=512 else None,'samples':rows,'runtimeFingerprint':fingerprint([v5,v6]),'thermalBefore':before,'thermalAfter':after,'privateAssetsUsed':False,'paidSpendAuthorized':False}
    PROFILE.parent.mkdir(parents=True,exist_ok=True); PROFILE.write_text(json.dumps(profile,separators=(',',':')),encoding='utf-8')
    print(json.dumps(profile,separators=(',',':')))

if __name__=='__main__':
    try: main()
    except Exception as exc:
        print(json.dumps({'schema':'daube.phone-edge-v7-autotune-profile.v1','status':'FAIL','error':str(exc),'privateAssetsUsed':False,'paidSpendAuthorized':False},separators=(',',':'))); raise SystemExit(20)
