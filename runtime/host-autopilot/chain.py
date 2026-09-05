import re
from manifest import validate_manifest

CHAIN_SHA40=re.compile(r'^[0-9a-f]{40}$')

def phase_to_manifest(phase):
    return {
        'schema':'daube.host-autopilot.v1','enabled':True,
        'target_revision':phase.get('target_revision'),'release_id':phase.get('release_id'),
        'artifacts':phase.get('artifacts'),'checks':phase.get('checks',[]),
        'activation':phase.get('activation'),'health_units':phase.get('health_units',[]),
        'rollback':'required',
    }

def validate_chain(data):
    if data.get('schema')!='daube.native-release-chain.v1': return False,'SCHEMA'
    if not isinstance(data.get('enabled'),bool): return False,'ENABLED'
    if not isinstance(data.get('chain_id'),str) or not data['chain_id']: return False,'CHAIN_ID'
    if data.get('rollback_policy')!='phase-local-required': return False,'ROLLBACK_POLICY'
    phases=data.get('phases')
    if not isinstance(phases,list) or not phases: return False,'PHASES'
    ids=set(); releases=set()
    for i,p in enumerate(phases):
        if not isinstance(p,dict): return False,'PHASE'
        pid=p.get('phase_id'); rid=p.get('release_id')
        if not isinstance(pid,str) or not pid or pid in ids: return False,'PHASE_ID'
        if not isinstance(rid,str) or not rid or rid in releases: return False,'RELEASE_ID'
        ids.add(pid); releases.add(rid)
        if not CHAIN_SHA40.fullmatch(str(p.get('target_revision',''))): return False,'REVISION'
        dep=p.get('depends_on')
        if dep is not None and (not isinstance(dep,str) or not dep): return False,'DEPENDS_ON'
        ok,reason=validate_manifest(phase_to_manifest(p))
        if not ok:return False,f'PHASE_{pid}:{reason}'
        if p.get('success_receipt')!='APPLIED': return False,'SUCCESS_RECEIPT'
        if dep is not None:
            prior={x.get('phase_id') for x in phases[:i] if isinstance(x,dict)}
            if dep not in prior:return False,'DEPENDENCY_ORDER'
    return True,'OK'

def receipt_matches(receipt,phase):
    if not isinstance(receipt,dict): return False
    state=receipt.get('state') or receipt.get('classification')
    return state=='APPLIED' and receipt.get('release_id')==phase.get('release_id') and receipt.get('target_revision')==phase.get('target_revision')

def select_phase(chain,receipt_loader,hold_state=None):
    ok,reason=validate_chain(chain)
    if not ok:return {'classification':'HOLD_FOUNDER_GATE','reason':reason}
    if not chain['enabled']:return {'classification':'DISABLED'}
    if hold_state and hold_state.get('classification')=='HOLD_FOUNDER_GATE':
        return {'classification':'HOLD_FOUNDER_GATE','reason':'PRIOR_HOLD'}
    phases_by_id={p['phase_id']:p for p in chain['phases']}
    for phase in chain['phases']:
        own=receipt_loader(phase)
        if receipt_matches(own,phase): continue
        dep=phase.get('depends_on')
        if dep:
            predecessor=phases_by_id[dep]; receipt=receipt_loader(predecessor)
            state=(receipt or {}).get('state') or (receipt or {}).get('classification')
            if state in {'ROLLED_BACK','HOLD_FOUNDER_GATE'}:
                return {'classification':'HOLD_FOUNDER_GATE','phase_id':phase['phase_id'],'reason':f'PREDECESSOR_{state}'}
            if not receipt_matches(receipt,predecessor):
                return {'classification':'WAITING_PREDECESSOR','phase_id':phase['phase_id'],'depends_on':dep}
        return {'classification':'READY','phase':phase}
    return {'classification':'NOOP'}
