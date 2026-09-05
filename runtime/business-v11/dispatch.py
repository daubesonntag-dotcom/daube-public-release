import subprocess
from priority import RISKY_ACTIONS

SERVICE_BY_ACTION={
    'SCOUT':'daube-revenue-worker.service',
    'FOLLOW_CLIENT':'daube-native-revenue-autopilot.service',
    'AWARD_WATCH':'daube-freelancer-award-watcher.service',
    'EXECUTE_JOB':'daube-freelancer-executor.service',
    'RUN_QA':'daube-freelancer-executor.service',
    'DELIVER':'daube-freelancer-money-closure.service',
    'REQUEST_RELEASE':'daube-freelancer-money-closure.service',
    'WAIT_SETTLEMENT':'daube-freelancer-money-closure.service',
}


def default_runner(argv):
    return subprocess.run(argv,text=True,capture_output=True,timeout=60)


def dispatch_action(action: dict, runner=default_runner) -> dict:
    typ=action.get('type')
    if typ=='FOUNDER_GATE' or typ in RISKY_ACTIONS:
        return {'classification':'FOUNDER_GATE','action':typ,'reason':action.get('reason') or 'PROHIBITED_AUTHORITY'}
    unit=SERVICE_BY_ACTION.get(typ)
    if not unit:
        return {'classification':'WAIT_EVIDENCE','action':typ,'reason':'NO_ALLOWLISTED_DISPATCH'}
    r=runner(['sudo','systemctl','start','--no-block',unit])
    return {'classification':'DISPATCHED' if getattr(r,'returncode',1)==0 else 'DISPATCH_FAILED','action':typ,'unit':unit,'exit_code':getattr(r,'returncode',1)}
