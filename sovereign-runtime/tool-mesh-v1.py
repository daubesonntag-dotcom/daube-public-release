#!/usr/bin/env python3
import argparse, hashlib, json, os, pathlib, platform, shutil, subprocess, sys, urllib.parse, urllib.request

ROOTS=[pathlib.Path('/opt/daube').resolve(),pathlib.Path('/var/lib/daube').resolve()]
ALLOWED_HTTP_HOSTS={'railcall.ai','www.railcall.ai','github.com','raw.githubusercontent.com','api.github.com','huggingface.co'}

def out(v): print(json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False))
def safe_path(p):
    x=pathlib.Path(p).expanduser().resolve()
    if not any(x==r or r in x.parents for r in ROOTS): raise SystemExit('path outside D’AUBE roots')
    return x

def run(argv,cwd=None,timeout=120):
    cp=subprocess.run(argv,cwd=str(cwd) if cwd else None,text=True,capture_output=True,timeout=timeout,shell=False)
    return {'argv':argv,'returncode':cp.returncode,'stdout':cp.stdout[-100000:],'stderr':cp.stderr[-100000:]}

def envelope(raw):
    e=json.loads(raw); p=e.get('payload') or {}
    if not isinstance(p,dict): raise SystemExit('payload must be object')
    return e,p

def host_exec(p):
    op=p.get('op','inventory')
    if op=='inventory':
        tools={n:shutil.which(n) for n in ['python3','git','curl','node','npm','npx','docker','railcall','ffmpeg','cloudflared','ollama']}
        mem={}
        try:
            for line in pathlib.Path('/proc/meminfo').read_text().splitlines()[:6]:
                k,v=line.split(':',1); mem[k]=v.strip()
        except Exception: pass
        st=os.statvfs('/')
        return {'op':op,'hostname':platform.node(),'platform':platform.platform(),'machine':platform.machine(),'cpu_count':os.cpu_count(),'disk_root':{'total':st.f_blocks*st.f_frsize,'free':st.f_bavail*st.f_frsize},'memory':mem,'tools':tools}
    if op=='service_status':
        services=['daube-remote-agent.service','daube-remote-watchdog.timer']
        result={}
        for s in services:
            result[s]={'active':run(['/usr/bin/systemctl','is-active',s],timeout=15),'enabled':run(['/usr/bin/systemctl','is-enabled',s],timeout=15)}
        return {'op':op,'services':result}
    raise SystemExit('unsupported host op')

def git_exec(p):
    op=str(p.get('op','status'))
    if not shutil.which('git'): raise SystemExit('git unavailable')
    if op=='clone_public':
        url=str(p.get('url','')); name=str(p.get('name','')).strip()
        u=urllib.parse.urlparse(url)
        if u.scheme!='https' or u.hostname!='github.com' or '@' in u.netloc: raise SystemExit('only credential-free https://github.com URLs allowed')
        if not name or '/' in name or name in {'.','..'}: raise SystemExit('invalid clone name')
        base=pathlib.Path('/opt/daube/repos'); base.mkdir(parents=True,exist_ok=True); dst=safe_path(base/name)
        if dst.exists(): return {'op':op,'status':'EXISTS','path':str(dst)}
        r=run(['/usr/bin/git','clone','--depth','1','--',url,str(dst)],cwd=base,timeout=300); return {'op':op,'path':str(dst),'result':r}
    repo=safe_path(str(p.get('path','/opt/daube')))
    if op=='status': argv=['/usr/bin/git','status','--short','--branch']
    elif op=='rev_parse': argv=['/usr/bin/git','rev-parse','HEAD']
    elif op=='fetch': argv=['/usr/bin/git','fetch','--prune','--tags']
    elif op=='pull_ff_only': argv=['/usr/bin/git','pull','--ff-only']
    elif op=='log': argv=['/usr/bin/git','log','-n',str(max(1,min(int(p.get('n',10)),50))),'--oneline','--decorate']
    else: raise SystemExit('unsupported git op')
    return {'op':op,'path':str(repo),'result':run(argv,cwd=repo,timeout=180)}

def http_exec(p):
    op=str(p.get('op','head')); url=str(p.get('url',''))
    u=urllib.parse.urlparse(url)
    if u.scheme!='https' or u.hostname not in ALLOWED_HTTP_HOSTS or u.username or u.password: raise SystemExit('URL not allowed')
    method='HEAD' if op=='head' else 'GET'
    if op not in {'head','get_text'}: raise SystemExit('unsupported http op')
    req=urllib.request.Request(url,method=method,headers={'User-Agent':'daube-tool-mesh/1.0'})
    with urllib.request.urlopen(req,timeout=30) as r:
        body='' if method=='HEAD' else r.read(1048576).decode('utf-8','replace')
        return {'op':op,'url':url,'status':r.status,'headers':dict(r.headers.items()),'body':body}

def railcall_exec(p):
    binary=shutil.which('railcall')
    if not binary: return {'available':False,'op':p.get('op','version')}
    op=str(p.get('op','version'))
    if op=='version': argv=[binary,'version']
    elif op=='help': argv=[binary,'--help']
    elif op=='market_help': argv=[binary,'market','--help']
    elif op=='module_verify': argv=[binary,'market','module','verify',str(safe_path(str(p.get('path',''))))]
    else: raise SystemExit('unsupported railcall op')
    return {'available':True,'op':op,'result':run(argv,timeout=180)}

def register(runtime,db):
    root='/opt/daube/remote-commander/sovereign-runtime'; mesh=f'{root}/tool-mesh-v1.py'
    caps=[
      ('host.local','host',f'/usr/bin/python3 {mesh} exec host {{payload}}','/usr/bin/python3 --version',100),
      ('git.local','git',f'/usr/bin/python3 {mesh} exec git {{payload}}','/usr/bin/git --version',95),
      ('http.readonly','http',f'/usr/bin/python3 {mesh} exec http {{payload}}','/usr/bin/curl --version',90),
      ('railcall.local','railcall',f'/usr/bin/python3 {mesh} exec railcall {{payload}}','/usr/bin/python3 -c "import shutil,sys; sys.exit(0 if shutil.which(\'railcall\') else 1)"',100),
    ]
    results=[]
    for cid,kind,cmd,health,pri in caps:
        results.append(run(['/usr/bin/python3',runtime,'--db',db,'capability',cid,kind,cmd,'--health',health,'--priority',str(pri)],cwd=pathlib.Path(runtime).parent,timeout=30))
    return {'registered':[c[0] for c in caps],'results':results}

def main():
    ap=argparse.ArgumentParser(); sp=ap.add_subparsers(dest='cmd',required=True)
    e=sp.add_parser('exec'); e.add_argument('kind',choices=['host','git','http','railcall']); e.add_argument('payload')
    r=sp.add_parser('register'); r.add_argument('--runtime',required=True); r.add_argument('--db',required=True)
    a=ap.parse_args()
    if a.cmd=='register': out(register(a.runtime,a.db)); return
    _,p=envelope(a.payload)
    fn={'host':host_exec,'git':git_exec,'http':http_exec,'railcall':railcall_exec}[a.kind]
    out(fn(p))
if __name__=='__main__': main()
