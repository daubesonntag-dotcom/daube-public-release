import json,re
SHA40=re.compile(r'^[0-9a-f]{40}$'); SHA256=re.compile(r'^[0-9a-f]{64}$')
ALLOWED_PREFIXES=('installers/','runtime/')

def load_manifest_bytes(raw):
    data=json.loads(raw.decode('utf-8')); ok,reason=validate_manifest(data)
    if not ok: raise ValueError(reason)
    return data

def validate_manifest(data):
    if data.get('schema')!='daube.host-autopilot.v1': return False,'SCHEMA'
    if not isinstance(data.get('enabled'),bool): return False,'ENABLED'
    if not SHA40.fullmatch(str(data.get('target_revision',''))): return False,'REVISION'
    if not data.get('release_id') or not isinstance(data['release_id'],str): return False,'RELEASE_ID'
    arts=data.get('artifacts')
    if not isinstance(arts,list) or not arts: return False,'ARTIFACTS'
    seen=set()
    for a in arts:
        p=a.get('path','')
        if not isinstance(p,str) or not p.startswith(ALLOWED_PREFIXES) or '..' in p.split('/'): return False,'PATH'
        if p in seen:return False,'DUPLICATE_PATH'
        seen.add(p)
        if not SHA256.fullmatch(str(a.get('sha256',''))): return False,'SHA256'
        if a.get('mode') not in {'0600','0644','0700','0755'}: return False,'MODE'
    checks=data.get('checks',[])
    if not isinstance(checks,list): return False,'CHECKS'
    for c in checks:
        if not isinstance(c,list) or not c or not all(isinstance(x,str) and x for x in c): return False,'CHECK_ARGV_ONLY'
    act=data.get('activation') or {}
    if act.get('kind')!='installer': return False,'ACTIVATION_KIND'
    ep=act.get('entrypoint','')
    if not isinstance(ep,str) or not ep.startswith('installers/') or '..' in ep.split('/'): return False,'ACTIVATION_PATH'
    if data.get('rollback')!='required': return False,'ROLLBACK_REQUIRED'
    units=data.get('health_units',[])
    if not isinstance(units,list) or not all(isinstance(x,str) and x.startswith('daube-') for x in units): return False,'HEALTH_UNITS'
    return True,'OK'
