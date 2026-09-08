#!/usr/bin/env bash
set -euo pipefail

: "${DAUBE_RC_SUPABASE_URL:?DAUBE_RC_SUPABASE_URL is required}"
: "${DAUBE_RC_APIKEY:?DAUBE_RC_APIKEY is required}"
: "${DAUBE_RC_TOKEN:?DAUBE_RC_TOKEN is required}"
DAUBE_RC_DEVICE="${DAUBE_RC_DEVICE:-daube-host-01}"
DAUBE_USER="${DAUBE_RC_USER:-daube}"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run via sudo env ... bash" >&2
  exit 2
fi
command -v python3 >/dev/null 2>&1 || { echo "python3 is required" >&2; exit 3; }
command -v systemctl >/dev/null 2>&1 || { echo "systemd is required" >&2; exit 4; }

if ! id "$DAUBE_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "$DAUBE_USER"
fi

install -d -o root -g "$DAUBE_USER" -m 0750 /etc/daube
install -d -o "$DAUBE_USER" -g "$DAUBE_USER" -m 0750 /opt/daube/remote-commander
install -d -o "$DAUBE_USER" -g "$DAUBE_USER" -m 0750 /var/lib/daube/remote-commander

umask 027
printf '%s\n' "$DAUBE_RC_TOKEN" > /etc/daube/remote-commander.token
chown root:"$DAUBE_USER" /etc/daube/remote-commander.token
chmod 0640 /etc/daube/remote-commander.token

cat > /etc/daube/remote-commander.env <<EOF
DAUBE_RC_SUPABASE_URL=$DAUBE_RC_SUPABASE_URL
DAUBE_RC_APIKEY=$DAUBE_RC_APIKEY
DAUBE_RC_TOKEN_FILE=/etc/daube/remote-commander.token
DAUBE_RC_DEVICE=$DAUBE_RC_DEVICE
EOF
chown root:"$DAUBE_USER" /etc/daube/remote-commander.env
chmod 0640 /etc/daube/remote-commander.env

cat > /opt/daube/remote-commander/agent.py <<'PY'
#!/usr/bin/env python3
import argparse, hashlib, json, os, pathlib, subprocess, time, urllib.request
VERSION = "0.2.0"

def jreq(url, method="POST", api_key=None, device=None, device_token=None, body=None, timeout=30):
    data = None if body is None else json.dumps(body,separators=(",",":"),ensure_ascii=False).encode()
    headers={"Accept":"application/json","User-Agent":f"daube-host-agent/{VERSION}"}
    if api_key:
        headers["apikey"]=api_key; headers["Authorization"]=f"Bearer {api_key}"
    if device: headers["x-daube-device"]=device
    if device_token: headers["x-daube-token"]=device_token
    if data is not None: headers["Content-Type"]="application/json"
    req=urllib.request.Request(url,data=data,headers=headers,method=method)
    with urllib.request.urlopen(req,timeout=timeout) as r:
        raw=r.read(); return json.loads(raw.decode()) if raw else {}

def allowed_cwd(cwd,roots):
    p=pathlib.Path(cwd).resolve()
    return any(p==r or r in p.parents for r in roots)

def run_job(job,roots):
    jid=str(job["id"]); argv=job.get("argv"); cwd=job.get("cwd") or str(roots[0]); timeout=int(job.get("timeout",120))
    if not isinstance(argv,list) or not argv or not all(isinstance(x,str) for x in argv):
        payload={"id":jid,"status":"REJECTED","error":"argv must be a non-empty string array"}
    elif timeout < 1 or timeout > 1800:
        payload={"id":jid,"status":"REJECTED","error":"timeout must be 1..1800 seconds"}
    elif not allowed_cwd(cwd,roots):
        payload={"id":jid,"status":"REJECTED","error":"cwd outside allowed roots"}
    else:
        start=time.time()
        try:
            p=subprocess.run(argv,cwd=cwd,text=True,capture_output=True,timeout=timeout,env=os.environ.copy(),shell=False)
            payload={"id":jid,"status":"SUCCEEDED" if p.returncode==0 else "FAILED","returncode":p.returncode,"stdout":p.stdout[-200000:],"stderr":p.stderr[-200000:],"duration_ms":int((time.time()-start)*1000),"agent_version":VERSION}
        except subprocess.TimeoutExpired as e:
            payload={"id":jid,"status":"TIMEOUT","returncode":None,"stdout":(e.stdout or "")[-200000:] if isinstance(e.stdout,str) else "","stderr":(e.stderr or "")[-200000:] if isinstance(e.stderr,str) else "","duration_ms":int((time.time()-start)*1000),"agent_version":VERSION}
    canonical=json.dumps(payload,sort_keys=True,separators=(",",":"),ensure_ascii=False)
    return canonical, hashlib.sha256(canonical.encode()).hexdigest()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--supabase-url",default=os.environ.get("DAUBE_RC_SUPABASE_URL"))
    ap.add_argument("--api-key",default=os.environ.get("DAUBE_RC_APIKEY"))
    ap.add_argument("--token-file",default=os.environ.get("DAUBE_RC_TOKEN_FILE","/etc/daube/remote-commander.token"))
    ap.add_argument("--device",default=os.environ.get("DAUBE_RC_DEVICE",os.uname().nodename))
    ap.add_argument("--root",action="append",default=[])
    ap.add_argument("--poll",type=float,default=3.0)
    a=ap.parse_args()
    if not a.supabase_url or not a.api_key: raise SystemExit("missing Supabase config")
    token=pathlib.Path(a.token_file).read_text().strip()
    if len(token)<32: raise SystemExit("device token missing/too short")
    roots=[pathlib.Path(x).resolve() for x in (a.root or ["/opt/daube","/var/lib/daube"])]
    rpc=a.supabase_url.rstrip("/")+"/rest/v1/rpc/"; backoff=2
    while True:
        try:
            jreq(rpc+"daube_remote_heartbeat",api_key=a.api_key,device=a.device,device_token=token,body={"p_device_id":a.device,"p_version":VERSION,"p_roots":[str(r) for r in roots]},timeout=20)
            job=jreq(rpc+"daube_remote_claim",api_key=a.api_key,device=a.device,device_token=token,body={"p_device_id":a.device},timeout=35)
            if isinstance(job,dict) and job.get("id"):
                canonical,sha=run_job(job,roots)
                jreq(rpc+"daube_remote_submit_result",api_key=a.api_key,device=a.device,device_token=token,body={"p_device_id":a.device,"p_job_id":job["id"],"p_result_text":canonical,"p_sha256":sha},timeout=30)
            backoff=2; time.sleep(a.poll)
        except KeyboardInterrupt: return
        except Exception as e:
            print(json.dumps({"event":"transport_error","error":str(e),"backoff":backoff}),flush=True)
            time.sleep(backoff); backoff=min(backoff*2,60)
if __name__=="__main__": main()
PY
chmod 0755 /opt/daube/remote-commander/agent.py
chown root:root /opt/daube/remote-commander/agent.py

cat > /opt/daube/remote-commander/status.sh <<'SH'
#!/usr/bin/env bash
set -euo pipefail
systemctl is-enabled daube-remote-agent.service
systemctl is-active daube-remote-agent.service
systemctl is-enabled daube-remote-watchdog.timer
systemctl is-active daube-remote-watchdog.timer
journalctl -u daube-remote-agent.service -n 25 --no-pager
SH

cat > /opt/daube/remote-commander/repair.sh <<'SH'
#!/usr/bin/env bash
set -euo pipefail
systemctl daemon-reload
systemctl enable daube-remote-agent.service daube-remote-watchdog.timer >/dev/null
systemctl restart daube-remote-agent.service
systemctl restart daube-remote-watchdog.timer
sleep 2
systemctl is-active --quiet daube-remote-agent.service
systemctl is-active --quiet daube-remote-watchdog.timer
SH

cat > /opt/daube/remote-commander/uninstall.sh <<'SH'
#!/usr/bin/env bash
set -euo pipefail
systemctl disable --now daube-remote-watchdog.timer daube-remote-agent.service 2>/dev/null || true
rm -f /etc/systemd/system/daube-remote-watchdog.timer /etc/systemd/system/daube-remote-watchdog.service /etc/systemd/system/daube-remote-agent.service
systemctl daemon-reload
rm -rf /opt/daube/remote-commander /var/lib/daube/remote-commander
rm -f /etc/daube/remote-commander.env /etc/daube/remote-commander.token
SH
chmod 0755 /opt/daube/remote-commander/{status,repair,uninstall}.sh

cat > /etc/systemd/system/daube-remote-agent.service <<EOF
[Unit]
Description=D'AUBE Remote Commander Host Agent
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=$DAUBE_USER
Group=$DAUBE_USER
EnvironmentFile=/etc/daube/remote-commander.env
ExecStart=/usr/bin/python3 /opt/daube/remote-commander/agent.py --root /opt/daube --root /var/lib/daube
Restart=always
RestartSec=5
UMask=0027
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadOnlyPaths=/etc/daube/remote-commander.env /etc/daube/remote-commander.token
ReadWritePaths=/opt/daube /var/lib/daube
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
LockPersonality=true
MemoryDenyWriteExecute=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/daube-remote-watchdog.service <<'EOF'
[Unit]
Description=D'AUBE Remote Commander Watchdog
After=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash -lc 'systemctl is-active --quiet daube-remote-agent.service || systemctl restart daube-remote-agent.service'
EOF

cat > /etc/systemd/system/daube-remote-watchdog.timer <<'EOF'
[Unit]
Description=Check D'AUBE Remote Commander every minute

[Timer]
OnBootSec=60
OnUnitActiveSec=60
AccuracySec=10
Persistent=true
Unit=daube-remote-watchdog.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now daube-remote-agent.service
systemctl enable --now daube-remote-watchdog.timer
sleep 3
systemctl is-active --quiet daube-remote-agent.service
systemctl is-active --quiet daube-remote-watchdog.timer

echo "DAUBE_REMOTE_COMMANDER_BOOTSTRAP_COMPLETE device=$DAUBE_RC_DEVICE"
journalctl -u daube-remote-agent.service -n 12 --no-pager || true
