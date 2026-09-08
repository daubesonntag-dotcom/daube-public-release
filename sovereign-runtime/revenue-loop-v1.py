#!/usr/bin/env python3
import argparse, datetime, hashlib, json, pathlib, re
MARKET=pathlib.Path('/var/lib/daube/remote-commander/market/opportunities.json')
STATE=pathlib.Path('/var/lib/daube/remote-commander/revenue')

def fit(title):
    low=title.lower(); tags=[k for k in ['automation','ai','python','api','workflow','n8n','rag','crm','agent','integration'] if k in low]
    return {'tags':tags,'fit_score':min(100,40+8*len(tags)),'rationale':'Matches D’AUBE automation/integration delivery lane' if tags else 'Requires manual fit review'}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('payload',nargs='?',default='{}'); a=ap.parse_args()
    if not MARKET.is_file(): raise SystemExit('market snapshot missing')
    snap=json.loads(MARKET.read_text(encoding='utf-8')); items=snap.get('opportunities') or []
    if not items:
        print(json.dumps({'status':'NO_DATA','reason':'no market opportunities'},sort_keys=True)); return
    c=items[0]; f=fit(c.get('title','')); now=datetime.datetime.now(datetime.timezone.utc).isoformat()
    key=hashlib.sha256(c['url'].encode()).hexdigest()[:16]
    proposal=(f"Opportunity: {c.get('title','')}\n\nApproach:\n- Reproduce the requested workflow in an isolated test environment.\n- Implement the smallest complete automation with explicit error handling and audit evidence.\n- Deliver source, setup guide, test evidence, handover checklist, and aftercare notes.\n\nEvidence policy: no unsupported experience claims; platform submission remains gated until account/context requirements are satisfied.\n")
    dossier={'id':key,'created_at':now,'opportunity':c,'fit':f,'state':'PENDING_EXTERNAL_SUBMISSION','proposal_outline':proposal,'market_snapshot_sha256':snap.get('sha256')}
    canonical=json.dumps(dossier,sort_keys=True,separators=(',',':'),ensure_ascii=False); dossier['sha256']=hashlib.sha256(canonical.encode()).hexdigest()
    STATE.mkdir(parents=True,exist_ok=True); (STATE/'dossiers').mkdir(exist_ok=True)
    (STATE/'latest-dossier.json').write_text(json.dumps(dossier,indent=2,ensure_ascii=False),encoding='utf-8')
    (STATE/'dossiers'/f'{key}.json').write_text(json.dumps(dossier,indent=2,ensure_ascii=False),encoding='utf-8')
    print(json.dumps({'status':'PREPARED','state':dossier['state'],'id':key,'title':c.get('title'),'url':c.get('url'),'fit_score':f['fit_score'],'sha256':dossier['sha256']},sort_keys=True,ensure_ascii=False))
if __name__=='__main__': main()
