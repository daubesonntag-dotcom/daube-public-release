#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, os, pathlib, signal, subprocess, sys, time, urllib.request

VERSION='0.6.0'
SELF=pathlib.Path(__file__).resolve()
ROOT=pathlib.Path('/opt/daube/remote-commander/sovereign-runtime')
STATE=pathlib.Path('/var/lib/daube/remote-commander')
DB=STATE/'sovereign-runtime.db'
HEALTH=STATE/'process-health.json'
STOP=False

def jreq(url,method='POST',api_key=None,device=None,device_token=None,body=None,timeout=30):
    data=None if body is None else json.dumps(body,separators=(',',':'),ensure_ascii=False).encode()
    h={'Accept':'application/json','User-Agent':f'daube-host-agent/{VERSION}'}
    if api_key: h['apikey']=api_key; h['Authorization']=f'Bearer {api_key}'
    if device: h['x-daube-device']=device
    if device_token: h['x-daube-token']=device_token
    if data is not None: h['Content-Type']='application/json'
    req=urllib.request.Request(url,data=data,headers=h,method=method)
    with urllib.request.urlopen(req,timeout=timeout) as r:
        raw=r.read(); return json.loads(raw.decode()) if raw else {}

def allowed_cwd(cwd,roots):
    p=pathlib.Path(cwd).resolve(); return any(p==r or r in p.parents for r in roots)

def run_job(job,roots):
    jid=str(job['id']); argv=job.get('argv'); cwd=job.get('cwd') or str(roots[0]); timeout=int(job.get('timeout',120)); started=time.time()
    if not isinstance(argv,list) or not argv or not all(isinstance(x,str) for x in argv):
        payload={'id':jid,'status':'REJECTED','error':'argv must be a non-empty string array'}
    elif timeout<1 or timeout>1800:
        payload={'id':jid,'status':'REJECTED','error':'timeout must be 1..1800 seconds'}
    elif not allowed_cwd(cwd,roots):
        payload={'id':jid,'status':'REJECTED','error':'cwd outside allowed roots'}
    else:
        try:
            p=subprocess.run(argv,cwd=cwd,text=True,capture_output=True,timeout=timeout,env=os.environ.copy(),shell=False)
            payload={'id':jid,'status':'SUCCEEDED' if p.returncode==0 else 'FAILED','returncode':p.returncode,'stdout':p.stdout[-200000:],'stderr':p.stderr[-200000:],'duration_ms':int((time.time()-started)*1000),'agent_version':VERSION}
        except subprocess.TimeoutExpired as e:
            payload={'id':jid,'status':'TIMEOUT','returncode':None,'stdout':(e.stdout or '')[-200000:] if isinstance(e.stdout,str) else '','stderr':(e.stderr or '')[-200000:] if isinstance(e.stderr,str) else '','duration_ms':int((time.time()-started)*1000),'agent_version':VERSION}
        except Exception as e:
            payload={'id':jid,'status':'FAILED','returncode':1,'stdout':'','stderr':str(e)[:12000],'duration_ms':int((time.time()-started)*1000),'agent_version':VERSION}
    canonical=json.dumps(payload,sort_keys=True,separators=(',',':'),ensure_ascii=False)
    return canonical,hashlib.sha256(canonical.encode()).hexdigest()

def transport_loop(a):
    token=pathlib.Path(a.token_file).read_text().strip(); roots=[pathlib.Path(x).resolve() for x in (a.root or ['/opt/daube','/var/lib/daube'])]
    if not a.supabase_url or not a.api_key: raise SystemExit('missing Supabase config')
    if len(token)<32: raise SystemExit('device token missing/too short')
    rpc=a.supabase_url.rstrip('/')+'/rest/v1/rpc/'; backoff=1
    while True:
        try:
            jreq(rpc+'daube_remote_heartbeat',api_key=a.api_key,device=a.device,device_token=token,body={'p_device_id':a.device,'p_version':VERSION,'p_roots':[str(r) for r in roots]},timeout=20)
            job=jreq(rpc+'daube_remote_claim',api_key=a.api_key,device=a.device,device_token=token,body={'p_device_id':a.device},timeout=35)
            if isinstance(job,dict) and job.get('id'):
                canonical,sha=run_job(job,roots)
                jreq(rpc+'daube_remote_submit_result',api_key=a.api_key,device=a.device,device_token=token,body={'p_device_id':a.device,'p_job_id':job['id'],'p_result_text':canonical,'p_sha256':sha},timeout=30)
            backoff=1; time.sleep(max(0.5,a.poll))
        except KeyboardInterrupt: return
        except Exception as e:
            print(json.dumps({'role':'transport','event':'error','error':str(e)[:1000],'backoff':backoff}),flush=True)
            time.sleep(backoff); backoff=min(backoff*2,30)

def atomic_json(path,data):
    path.parent.mkdir(parents=True,exist_ok=True); tmp=path.with_suffix(path.suffix+'.tmp')
    tmp.write_text(json.dumps(data,sort_keys=True,ensure_ascii=False),encoding='utf-8'); os.replace(tmp,path)

def cleanup_orphans():
    uid=os.getuid(); targets=[]
    runtime=str(ROOT/'runtime.py'); planners={str(ROOT/'planner-v1.py'),str(ROOT/'planner-v2.py')}
    for p in pathlib.Path('/proc').glob('[0-9]*'):
        try:
            pid=int(p.name)
            if pid==os.getpid() or p.stat().st_uid!=uid: continue
            args=[x.decode(errors='ignore') for x in (p/'cmdline').read_bytes().split(b'\x00') if x]
            if runtime in args and 'work' in args: targets.append(pid)
            elif any(x in args for x in planners): targets.append(pid)
        except Exception: pass
    for pid in targets:
        try: os.kill(pid,signal.SIGTERM)
        except Exception: pass
    if targets: time.sleep(1)
    return targets

class IslandSupervisor:
    def __init__(self,a):
        self.a=a; self.children={}; self.attempts={}; self.started={}; self.next_start={}; self.orphans=[]
    def specs(self):
        planner=ROOT/('planner-v2.py' if (ROOT/'planner-v2.py').is_file() else 'planner-v1.py')
        specs={
          'transport':[sys.executable,str(SELF),'--role','transport','--poll',str(self.a.poll)],
        }
        if (ROOT/'runtime.py').is_file(): specs['worker']=[sys.executable,str(ROOT/'runtime.py'),'--db',str(DB),'work','--worker',self.a.device,'--forever','--sleep','2']
        if planner.is_file(): specs['planner']=[sys.executable,str(planner),'--db',str(DB),'--forever','--sleep','60']
        return specs
    def spawn(self,name,argv):
        STATE.mkdir(parents=True,exist_ok=True); log=open(STATE/f'island-{name}.log','a',encoding='utf-8')
        try:
            p=subprocess.Popen(argv,cwd=str(ROOT if name!='transport' else SELF.parent),env=os.environ.copy(),stdout=log,stderr=log,start_new_session=True,close_fds=True)
        finally: log.close()
        self.children[name]=p; self.started[name]=time.time(); self.next_start[name]=0
    def ensure(self):
        now=time.time()
        for name,argv in self.specs().items():
            p=self.children.get(name)
            if p is not None and p.poll() is None:
                if now-self.started.get(name,now)>30: self.attempts[name]=0
                continue
            if p is not None and p.poll() is not None:
                n=self.attempts.get(name,0)+1; self.attempts[name]=n
                delay=min(30,2**min(n,5)); self.next_start[name]=max(self.next_start.get(name,0),now+delay); self.children.pop(name,None)
            if now>=self.next_start.get(name,0) and name not in self.children:
                try: self.spawn(name,argv)
                except Exception as e:
                    n=self.attempts.get(name,0)+1; self.attempts[name]=n; self.next_start[name]=now+min(30,2**min(n,5))
                    print(json.dumps({'role':'supervisor','event':'spawn_error','child':name,'error':str(e)[:1000]}),flush=True)
        health={'version':VERSION,'supervisor_pid':os.getpid(),'timestamp':time.time(),'children':{},'cleaned_orphans':self.orphans}
        for name in self.specs():
            p=self.children.get(name); health['children'][name]={'pid':p.pid if p else None,'running':bool(p and p.poll() is None),'exit_code':None if not p or p.poll() is None else p.poll(),'restart_attempts':self.attempts.get(name,0),'started_at':self.started.get(name)}
        atomic_json(HEALTH,health)
    def stop(self):
        for p in list(self.children.values()):
            if p.poll() is None:
                try: os.killpg(p.pid,signal.SIGTERM)
                except Exception:
                    try: p.terminate()
                    except Exception: pass
        deadline=time.time()+5
        for p in list(self.children.values()):
            if p.poll() is None:
                try: p.wait(timeout=max(0.1,deadline-time.time()))
                except Exception:
                    try: os.killpg(p.pid,signal.SIGKILL)
                    except Exception: pass
    def run(self):
        self.orphans=cleanup_orphans()
        global STOP
        while not STOP:
            self.ensure(); time.sleep(1)
        self.stop()

def signal_stop(signum,frame):
    global STOP; STOP=True

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--role',choices=['supervisor','transport'],default='supervisor'); ap.add_argument('--supabase-url',default=os.environ.get('DAUBE_RC_SUPABASE_URL')); ap.add_argument('--api-key',default=os.environ.get('DAUBE_RC_APIKEY')); ap.add_argument('--token-file',default=os.environ.get('DAUBE_RC_TOKEN_FILE','/etc/daube/remote-commander.token')); ap.add_argument('--device',default=os.environ.get('DAUBE_RC_DEVICE',os.uname().nodename)); ap.add_argument('--root',action='append',default=[]); ap.add_argument('--poll',type=float,default=3.0); a=ap.parse_args()
    if a.role=='transport': transport_loop(a); return
    signal.signal(signal.SIGTERM,signal_stop); signal.signal(signal.SIGINT,signal_stop)
    IslandSupervisor(a).run()
if __name__=='__main__': main()
