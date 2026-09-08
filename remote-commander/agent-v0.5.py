#!/usr/bin/env python3
import argparse, hashlib, json, os, pathlib, subprocess, sys, time, urllib.request
VERSION='0.5.0'

def jreq(url,method='POST',api_key=None,device=None,device_token=None,body=None,timeout=30):
    data=None if body is None else json.dumps(body,separators=(',',':'),ensure_ascii=False).encode(); h={'Accept':'application/json','User-Agent':f'daube-host-agent/{VERSION}'}
    if api_key: h['apikey']=api_key; h['Authorization']=f'Bearer {api_key}'
    if device: h['x-daube-device']=device
    if device_token: h['x-daube-token']=device_token
    if data is not None: h['Content-Type']='application/json'
    with urllib.request.urlopen(urllib.request.Request(url,data=data,headers=h,method=method),timeout=timeout) as r:
        raw=r.read(); return json.loads(raw.decode()) if raw else {}

def allowed_cwd(cwd,roots):
    p=pathlib.Path(cwd).resolve(); return any(p==r or r in p.parents for r in roots)

def run_job(job,roots):
    jid=str(job['id']); argv=job.get('argv'); cwd=job.get('cwd') or str(roots[0]); timeout=int(job.get('timeout',120))
    if not isinstance(argv,list) or not argv or not all(isinstance(x,str) for x in argv): payload={'id':jid,'status':'REJECTED','error':'argv must be a non-empty string array'}
    elif timeout<1 or timeout>1800: payload={'id':jid,'status':'REJECTED','error':'timeout must be 1..1800 seconds'}
    elif not allowed_cwd(cwd,roots): payload={'id':jid,'status':'REJECTED','error':'cwd outside allowed roots'}
    else:
        start=time.time()
        try:
            p=subprocess.run(argv,cwd=cwd,text=True,capture_output=True,timeout=timeout,env=os.environ.copy(),shell=False)
            payload={'id':jid,'status':'SUCCEEDED' if p.returncode==0 else 'FAILED','returncode':p.returncode,'stdout':p.stdout[-200000:],'stderr':p.stderr[-200000:],'duration_ms':int((time.time()-start)*1000),'agent_version':VERSION}
        except subprocess.TimeoutExpired as e:
            payload={'id':jid,'status':'TIMEOUT','returncode':None,'stdout':(e.stdout or '')[-200000:] if isinstance(e.stdout,str) else '','stderr':(e.stderr or '')[-200000:] if isinstance(e.stderr,str) else '','duration_ms':int((time.time()-start)*1000),'agent_version':VERSION}
    canonical=json.dumps(payload,sort_keys=True,separators=(',',':'),ensure_ascii=False); return canonical,hashlib.sha256(canonical.encode()).hexdigest()

class Supervisor:
    def __init__(self,device):
        self.device=device; self.root=pathlib.Path('/opt/daube/remote-commander/sovereign-runtime'); self.db=pathlib.Path('/var/lib/daube/remote-commander/sovereign-runtime.db'); self.state=pathlib.Path('/var/lib/daube/remote-commander'); self.procs={}; self.last={}
    def specs(self):
        planner=self.root/('planner-v2.py' if (self.root/'planner-v2.py').is_file() else 'planner-v1.py')
        return {'worker':[sys.executable,str(self.root/'runtime.py'),'--db',str(self.db),'work','--worker',self.device,'--forever','--sleep','2'],'planner':[sys.executable,str(planner),'--db',str(self.db),'--forever','--sleep','60']}
    def ensure(self):
        if not (self.root/'runtime.py').is_file(): return False
        for name,argv in self.specs().items():
            p=self.procs.get(name)
            if p is not None and p.poll() is None: continue
            if time.time()-self.last.get(name,0)<5: continue
            self.state.mkdir(parents=True,exist_ok=True); logf=open(self.state/f'sovereign-{name}.log','a',encoding='utf-8')
            try: self.procs[name]=subprocess.Popen(argv,cwd=str(self.root),env=os.environ.copy(),stdout=logf,stderr=logf,start_new_session=True,close_fds=True); self.last[name]=time.time()
            finally: logf.close()
        return True
    def stop(self):
        for p in self.procs.values():
            if p and p.poll() is None:
                try: p.terminate(); p.wait(timeout=5)
                except Exception:
                    try: p.kill()
                    except Exception: pass

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--supabase-url',default=os.environ.get('DAUBE_RC_SUPABASE_URL')); ap.add_argument('--api-key',default=os.environ.get('DAUBE_RC_APIKEY')); ap.add_argument('--token-file',default=os.environ.get('DAUBE_RC_TOKEN_FILE','/etc/daube/remote-commander.token')); ap.add_argument('--device',default=os.environ.get('DAUBE_RC_DEVICE',os.uname().nodename)); ap.add_argument('--root',action='append',default=[]); ap.add_argument('--poll',type=float,default=3.0); a=ap.parse_args()
    if not a.supabase_url or not a.api_key: raise SystemExit('missing Supabase config')
    token=pathlib.Path(a.token_file).read_text().strip(); roots=[pathlib.Path(x).resolve() for x in (a.root or ['/opt/daube','/var/lib/daube'])]
    if len(token)<32: raise SystemExit('device token missing/too short')
    rpc=a.supabase_url.rstrip('/')+'/rest/v1/rpc/'; backoff=2; sup=Supervisor(a.device)
    try:
        while True:
            try:
                sup.ensure(); jreq(rpc+'daube_remote_heartbeat',api_key=a.api_key,device=a.device,device_token=token,body={'p_device_id':a.device,'p_version':VERSION,'p_roots':[str(r) for r in roots]},timeout=20)
                job=jreq(rpc+'daube_remote_claim',api_key=a.api_key,device=a.device,device_token=token,body={'p_device_id':a.device},timeout=35)
                if isinstance(job,dict) and job.get('id'):
                    canonical,sha=run_job(job,roots); jreq(rpc+'daube_remote_submit_result',api_key=a.api_key,device=a.device,device_token=token,body={'p_device_id':a.device,'p_job_id':job['id'],'p_result_text':canonical,'p_sha256':sha},timeout=30)
                backoff=2; time.sleep(a.poll)
            except KeyboardInterrupt: return
            except Exception as e: print(json.dumps({'event':'transport_error','error':str(e),'backoff':backoff}),flush=True); time.sleep(backoff); backoff=min(backoff*2,60)
    finally: sup.stop()
if __name__=='__main__': main()
