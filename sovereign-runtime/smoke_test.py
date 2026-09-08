#!/usr/bin/env python3
import json, subprocess, sys, tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parent
R=ROOT/'runtime.py'
with tempfile.TemporaryDirectory() as td:
    db=str(Path(td)/'runtime.db')
    def run(*args):
        return subprocess.check_output([sys.executable,str(R),'--db',db,*args],text=True).strip()
    run('init')
    oid=run('objective','Smoke objective','Verify durable queue/router/evidence','--priority','90')
    run('capability','smoke.echo','smoke','python3 -c "import sys,json; print(json.loads(sys.argv[1])[\'payload\'][\'message\'])" {payload}','--health','python3 --version','--priority','100')
    tid=run('enqueue','smoke',json.dumps({'message':'DAUBE_OK'}),'--objective',oid,'--capability','smoke')
    worked=json.loads(run('work'))
    assert worked['worked'] is True
    s=json.loads(run('status'))
    assert s['tasks'].get('DONE_VERIFIED') == 1, s
    assert s['latest_evidence'][0]['status'] == 'VERIFIED', s
    assert s['capabilities'][0]['last_health'] == 'HEALTHY', s
    print(json.dumps({'result':'PASS','objective':oid,'task':tid,'evidence':s['latest_evidence'][0]['sha256']},indent=2))
