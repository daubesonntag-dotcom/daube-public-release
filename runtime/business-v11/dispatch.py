from priority import RISKY_ACTIONS

TIMER_BY_ACTION={
    'SCOUT':'daube-revenue-worker.timer',
    'FOLLOW_CLIENT':'daube-native-revenue-autopilot.timer',
    'AWARD_WATCH':'daube-freelancer-award-watcher.timer',
    'EXECUTE_JOB':'daube-freelancer-executor.timer',
    'RUN_QA':'daube-freelancer-executor.timer',
    'DELIVER':'daube-freelancer-money-closure.timer',
    'REQUEST_RELEASE':'daube-freelancer-money-closure.timer',
    'WAIT_SETTLEMENT':'daube-freelancer-money-closure.timer',
}


def dispatch_action(action: dict) -> dict:
    typ=action.get('type')
    if typ=='FOUNDER_GATE' or typ in RISKY_ACTIONS:
        return {'classification':'FOUNDER_GATE','action':typ,'reason':action.get('reason') or 'PROHIBITED_AUTHORITY'}
    timer=TIMER_BY_ACTION.get(typ)
    if not timer:
        return {'classification':'WAIT_EVIDENCE','action':typ,'reason':'NO_ALLOWLISTED_DISPATCH'}
    return {
        'classification':'DELEGATED_TIMER',
        'action':typ,
        'timer':timer,
        'reason':'EXISTING_NATIVE_WORKER_TIMER_OWNS_EXECUTION',
    }
