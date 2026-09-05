import json, os
from datetime import datetime, timezone
from pathlib import Path

def now(): return datetime.now(timezone.utc).isoformat()
def atomic_json(path,obj):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp'); tmp.write_text(json.dumps(obj,indent=2)+'\n')
    os.replace(tmp,path)
def append_event(path,row):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('a') as f:f.write(json.dumps({'at':now(),**row})+'\n')
