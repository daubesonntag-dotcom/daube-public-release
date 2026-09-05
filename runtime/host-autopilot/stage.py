import hashlib, os
from pathlib import Path
class StageError(RuntimeError): pass

def artifact_url(repo,revision,path): return f'https://raw.githubusercontent.com/{repo}/{revision}/{path}'
def stage_release(manifest,stage_dir,fetcher,repo='daubesonntag-dotcom/daube-public-release'):
    stage_dir=Path(stage_dir); stage_dir.mkdir(parents=True,exist_ok=True); rows=[]
    for a in manifest['artifacts']:
        data=fetcher(artifact_url(repo,manifest['target_revision'],a['path']))
        digest=hashlib.sha256(data).hexdigest()
        if digest!=a['sha256']: raise StageError(f'HASH_MISMATCH:{a["path"]}')
        dest=stage_dir/a['path']; dest.parent.mkdir(parents=True,exist_ok=True)
        tmp=dest.with_suffix(dest.suffix+'.tmp'); tmp.write_bytes(data); os.chmod(tmp,int(a['mode'],8)); os.replace(tmp,dest)
        rows.append({'path':a['path'],'sha256':digest,'bytes':len(data)})
    return {'classification':'PASS','artifacts':rows}
