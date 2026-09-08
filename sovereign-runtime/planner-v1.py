#!/usr/bin/env python3
import argparse, json, sqlite3, time, uuid
from pathlib import Path

def now(): return time.time()
def jd(v): return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def uid(p): return f'{p}_{uuid.uuid4().hex[:16]}'
def connect(path):
    db=sqlite3.connect(path,timeout=30,isolation_level=None); db.row_factory=sqlite3.Row; return db

def event(db,eid,name,detail):
    db.execute("INSERT INTO events(entity_type,entity_id,event,detail,created_at) VALUES('planner',?,?,?,?)",(eid,name,jd(detail),now()))

def recent_task(db,kind,since=86400):
    r=db.execute("SELECT 1 FROM tasks WHERE kind=? AND created_at>? LIMIT 1",(kind,now()-since)).fetchone(); return bool(r)

def enqueue(db,kind,payload,objective_id,priority,capability):
    tid=uid('task'); t=now()
    db.execute("INSERT INTO tasks(id,objective_id,kind,payload,priority,state,attempts,max_attempts,not_before,capability,risk,cost_ceiling,founder_gate,created_at,updated_at) VALUES(?,?,?,?,?,'QUEUED',0,3,0,?,'low',0,0,?,?)",(tid,objective_id,kind,jd(payload),priority,capability,t,t))
    event(db,tid,'PLANNED',{'kind':kind,'objective':objective_id,'capability':capability}); return tid

def tick(db):
    planned=[]; gaps=[]
    caps={r['kind']:r for r in db.execute("SELECT kind,id,enabled,last_health FROM capabilities WHERE enabled=1 ORDER BY priority DESC")}
    for o in db.execute("SELECT * FROM objectives WHERE state='ACTIVE' ORDER BY priority DESC,created_at"):
        title=o['title'].lower(); oid=o['id']; pri=o['priority']
        if 'sovereign runtime' in title or 'runtime' in title:
            if 'host' in caps and not recent_task(db,'host',3600): planned.append(enqueue(db,'host',{'op':'inventory','reason':'planner-hourly-health'},oid,pri,'host'))
            elif 'host' not in caps: gaps.append({'objective':oid,'missing':'host'})
        elif 'railcall' in title:
            if 'railcall' in caps and not recent_task(db,'railcall',21600): planned.append(enqueue(db,'railcall',{'op':'version','reason':'planner-readiness'},oid,pri,'railcall'))
            elif 'railcall' not in caps: gaps.append({'objective':oid,'missing':'railcall'})
        elif 'revenue' in title:
            if 'market.discovery' not in caps:
                gaps.append({'objective':oid,'missing':'market.discovery','reason':'no approved zero-cost market discovery executor registered'})
    for g in gaps: event(db,g['objective'],'CAPABILITY_GAP',g)
    return {'planned':planned,'gaps':gaps,'ts':now()}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--db',required=True); ap.add_argument('--forever',action='store_true'); ap.add_argument('--sleep',type=float,default=60); a=ap.parse_args()
    Path(a.db).parent.mkdir(parents=True,exist_ok=True); db=connect(a.db)
    if a.forever:
        while True:
            try: print(jd(tick(db)),flush=True)
            except Exception as e: print(jd({'planner_error':str(e)}),flush=True)
            time.sleep(max(10,a.sleep))
    else: print(jd(tick(db)))
if __name__=='__main__': main()
