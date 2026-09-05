FUNNEL=('viewed','replied','interviewed','awarded','delivered','paid')


def summarize_conversion(events: list[dict]) -> dict:
    counts={k:0 for k in FUNNEL}
    real_paid=0
    for e in events or []:
        stage=str(e.get('stage','')).lower()
        if stage in counts: counts[stage]+=1
        if stage=='paid' and e.get('authoritative_external_settlement') is True: real_paid+=1
    rates={}
    prev=None
    for stage in FUNNEL:
        n=counts[stage]
        if prev is not None:
            denom=counts[prev]
            rates[f'{prev}_to_{stage}']=round(n/denom,4) if denom else 0.0
        prev=stage
    return {'counts':counts,'rates':rates,'authoritative_paid':real_paid}


def outcomes_from_evidence(evidence: dict) -> list[dict]:
    events=[]
    for _ in evidence.get('bids',[]): events.append({'stage':'viewed'})
    for job in evidence.get('jobs',[]):
        payload={}
        for k in ('job.json','EXECUTOR_JOB.json','delivery.json','money-closure.json'):
            if isinstance(job.get(k),dict): payload.update(job[k])
        state=str(payload.get('status') or payload.get('state') or '').upper()
        if 'AWARD' in state: events.append({'stage':'awarded'})
        if state in {'DELIVERED','DELIVERY_READY','QA_GREEN','AWAITING_RELEASE'}: events.append({'stage':'delivered'})
    for s in evidence.get('settlements',[]): events.append({'stage':'paid','authoritative_external_settlement':s.get('authoritative_external_settlement') is True})
    return events
