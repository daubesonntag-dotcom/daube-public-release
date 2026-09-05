import fcntl, json, os
from pathlib import Path
from crm import merge_client_records
from dispatch import dispatch_action
from evidence import collect_business_evidence, revenue_truth
from learning import outcomes_from_evidence, summarize_conversion
from models import atomic_json, load_json, now, scrub
from priority import build_queue

class BusinessOperator:
    def __init__(self, home: Path, runner=None):
        self.home=Path(home)
        self.base=self.home/'daube-revenue-worker'/'business-v11'
        self.base.mkdir(parents=True,exist_ok=True)
        self.runner=runner

    def _lock(self):
        f=(self.base/'business.lock').open('a+')
        fcntl.flock(f.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        return f

    def run_once(self):
        try: lock=self._lock()
        except BlockingIOError:
            result={'version':'business-operator-v11','at':now(),'classification':'BUSY_SINGLE_WRITER'}
            atomic_json(self.base/'last-run.json',result); return result
        try:
            evidence=collect_business_evidence(self.home)
            existing=load_json(self.base/'crm.json',{})
            crm=merge_client_records(existing,evidence)
            queue=build_queue(evidence,crm)
            conversion=summarize_conversion(outcomes_from_evidence(evidence))
            dispatch=None
            if queue:
                action=queue[0]
                dispatch=dispatch_action(action,self.runner) if self.runner else dispatch_action(action)
            tower={
                'version':'business-operator-v11','at':now(),'classification':'BUSINESS_OPERATOR_READY',
                'revenue_truth':revenue_truth(evidence),'queue_depth':len(queue),
                'top_action':queue[0] if queue else None,'conversion':conversion,
                'founder_gate':bool(queue and queue[0].get('type')=='FOUNDER_GATE'),
                'dispatch':dispatch,
            }
            atomic_json(self.base/'crm.json',scrub(crm))
            atomic_json(self.base/'daily-queue.json',scrub(queue))
            atomic_json(self.base/'conversion.json',conversion)
            atomic_json(self.base/'control-tower.json',scrub(tower))
            atomic_json(self.base/'BUSINESS_OPERATOR_READY.json',scrub(tower))
            return tower
        finally:
            lock.close()
