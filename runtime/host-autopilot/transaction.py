from dataclasses import dataclass
from pathlib import Path
from models import atomic_json, now

@dataclass
class Paths:
    root: Path
    def __post_init__(self): self.root=Path(self.root); self.root.mkdir(parents=True,exist_ok=True)
    @property
    def disabled(self): return self.root/'DISABLED'
    @property
    def tx(self): return self.root/'state'/'transaction.json'

def run_transaction(manifest,paths,adapters):
    if paths.disabled.exists(): return {'state':'DISABLED'}
    state={'state':'DISCOVERED','release_id':manifest['release_id'],'target_revision':manifest['target_revision'],'at':now()}; atomic_json(paths.tx,state)
    try:
        if adapters['stage'](manifest).get('classification')!='PASS': raise RuntimeError('STAGE_FAILED')
        state['state']='STAGED'; atomic_json(paths.tx,state)
        if not adapters['checks'](manifest).get('green'): raise RuntimeError('CHECKS_FAILED')
        state['state']='VERIFIED'; atomic_json(paths.tx,state)
        snap=adapters['snapshot'](manifest); state['state']='SNAPSHOTTED'; state['snapshot']=str(snap); atomic_json(paths.tx,state)
        state['state']='ACTIVATING'; atomic_json(paths.tx,state)
        if adapters['activate'](manifest)!=0: raise RuntimeError('ACTIVATION_FAILED')
        state['state']='HEALTH_CHECK'; atomic_json(paths.tx,state)
        if not adapters['health'](manifest.get('health_units',[])): raise RuntimeError('HEALTH_FAILED')
        state['state']='APPLIED'; atomic_json(paths.tx,state); return state
    except Exception as exc:
        state['state']='FAILED'; state['reason']=str(exc); atomic_json(paths.tx,state)
        snap=state.get('snapshot')
        if snap is None: return state
        state['state']='ROLLING_BACK'; atomic_json(paths.tx,state)
        if adapters['rollback'](snap): state['state']='ROLLED_BACK'
        else: state['state']='HOLD_FOUNDER_GATE'
        atomic_json(paths.tx,state); return state
