import json
from pathlib import Path
from models import load_json, scrub


def _jsonl(path: Path):
    out=[]
    try:
        for line in path.read_text(encoding='utf-8', errors='ignore').splitlines():
            try: out.append(json.loads(line))
            except Exception: pass
    except Exception: pass
    return out


def _job_records(base: Path):
    jobs=[]
    root=base/'full-loop'/'jobs'
    if not root.exists(): return jobs
    for p in sorted(root.glob('*')):
        if not p.is_dir(): continue
        record={'job_id':p.name}
        for name in ('job.json','EXECUTOR_JOB.json','delivery.json','money-closure.json'):
            f=p/name
            if f.is_file(): record[name]=load_json(f,{})
        jobs.append(record)
    return jobs


def _bid_receipts(base: Path):
    root=base/'receipts'
    if not root.exists(): return []
    out=[]
    for p in sorted(root.glob('*.json')):
        x=load_json(p,{})
        if x: out.append({'file':p.name, **x})
    return out


def collect_business_evidence(home: Path):
    home=Path(home); base=home/'daube-revenue-worker'
    ledger=_jsonl(base/'full-loop'/'money-closure'/'revenue-ledger.jsonl')
    settlements=[x for x in ledger if x.get('authoritative_external_settlement') is True]
    watchdog=load_json(base/'watchdog'/'health.json',{})
    v10=load_json(base/'v10'/'state.json',{})
    evidence={
        'jobs':_job_records(base),
        'bids':_bid_receipts(base),
        'watchdog':watchdog,
        'v10':v10,
        'settlements':settlements,
        'settled_count':len(settlements),
    }
    return scrub(evidence)


def revenue_truth(evidence: dict):
    return {
        'authoritative_settlements':len(evidence.get('settlements',[])),
        'has_real_revenue':bool(evidence.get('settlements')),
    }
