#!/usr/bin/env bash
set -euo pipefail

RELEASE_SHA="1eeb0d88344456374f93503f39033620ea8c00cb"
BASE="https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/${RELEASE_SHA}"
ROOT="/opt/daube/remote-commander/sovereign-runtime"
STATE="/var/lib/daube/remote-commander"
DB="${STATE}/sovereign-runtime.db"
AGENT="/opt/daube/remote-commander/agent.py"
mkdir -p "$ROOT" "$STATE"

fetch_atomic() {
  local src="$1" dst="$2" tmp
  tmp="${dst}.tmp.$$"
  /usr/bin/curl -fsSL "$src" -o "$tmp"
  /bin/chmod 0755 "$tmp"
  /bin/mv -f "$tmp" "$dst"
}

fetch_atomic "$BASE/sovereign-runtime/runtime.py" "$ROOT/runtime.py"
fetch_atomic "$BASE/sovereign-runtime/smoke_test.py" "$ROOT/smoke_test.py"

SMOKE_JSON="$(/usr/bin/python3 "$ROOT/smoke_test.py")"
printf '%s\n' "$SMOKE_JSON" > "$STATE/sovereign-runtime-smoke.json"
/usr/bin/python3 "$ROOT/runtime.py" --db "$DB" init >/dev/null

if [[ ! -f "$STATE/sovereign-runtime-seeded-v1" ]]; then
  /usr/bin/python3 "$ROOT/runtime.py" --db "$DB" objective \
    "Operate D’AUBE Sovereign Runtime" \
    "Maintain host-native control, health, queue, evidence, recovery and replaceable capability routing." \
    --priority 100 >/dev/null
  /usr/bin/python3 "$ROOT/runtime.py" --db "$DB" objective \
    "Complete RailCall Developer Challenge" \
    "Finish native verification, signing, airlock evidence, marketplace publication and contest submission with zero paid fallback." \
    --priority 95 >/dev/null
  /usr/bin/python3 "$ROOT/runtime.py" --db "$DB" objective \
    "Autonomous Revenue Execution" \
    "Discover, prioritize and execute lawful zero-spend revenue opportunities; preserve founder gates for identity, payments, legal signatures and irreversible high-risk actions." \
    --priority 90 >/dev/null
  /usr/bin/touch "$STATE/sovereign-runtime-seeded-v1"
fi

# Upgrade Remote Commander to the supervisor build. The running v0.2 process
# keeps executing until the delayed TERM below; systemd then restarts v0.3.
fetch_atomic "$BASE/remote-commander/agent-v0.3.py" "$AGENT"

{
  printf '{"release_sha":"%s","installed_at":"%s","files":{' "$RELEASE_SHA" "$(date -u +%FT%TZ)"
  printf '"runtime.py":"%s",' "$(sha256sum "$ROOT/runtime.py" | awk '{print $1}')"
  printf '"smoke_test.py":"%s",' "$(sha256sum "$ROOT/smoke_test.py" | awk '{print $1}')"
  printf '"agent.py":"%s"' "$(sha256sum "$AGENT" | awk '{print $1}')"
  printf '}}\n'
} > "$STATE/sovereign-runtime-install-receipt.json"

AGENT_PID="$PPID"
nohup /bin/sh -c "sleep 8; /bin/kill -TERM ${AGENT_PID}" >/dev/null 2>&1 &

echo "DAUBE_SOVEREIGN_RUNTIME_INSTALLED release=${RELEASE_SHA} agent_upgrade=0.3.0 restart_scheduled=1"
