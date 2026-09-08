#!/usr/bin/env python3
"""D’AUBE Sovereign Runtime — host-native control and execution plane.

No cloud runner required. Python stdlib only. SQLite/WAL is the durable default;
executors are replaceable capabilities selected by health, policy and priority.
"""
from __future__ import annotations
import argparse, hashlib, json, os, shlex, sqlite3, subprocess, time, uuid
from pathlib import Path
from typing import Any

DB_DEFAULT = os.getenv("DAUBE_RUNTIME_DB", "/var/lib/daube/runtime.db")

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS objectives(
 id TEXT PRIMARY KEY, title TEXT NOT NULL, intent TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 50,
 state TEXT NOT NULL DEFAULT 'ACTIVE', created_at REAL NOT NULL, updated_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS tasks(
 id TEXT PRIMARY KEY, objective_id TEXT, kind TEXT NOT NULL, payload TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 50,
 state TEXT NOT NULL DEFAULT 'QUEUED', attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
 not_before REAL NOT NULL DEFAULT 0, capability TEXT, risk TEXT NOT NULL DEFAULT 'low', cost_ceiling REAL NOT NULL DEFAULT 0,
 founder_gate INTEGER NOT NULL DEFAULT 0, claimed_by TEXT, created_at REAL NOT NULL, updated_at REAL NOT NULL,
 FOREIGN KEY(objective_id) REFERENCES objectives(id));
CREATE INDEX IF NOT EXISTS idx_tasks_queue ON tasks(state,not_before,priority DESC,created_at);
CREATE TABLE IF NOT EXISTS capabilities(
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, command TEXT NOT NULL, health_command TEXT, priority INTEGER NOT NULL DEFAULT 50,
 enabled INTEGER NOT NULL DEFAULT 1, last_health TEXT NOT NULL DEFAULT 'UNKNOWN', last_seen REAL, metadata TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS evidence(
 id TEXT PRIMARY KEY, task_id TEXT, status TEXT NOT NULL, executor TEXT, sha256 TEXT, detail TEXT NOT NULL,
 created_at REAL NOT NULL, FOREIGN KEY(task_id) REFERENCES tasks(id));
CREATE TABLE IF NOT EXISTS events(
 seq INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, event TEXT NOT NULL,
 detail TEXT NOT NULL DEFAULT '{}', created_at REAL NOT NULL);
"""

def now() -> float: return time.time()
def uid(prefix: str) -> str: return f"{prefix}_{uuid.uuid4().hex[:16]}"
def jdump(v: Any) -> str: return json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
def connect(path: str) -> sqlite3.Connection:
    p=Path(path); p.parent.mkdir(parents=True, exist_ok=True)
    db=sqlite3.connect(path, timeout=30, isolation_level=None); db.row_factory=sqlite3.Row
    db.executescript(SCHEMA); return db

def event(db, typ, eid, name, detail=None):
    db.execute("INSERT INTO events(entity_type,entity_id,event,detail,created_at) VALUES(?,?,?,?,?)", (typ,eid,name,jdump(detail or {}),now()))

def add_objective(db,title,intent,priority=50):
    oid=uid("obj"); t=now()
    db.execute("INSERT INTO objectives VALUES(?,?,?,?,?,?,?)",(oid,title,intent,priority,"ACTIVE",t,t))
    event(db,"objective",oid,"CREATED",{"title":title,"priority":priority}); return oid

def enqueue(db,kind,payload,objective_id=None,priority=50,capability=None,risk="low",cost_ceiling=0,founder_gate=False,max_attempts=3):
    tid=uid("task"); t=now()
    db.execute("INSERT INTO tasks(id,objective_id,kind,payload,priority,state,attempts,max_attempts,not_before,capability,risk,cost_ceiling,founder_gate,created_at,updated_at) VALUES(?,?,?,?,?,'QUEUED',0,?,0,?,?,?,?,?,?)", (tid,objective_id,kind,jdump(payload),priority,max_attempts,capability,risk,float(cost_ceiling),int(founder_gate),t,t))
    event(db,"task",tid,"QUEUED",{"kind":kind,"capability":capability}); return tid

def register_capability(db,cid,kind,command,health_command=None,priority=50,metadata=None):
    db.execute("INSERT INTO capabilities(id,kind,command,health_command,priority,enabled,metadata) VALUES(?,?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,command=excluded.command,health_command=excluded.health_command,priority=excluded.priority,enabled=1,metadata=excluded.metadata", (cid,kind,command,health_command,priority,jdump(metadata or {})))
    event(db,"capability",cid,"REGISTERED",{"kind":kind})

def health(db):
    rows=db.execute("SELECT * FROM capabilities WHERE enabled=1 ORDER BY priority DESC").fetchall(); out=[]
    for r in rows:
        status="HEALTHY"
        if r["health_command"]:
            try:
                cp=subprocess.run(r["health_command"],shell=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
                status="HEALTHY" if cp.returncode==0 else "UNHEALTHY"
            except Exception: status="UNHEALTHY"
        db.execute("UPDATE capabilities SET last_health=?,last_seen=? WHERE id=?",(status,now(),r["id"]))
        out.append({"id":r["id"],"kind":r["kind"],"health":status})
    return out

def choose_executor(db,task):
    wanted=task["capability"] or task["kind"]
    rows=db.execute("SELECT * FROM capabilities WHERE enabled=1 AND kind=? ORDER BY CASE last_health WHEN 'HEALTHY' THEN 0 WHEN 'UNKNOWN' THEN 1 ELSE 2 END, priority DESC",(wanted,)).fetchall()
    for r in rows:
        if r["last_health"] != "UNHEALTHY": return r
    return None

def policy(task):
    if task["founder_gate"]: return False,"FOUNDER_APPROVAL_REQUIRED"
    if task["cost_ceiling"] < 0: return False,"INVALID_COST_POLICY"
    if task["risk"] not in ("low","medium","high"): return False,"INVALID_RISK"
    if task["risk"]=="high" and not task["capability"]: return False,"HIGH_RISK_CAPABILITY_REQUIRED"
    return True,"ALLOW"

def claim(db,worker):
    db.execute("BEGIN IMMEDIATE")
    try:
        row=db.execute("SELECT * FROM tasks WHERE state='QUEUED' AND not_before<=? ORDER BY priority DESC,created_at LIMIT 1",(now(),)).fetchone()
        if not row: db.execute("COMMIT"); return None
        ok,reason=policy(row); state="RUNNING" if ok else "BLOCKED"
        db.execute("UPDATE tasks SET state=?,claimed_by=?,updated_at=? WHERE id=?",(state,worker,now(),row["id"]))
        event(db,"task",row["id"],state,{"worker":worker,"policy":reason}); db.execute("COMMIT")
        return db.execute("SELECT * FROM tasks WHERE id=?",(row["id"],)).fetchone() if ok else None
    except Exception:
        db.execute("ROLLBACK"); raise

def record_evidence(db,task_id,status,executor,detail):
    canonical=jdump(detail); sha=hashlib.sha256(canonical.encode()).hexdigest(); eid=uid("ev")
    db.execute("INSERT INTO evidence VALUES(?,?,?,?,?,?,?)",(eid,task_id,status,executor,sha,canonical,now()))
    event(db,"task",task_id,"EVIDENCE",{"status":status,"sha256":sha}); return eid,sha

def execute(db,task,executor):
    payload=json.loads(task["payload"]); envelope=jdump({"task_id":task["id"],"kind":task["kind"],"payload":payload})
    cmd=executor["command"].replace("{payload}",shlex.quote(envelope)); started=now()
    try:
        cp=subprocess.run(cmd,shell=True,text=True,capture_output=True,timeout=300)
        detail={"rc":cp.returncode,"stdout":cp.stdout[-12000:],"stderr":cp.stderr[-12000:],"duration_s":round(now()-started,3)}
        status="VERIFIED" if cp.returncode==0 else "FAILED"
    except subprocess.TimeoutExpired as e:
        detail={"rc":124,"stdout":(e.stdout or "")[-12000:] if isinstance(e.stdout,str) else "","stderr":"timeout","duration_s":round(now()-started,3)}; status="FAILED"
    record_evidence(db,task["id"],status,executor["id"],detail)
    if status=="VERIFIED":
        db.execute("UPDATE tasks SET state='DONE_VERIFIED',updated_at=? WHERE id=?",(now(),task["id"])); event(db,"task",task["id"],"DONE_VERIFIED",{})
    else:
        attempts=task["attempts"]+1
        if attempts < task["max_attempts"]:
            delay=min(300,2**attempts*5)
            db.execute("UPDATE tasks SET state='QUEUED',attempts=?,not_before=?,claimed_by=NULL,updated_at=? WHERE id=?",(attempts,now()+delay,now(),task["id"])); event(db,"task",task["id"],"RETRY",{"attempt":attempts,"delay":delay})
        else:
            db.execute("UPDATE tasks SET state='DEAD_LETTER',attempts=?,updated_at=? WHERE id=?",(attempts,now(),task["id"])); event(db,"task",task["id"],"DEAD_LETTER",{})

def work_once(db,worker):
    health(db); task=claim(db,worker)
    if not task: return False
    ex=choose_executor(db,task)
    if not ex:
        record_evidence(db,task["id"],"UNVERIFIED",None,{"reason":"NO_HEALTHY_EXECUTOR"})
        db.execute("UPDATE tasks SET state='QUEUED',not_before=?,claimed_by=NULL,updated_at=? WHERE id=?",(now()+30,now(),task["id"])); return True
    execute(db,task,ex); return True

def status(db):
    return {"objectives":{r["state"]:r["n"] for r in db.execute("SELECT state,count(*) n FROM objectives GROUP BY state")},"tasks":{r["state"]:r["n"] for r in db.execute("SELECT state,count(*) n FROM tasks GROUP BY state")},"capabilities":[dict(r) for r in db.execute("SELECT id,kind,enabled,last_health,last_seen,priority FROM capabilities ORDER BY kind,priority DESC")],"latest_evidence":[dict(r) for r in db.execute("SELECT task_id,status,executor,sha256,created_at FROM evidence ORDER BY created_at DESC LIMIT 10")]}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--db",default=DB_DEFAULT); sp=ap.add_subparsers(dest="cmd",required=True)
    sp.add_parser("init"); a=sp.add_parser("objective"); a.add_argument("title"); a.add_argument("intent"); a.add_argument("--priority",type=int,default=50)
    a=sp.add_parser("capability"); a.add_argument("id"); a.add_argument("kind"); a.add_argument("command"); a.add_argument("--health"); a.add_argument("--priority",type=int,default=50)
    a=sp.add_parser("enqueue"); a.add_argument("kind"); a.add_argument("payload"); a.add_argument("--objective"); a.add_argument("--capability"); a.add_argument("--priority",type=int,default=50); a.add_argument("--risk",default="low"); a.add_argument("--cost-ceiling",type=float,default=0); a.add_argument("--founder-gate",action="store_true")
    a=sp.add_parser("work"); a.add_argument("--worker",default=os.uname().nodename); a.add_argument("--forever",action="store_true"); a.add_argument("--sleep",type=float,default=2)
    sp.add_parser("health"); sp.add_parser("status")
    x=ap.parse_args(); db=connect(x.db)
    if x.cmd=="init": print(jdump({"ok":True,"db":x.db}))
    elif x.cmd=="objective": print(add_objective(db,x.title,x.intent,x.priority))
    elif x.cmd=="capability": register_capability(db,x.id,x.kind,x.command,x.health,x.priority); print(x.id)
    elif x.cmd=="enqueue": print(enqueue(db,x.kind,json.loads(x.payload),x.objective,x.priority,x.capability,x.risk,x.cost_ceiling,x.founder_gate))
    elif x.cmd=="health": print(json.dumps(health(db),indent=2))
    elif x.cmd=="status": print(json.dumps(status(db),indent=2,default=str))
    elif x.cmd=="work":
        if x.forever:
            while True:
                if not work_once(db,x.worker): time.sleep(x.sleep)
        else: print(jdump({"worked":work_once(db,x.worker)}))

if __name__=="__main__": main()
