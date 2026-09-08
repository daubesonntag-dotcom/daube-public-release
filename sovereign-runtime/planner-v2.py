#!/usr/bin/env python3
import argparse, json, pathlib, sqlite3, time, uuid
MARKET=pathlib.Path('/var/lib/daube/remote-commander/market/opportunities.json')

def now(): return time.time()
def jd(v): return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def uid(p): return f'{p}_{uuid.uuid4().hex[:16]}'
def connect(path): db=sqlite3.connect(path,timeout=30,isolation_level=None); db.row_factory=sqlite3.Row; return db

def event(db,eid,name,detail): db.execute("INSERT INTO events(entity_type,entity_id,event,detail,created_at) VALUES('planner',?,?,?,?)",(eid,name,jd(detail),now()))
def recent(db,kind,since): return bool(db.execute("SELECT 1 FROM tasks WHERE kind=? AND created_at>? LIMIT 1",(kind,now()-since)).fetchone())
def enqueue(db,kind,payload,oid,pri,cap):
    tid=uid('task'); t=now(); db.execute("INSERT INTO tasks(id,objective_id,kind,payload,priority,state,attempts,max_attempts,not_before,capability,risk,cost_ceiling,founder_gate,created_at,updated_at) VALUES(?,?,?,?,?,'QUEUED',0,3,0,?,'low',0,0,?,?)",(tid,oid,kind,jd(payload),pri,cap,t,t)); event(db,tid,'PLANNED',{'kind':kind,'objective':oid,'capability':cap}); return tid

def tick(db):
    planned=[]; gaps=[]; caps={}
    for r in db.execute("SELECT kind,id,enabled,last_health,priority FROM capabilities WHERE enabled=1 ORDER BY priority DESC"):
        caps.setdefault(r['kind'],r)
    for o in db.execute("SELECT * FROM objectives WHERE state='ACTIVE' ORDER BY priority DESC,created_at"):
        title=o['title'].lower(); oid=o['id']; pri=o['priority']
        if 'runtime' in title:
            if 'host' in caps and not recent(db,'host',3600): planned.append(enqueue(db,'host',{'op':'inventory','reason':'planner-v2-hourly-health'},oid,pri,'host'))
            elif 'host' not in caps: gaps.append({'objective':oid,'missing':'host'})
        if 'railcall' in title:
            rc=caps.get('railcall')
            if rc and rc['last_health']=='HEALTHY' and not recent(db,'railcall',21600): planned.append(enqueue(db,'railcall',{'op':'version','reason':'planner-v2-readiness'},oid,pri,'railcall'))
            elif not rc or rc['last_health']!='HEALTHY': gaps.append({'objective':oid,'missing':'railcall.ready','reason':'RailCall native executor not healthy yet'})
        if 'revenue' in title:
            if 'market.discovery' in caps:
                if not recent(db,'market.discovery',3600): planned.append(enqueue(db,'market.discovery',{'op':'discover','reason':'planner-v2-revenue-scout'},oid,pri,'market.discovery'))
            else: gaps.append({'objective':oid,'missing':'market.discovery','reason':'persistent market scout not registered'})
            if 'revenue' in caps and MARKET.is_file() and not recent(db,'revenue',3600): planned.append(enqueue(db,'revenue',{'op':'prepare_top','reason':'planner-v2-revenue-prep'},oid,max(1,pri-1),'revenue'))
            elif 'revenue' not in caps: gaps.append({'objective':oid,'missing':'revenue','reason':'revenue preparation executor not registered'})
        if 'capability acquisition' in title:
            for need in ['market.discovery','revenue']:
                if need not in caps: gaps.append({'objective':oid,'missing':need})
        if 'evidence' in title and 'host' in caps and not recent(db,'host',21600): planned.append(enqueue(db,'host',{'op':'service_status','reason':'planner-v2-evidence-assurance'},oid,pri,'host'))
    for g in gaps: event(db,g['objective'],'CAPABILITY_GAP',g)
    return {'planned':planned,'gaps':gaps,'ts':now()}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--db',required=True); ap.add_argument('--forever',action='store_true'); ap.add_argument('--sleep',type=float,default=60); a=ap.parse_args(); db=connect(a.db)
    if a.forever:
        while True:
            try: print(jd(tick(db)),flush=True)
            except Exception as e: print(jd({'planner_error':str(e)}),flush=True)
            time.sleep(max(10,a.sleep))
    else: print(jd(tick(db)))
if __name__=='__main__': main()
