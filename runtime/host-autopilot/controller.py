import json, re, urllib.request
from manifest import validate_manifest

SHA40=re.compile(r'^[0-9a-f]{40}$')
RAW_MAIN=re.compile(r'^https://raw\.githubusercontent\.com/([^/]+)/([^/]+)/main/(.+)$')

def _fetch_json(url):
    req=urllib.request.Request(url,headers={'User-Agent':'daube-host-autopilot-v1','Accept':'application/vnd.github+json','Cache-Control':'no-cache'})
    with urllib.request.urlopen(req,timeout=20) as r:return json.loads(r.read().decode())

def fetch_manifest_url(url):
    match=RAW_MAIN.fullmatch(url)
    if not match:return _fetch_json(url)
    owner,repo,path=match.groups()
    branch=_fetch_json(f'https://api.github.com/repos/{owner}/{repo}/branches/main')
    revision=str(branch.get('commit',{}).get('sha','')).lower()
    if not SHA40.fullmatch(revision):raise ValueError('github_main_revision_invalid')
    return _fetch_json(f'https://raw.githubusercontent.com/{owner}/{repo}/{revision}/{path}')

def poll_once(config,adapters):
    try:m=adapters['fetch_manifest']()
    except Exception as e:return {'classification':'NO_DATA','reason':type(e).__name__}
    ok,reason=validate_manifest(m)
    if not ok:return {'classification':'HOLD_FOUNDER_GATE','reason':reason}
    if not m['enabled']:return {'classification':'DISABLED'}
    last=config.get('last_applied') or {}
    if last.get('release_id')==m['release_id'] and last.get('target_revision')==m['target_revision']: return {'classification':'NOOP'}
    r=adapters['run_transaction'](m); return {'classification':r.get('state'),'transaction':r}
