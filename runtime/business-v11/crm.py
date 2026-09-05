from models import scrub


def _client_key(item):
    for k in ('client_id','owner_id','buyer_id','employer_id','user_id'):
        v=item.get(k)
        if v is not None: return f'freelancer:{v}'
    return None


def merge_client_records(existing: dict, evidence: dict):
    records=dict(existing or {})
    for bid in evidence.get('bids',[]):
        key=_client_key(bid)
        if not key: continue
        r=dict(records.get(key,{}))
        r.update({'client_key':key,'platform':'freelancer'})
        projects=set(r.get('projects',[]))
        pid=bid.get('project_id') or bid.get('id')
        if pid is not None: projects.add(str(pid))
        r['projects']=sorted(projects)
        r['last_bid_id']=bid.get('bid_id') or bid.get('id') or r.get('last_bid_id')
        r['next_action']=r.get('next_action') or 'WAIT_CLIENT'
        records[key]=r
    for job in evidence.get('jobs',[]):
        payload={}
        for k in ('job.json','EXECUTOR_JOB.json'):
            if isinstance(job.get(k),dict): payload.update(job[k])
        key=_client_key(payload)
        if not key: continue
        r=dict(records.get(key,{})); r.update({'client_key':key,'platform':'freelancer'})
        projects=set(r.get('projects',[])); projects.add(str(job.get('job_id'))); r['projects']=sorted(projects)
        r['job_state']=payload.get('status') or payload.get('state') or r.get('job_state')
        records[key]=r
    return scrub(records)
