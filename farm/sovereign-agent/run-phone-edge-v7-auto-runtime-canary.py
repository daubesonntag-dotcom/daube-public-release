#!/usr/bin/env python3
import json, os, shutil, subprocess, tempfile
from pathlib import Path

PROFILE=Path.home()/'.local/share/daube-phone-edge/perf-profile-v7.json'
SIDE=320
PIXELS=SIDE*SIDE

def emit(obj): print(json.dumps(obj,separators=(',',':')))
def fail(code,msg,**extra):
    emit({'schema':'daube.phone-edge-v7-auto-runtime-canary.v1','status':'FAIL','error':msg,**extra,'privateAssetsUsed':False,'paidSpendAuthorized':False}); raise SystemExit(code)
def run_json(cmd,env=None):
    p=subprocess.run(cmd,text=True,capture_output=True,env=env)
    receipt=None
    for line in reversed([x.strip() for x in p.stdout.splitlines() if x.strip()]):
        try: receipt=json.loads(line); break
        except json.JSONDecodeError: pass
    return p,receipt

def thermal():
    cmd=shutil.which('daube-phone-edge-thermal-headroom')
    if not cmd: fail(3,'thermal_probe_missing')
    p,r=run_json([cmd])
    if p.returncode!=0 or not isinstance(r,dict) or r.get('supported') is not True: fail(3,'thermal_probe_failed')
    status=int(r.get('thermalStatusCode',99)); headroom=float(r.get('headroom',99))
    if status>1 or headroom>=0.80: fail(4,'thermal_guard_hold',thermal=r)
    return r

def premul_rgba(raw):
    out=bytearray(len(raw))
    for i in range(0,len(raw),4):
        r,g,b,a=raw[i:i+4]
        out[i]=(r*a+127)//255; out[i+1]=(g*a+127)//255; out[i+2]=(b*a+127)//255; out[i+3]=a
    return bytes(out)

def main():
    if not PROFILE.is_file(): fail(2,'profile_missing')
    try: profile=json.loads(PROFILE.read_text(encoding='utf-8'))
    except Exception: fail(2,'profile_invalid_json')
    if profile.get('status')!='CALIBRATED': fail(2,'profile_not_calibrated')
    bp=profile.get('breakpointPixels')
    if not isinstance(bp,int) or bp<=0: fail(2,'profile_breakpoint_invalid')
    expected='v6' if PIXELS>=bp else 'v5'
    before=thermal()
    auto=shutil.which('daube-phone-edge-auto-premultiply')
    if not auto: fail(3,'auto_runtime_missing')
    raw=bytes(((i*37+11)&255) for i in range(PIXELS*4))
    expected_bytes=premul_rgba(raw)
    with tempfile.TemporaryDirectory(prefix='daube-v7-auto-') as td:
        inp=Path(td)/'in.rgba'; out=Path(td)/'out.rgba'
        inp.write_bytes(raw)
        p,r=run_json([auto,str(inp),str(out)])
        if p.returncode!=0 or not isinstance(r,dict): fail(5,'auto_runtime_failed',returnCode=p.returncode,stderr=p.stderr.strip()[-400:])
        if r.get('status')!='PASS': fail(5,'auto_runtime_receipt_not_pass',receipt=r)
        if r.get('profileValidated') is not True: fail(5,'profile_not_validated',receipt=r)
        if r.get('runtimeFingerprint')!=profile.get('runtimeFingerprint') or r.get('profileFingerprint')!=profile.get('runtimeFingerprint'): fail(5,'fingerprint_binding_failed',receipt=r)
        if r.get('variant')!=expected: fail(5,'selector_variant_mismatch',expectedVariant=expected,receipt=r)
        if not out.is_file() or out.read_bytes()!=expected_bytes: fail(6,'cpu_reference_mismatch',receipt=r)
    after=thermal()
    emit({'schema':'daube.phone-edge-v7-auto-runtime-canary.v1','status':'PASS','device':profile.get('device'),'side':SIDE,'pixels':PIXELS,'breakpointPixels':bp,'selectedVariant':expected,'profileValidated':True,'runtimeFingerprint':profile.get('runtimeFingerprint'),'cpuReferenceVerified':True,'thermalBefore':before,'thermalAfter':after,'privateAssetsUsed':False,'paidSpendAuthorized':False})

if __name__=='__main__': main()
