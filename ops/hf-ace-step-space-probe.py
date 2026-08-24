#!/usr/bin/env python3
from __future__ import annotations
import json, os, traceback
from datetime import datetime, timezone
from pathlib import Path
OUT=Path(os.environ.get('DAUBE_HF_PROBE_OUT','outputs/hf-ace-step-probe')); OUT.mkdir(parents=True,exist_ok=True)
REPORT=OUT/'api-contract.json'
def write(x): REPORT.write_text(json.dumps(x,ensure_ascii=False,indent=2,default=str),encoding='utf-8')
def main():
    p={'schemaVersion':1,'space':'ACE-Step/Ace-Step-v1.5','probedAt':datetime.now(timezone.utc).isoformat(),'state':'STARTED'}; write(p)
    try:
        from gradio_client import Client
        c=Client('ACE-Step/Ace-Step-v1.5',verbose=False)
        p.update({'state':'LIVE_API_DISCOVERED','api':c.view_api(return_format='dict'),'spaceUrl':str(getattr(c,'src',None))})
        write(p); return 0
    except Exception as e:
        p.update({'state':'PROBE_FAILED','errorType':type(e).__name__,'error':str(e),'traceback':traceback.format_exc()}); write(p); return 1
if __name__=='__main__': raise SystemExit(main())
