#!/usr/bin/env python3
import hashlib, json, os, pathlib, shutil, subprocess, sys, urllib.request
ROOT=pathlib.Path('/opt/daube/remote-commander/sovereign-runtime')
STATE=pathlib.Path('/var/lib/daube/remote-commander')
BIN_DIR=pathlib.Path('/opt/daube/bin'); BIN_DIR.mkdir(parents=True,exist_ok=True)
INSTALL=STATE/'railcall-install.sh'
URL='https://railcall.ai/install.sh'

def run(argv,env=None,timeout=300):
    cp=subprocess.run(argv,text=True,capture_output=True,timeout=timeout,shell=False,env=env or os.environ.copy())
    return {'returncode':cp.returncode,'stdout':cp.stdout[-100000:],'stderr':cp.stderr[-100000:]}

def locate():
    candidates=[BIN_DIR/'railcall',pathlib.Path('/home/daube/.local/bin/railcall'),pathlib.Path('/home/daube/bin/railcall'),pathlib.Path.home()/'.local/bin/railcall']
    w=shutil.which('railcall')
    if w: candidates.insert(0,pathlib.Path(w))
    for p in candidates:
        if p.is_file() and os.access(p,os.X_OK): return p.resolve()
    return None

existing=locate()
install_result=None
if existing is None:
    data=urllib.request.urlopen(urllib.request.Request(URL,headers={'User-Agent':'daube-railcall-bootstrap/1.0'}),timeout=45).read()
    if len(data)<100: raise SystemExit('RailCall installer unexpectedly small')
    INSTALL.write_bytes(data); INSTALL.chmod(0o700)
    sha=hashlib.sha256(data).hexdigest()
    env=os.environ.copy(); env['HOME']='/home/daube'; env['PATH']='/opt/daube/bin:/home/daube/.local/bin:/home/daube/bin:'+env.get('PATH','')
    install_result=run(['/usr/bin/bash',str(INSTALL)],env=env,timeout=300)
    if install_result['returncode']!=0:
        print(json.dumps({'status':'INSTALL_FAILED','installer_sha256':sha,'result':install_result},sort_keys=True)); raise SystemExit(1)
    existing=locate()
else: sha=None
if existing is None: raise SystemExit('RailCall installer completed but binary not found')
link=BIN_DIR/'railcall'
if link.resolve()!=existing:
    try:
        if link.exists() or link.is_symlink(): link.unlink()
        link.symlink_to(existing)
    except Exception:
        shutil.copy2(existing,link); link.chmod(0o755)
ver=run([str(link),'version'],timeout=60)
wrapper=ROOT/'railcall-executor.py'
wrapper.write_text('''#!/usr/bin/env python3\nimport json,pathlib,subprocess,sys\nBIN="/opt/daube/bin/railcall"\nROOTS=[pathlib.Path("/opt/daube").resolve(),pathlib.Path("/var/lib/daube").resolve()]\ndef safe(p):\n x=pathlib.Path(p).resolve()\n if not any(x==r or r in x.parents for r in ROOTS): raise SystemExit("path outside D’AUBE roots")\n return x\ne=json.loads(sys.argv[1]); p=e.get("payload") or {}; op=p.get("op","version")\nif op=="version": a=[BIN,"version"]\nelif op=="help": a=[BIN,"--help"]\nelif op=="market_help": a=[BIN,"market","--help"]\nelif op=="module_verify": a=[BIN,"market","module","verify",str(safe(p.get("path","")))]\nelse: raise SystemExit("unsupported railcall op")\nr=subprocess.run(a,text=True,capture_output=True,timeout=180,shell=False)\nprint(json.dumps({"op":op,"returncode":r.returncode,"stdout":r.stdout[-100000:],"stderr":r.stderr[-100000:]},sort_keys=True))\nraise SystemExit(0 if r.returncode==0 else 1)\n'''); wrapper.chmod(0o755)
runtime=str(ROOT/'runtime.py'); db=str(STATE/'sovereign-runtime.db')
cmd=f'/usr/bin/python3 {wrapper} {{payload}}'
reg=run(['/usr/bin/python3',runtime,'--db',db,'capability','railcall.local','railcall',cmd,'--health','/opt/daube/bin/railcall version','--priority','100'],timeout=30)
print(json.dumps({'status':'READY','binary':str(existing),'link':str(link),'version':ver,'installer_sha256':sha,'register':reg},sort_keys=True))
