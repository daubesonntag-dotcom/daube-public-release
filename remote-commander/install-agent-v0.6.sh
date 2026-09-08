#!/usr/bin/env bash
set -euo pipefail
AGENT_SHA='2f18cef380dbf1ad43d2f670acb28abb68f64335'
SRC="https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/${AGENT_SHA}/remote-commander/agent-v0.6.py"
DST='/opt/daube/remote-commander/agent.py'
STATE='/var/lib/daube/remote-commander'
TMP="${DST}.v06.tmp.$$"
mkdir -p "$STATE"
/usr/bin/curl -fsSL "$SRC" -o "$TMP"
/usr/bin/python3 -m py_compile "$TMP"
/bin/chmod 0755 "$TMP"
SHA="$(sha256sum "$TMP"|awk '{print $1}')"
/bin/mv -f "$TMP" "$DST"
python3 - "$AGENT_SHA" "$SHA" > "$STATE/agent-v0.6-install-receipt.json" <<'PY'
import json,sys,datetime,hashlib
source_sha,file_sha=sys.argv[1:]
p={'status':'INSTALLED','version':'0.6.0','source_commit':source_sha,'file_sha256':file_sha,'installed_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
s=json.dumps(p,sort_keys=True,separators=(',',':')); p['receipt_sha256']=hashlib.sha256(s.encode()).hexdigest(); print(json.dumps(p,sort_keys=True))
PY
AGENT_PID="$PPID"
nohup /bin/sh -c "sleep 5; /bin/kill -TERM ${AGENT_PID}" >/dev/null 2>&1 &
echo "DAUBE_REMOTE_AGENT_V06_INSTALLED source=${AGENT_SHA} sha256=${SHA} restart_scheduled=1"
