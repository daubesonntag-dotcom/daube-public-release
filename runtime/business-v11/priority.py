RISKY_ACTIONS={
    'SPEND','BUY_CONNECTS','BOOST','CHANGE_PAYOUT','CHANGE_BANK','CHANGE_TAX',
    'CHANGE_IDENTITY','KYC','OTP','CAPTCHA','LEGAL_EXCEPTION','OFF_PLATFORM_PAYMENT'
}
DISPATCHABLE={'SCOUT','FOLLOW_CLIENT','AWARD_WATCH','EXECUTE_JOB','RUN_QA','DELIVER','REQUEST_RELEASE','WAIT_SETTLEMENT'}


def score_action(action: dict) -> float:
    if action.get('type') in RISKY_ACTIONS: return -10_000.0
    value=float(action.get('expected_net_value',0) or 0)
    win=float(action.get('probability_of_win',0.5) or 0)
    urgency=float(action.get('urgency',0.5) or 0)
    confidence=float(action.get('delivery_confidence',0.5) or 0)
    collect=float(action.get('collectability',0.5) or 0)
    risk=float(action.get('risk',0) or 0)
    ambiguity=float(action.get('ambiguity',0) or 0)
    effort=float(action.get('effort',0) or 0)
    friction=float(action.get('policy_friction',0) or 0)
    return round(value*win*max(urgency,0.1)*max(confidence,0.1)*max(collect,0.1) - 25*(risk+ambiguity+friction) - effort, 4)


def _gate(action_type, reason, source=None):
    return {'type':'FOUNDER_GATE','reason':reason,'source':source,'score':-9999}


def build_queue(evidence: dict, crm: dict):
    queue=[]
    watchdog=evidence.get('watchdog') or {}
    if watchdog.get('overall')=='HOLD': queue.append(_gate('FOUNDER_GATE','WATCHDOG_HOLD','watchdog'))
    for job in evidence.get('jobs',[]):
        payload={}
        for k in ('job.json','EXECUTOR_JOB.json','delivery.json','money-closure.json'):
            if isinstance(job.get(k),dict): payload.update(job[k])
        hours=float(payload.get('estimated_hours',0) or 0)
        if hours>72:
            queue.append(_gate('FOUNDER_GATE','SCOPE_OVER_72H',job.get('job_id'))); continue
        state=str(payload.get('status') or payload.get('state') or '').upper()
        if state in {'READY_FOR_EXECUTOR','AWARDED_ACCEPTED'}:
            queue.append({'type':'EXECUTE_JOB','job_id':job.get('job_id'),'expected_net_value':payload.get('amount',0),'delivery_confidence':0.9,'collectability':0.8,'urgency':0.9})
        elif state in {'DELIVERY_READY','QA_GREEN'}:
            queue.append({'type':'DELIVER','job_id':job.get('job_id'),'urgency':1,'delivery_confidence':1,'collectability':0.8})
        elif state in {'DELIVERED','AWAITING_RELEASE'}:
            queue.append({'type':'REQUEST_RELEASE','job_id':job.get('job_id'),'urgency':0.8,'delivery_confidence':1,'collectability':0.9})
    if not queue:
        queue.append({'type':'SCOUT','urgency':0.5,'delivery_confidence':1,'collectability':0.7,'expected_net_value':50})
    for a in queue: a['score']=score_action(a)
    return sorted(queue,key=lambda x:(x.get('type')=='FOUNDER_GATE',x.get('score',0)),reverse=True)
