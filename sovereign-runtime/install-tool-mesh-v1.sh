#!/usr/bin/env bash
set -euo pipefail
RELEASE_SHA='4826cfe9fc95ee994e4d034eccd9729df353e763'
BASE="https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/${RELEASE_SHA}"
ROOT='/opt/daube/remote-commander/sovereign-runtime'
STATE='/var/lib/daube/remote-commander'
DB="$STATE/sovereign-runtime.db"
AGENT='/opt/daube/remote-commander/agent.py'
mkdir -p "$ROOT" "$STATE"
fetch(){ local u d t; u="$1"; d="$2"; t="${d}.tmp.$$"; /usr/bin/curl -fsSL "$u" -o "$t"; /bin/chmod 0755 "$t"; /bin/mv -f "$t" "$d"; }
fetch "$BASE/sovereign-runtime/tool-mesh-v1.py" "$ROOT/tool-mesh-v1.py"
fetch "$BASE/sovereign-runtime/planner-v1.py" "$ROOT/planner-v1.py"
/usr/bin/python3 "$ROOT/tool-mesh-v1.py" register --runtime "$ROOT/runtime.py" --db "$DB" > "$STATE/tool-mesh-register.json"
/usr/bin/python3 "$ROOT/runtime.py" --db "$DB" health > "$STATE/tool-mesh-health.json"
fetch "$BASE/remote-commander/agent-v0.4.py" "$AGENT"
{
 printf '{"release_sha":"%s","installed_at":"%s","files":{' "$RELEASE_SHA" "$(date -u +%FT%TZ)"
 printf '"tool_mesh":"%s",' "$(sha256sum "$ROOT/tool-mesh-v1.py"|awk '{print $1}')"
 printf '"planner":"%s",' "$(sha256sum "$ROOT/planner-v1.py"|awk '{print $1}')"
 printf '"agent":"%s"' "$(sha256sum "$AGENT"|awk '{print $1}')"
 printf '}}\n'
} > "$STATE/tool-mesh-v1-install-receipt.json"
AGENT_PID="$PPID"
nohup /bin/sh -c "sleep 8; /bin/kill -TERM ${AGENT_PID}" >/dev/null 2>&1 &
echo "DAUBE_TOOL_MESH_V1_INSTALLED release=${RELEASE_SHA} agent_upgrade=0.4.0 planner=enabled restart_scheduled=1"
