import re, subprocess
from pathlib import Path
SECRET_PATTERNS=[re.compile(r'(?i)(token|secret|password|api[_-]?key)=([^\s]+)')]
def redact_text(text):
    out=str(text)
    for p in SECRET_PATTERNS: out=p.sub(lambda m:f'{m.group(1)}=[REDACTED]',out)
    return out[-4000:]
def default_runner(argv,cwd,timeout):
    r=subprocess.run(argv,cwd=cwd,text=True,capture_output=True,timeout=timeout,shell=False)
    return r.returncode,r.stdout,r.stderr
def run_checks(stage_dir,check_list,runner=default_runner,timeout=300):
    rows=[]
    for argv in check_list:
        try: code,out,err=runner(argv,Path(stage_dir),timeout)
        except subprocess.TimeoutExpired:
            rows.append({'argv':argv,'exit_code':124,'classification':'TIMEOUT'}); continue
        rows.append({'argv':argv,'exit_code':code,'stdout':redact_text(out),'stderr':redact_text(err),'classification':'PASS' if code==0 else 'FAIL'})
    return {'green':bool(rows) and all(r['exit_code']==0 for r in rows),'checks':rows}
