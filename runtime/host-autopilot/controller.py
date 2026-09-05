import json, urllib.request
from manifest import validate_manifest

def fetch_manifest_url(url):
    with urllib.request.urlopen(url,timeout=20) as r:return json.loads(r.read().decode())
def poll_once(config,adapters):
    try:m=adapters['fetch_manifest']()
    except Exception as e:return {'classification':'NO_DATA','reason':type(e).__name__}
    ok,reason=validate_manifest(m)
    if not ok:return {'classification':'HOLD_FOUNDER_GATE','reason':reason}
    if not m['enabled']:return {'classification':'DISABLED'}
    last=config.get('last_applied') or {}
    if last.get('release_id')==m['release_id'] and last.get('target_revision')==m['target_revision']: return {'classification':'NOOP'}
    r=adapters['run_transaction'](m); return {'classification':r.get('state'),'transaction':r}
