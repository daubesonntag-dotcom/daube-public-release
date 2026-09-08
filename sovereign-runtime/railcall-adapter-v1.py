#!/usr/bin/env python3
import argparse,json,os,pathlib,subprocess
BASE=pathlib.Path('/var/lib/daube/remote-commander')
RC_HOME=BASE/'railcall'; RC_CONF=BASE/'railcall-conf'; USER_HOME=BASE/'railcall-user'; BIN=RC_HOME/'bin/railcall'
ROOTS=[pathlib.Path('/opt/daube').resolve(),pathlib.Path('/var/lib/daube').resolve()]
def safe(p):
    x=pathlib.Path(p).resolve()
    if not any(x==r or r in x.parents for r in ROOTS): raise SystemExit('path outside D’AUBE roots')
    return x
def env():
    e=os.environ.copy(); e['HOME']=str(USER_HOME); e['RAILCALL_HOME']=str(RC_HOME); e['RAILCALL_CONF']=str(RC_CONF); e['RAILCALL_NO_TELEMETRY']='1'; e['PATH']=str(RC_HOME/'bin')+os.pathsep+e.get('PATH',''); return e
def run(argv,timeout=180):
    p=subprocess.run(argv,text=True,capture_output=True,timeout=timeout,shell=False,env=env()); return {'returncode':p.returncode,'stdout':p.stdout[-100000:],'stderr':p.stderr[-100000:]}
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('payload'); a=ap.parse_args(); e=json.loads(a.payload); p=e.get('payload') or {}; op=str(p.get('op','version'))
    if not BIN.is_file(): print(json.dumps({'available':False,'binary':str(BIN),'op':op},sort_keys=True)); return
    if op=='version': argv=[str(BIN),'version']
    elif op=='doctor': argv=[str(BIN),'doctor']
    elif op=='help': argv=[str(BIN),'--help']
    elif op=='market_help': argv=[str(BIN),'market','--help']
    elif op=='market_list': argv=[str(BIN),'market','list']
    elif op=='module_verify': argv=[str(BIN),'market','module','verify',str(safe(str(p.get('path',''))))]
    else: raise SystemExit('unsupported railcall op')
    print(json.dumps({'available':True,'op':op,'binary':str(BIN),'result':run(argv)},sort_keys=True,ensure_ascii=False))
if __name__=='__main__': main()
