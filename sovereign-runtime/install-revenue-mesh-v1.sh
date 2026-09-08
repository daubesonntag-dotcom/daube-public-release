#!/usr/bin/env bash
set -euo pipefail
RELEASE_SHA='9dad65a3daab08ad44b8c6ccbde708c731b96bab'
BASE="https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/${RELEASE_SHA}"
ROOT='/opt/daube/remote-commander/sovereign-runtime'
STATE='/var/lib/daube/remote-commander'
DB="$STATE/sovereign-runtime.db"
AGENT='/opt/daube/remote-commander/agent.py'
mkdir -p "$ROOT" "$STATE/market" "$STATE/revenue"
fetch_atomic(){ local src="$1"; local dst="$2"; local tmp="${dst}.tmp.$$"; /usr/bin/curl -fsSL "$src" -o "$tmp"; /bin/chmod 0755 "$tmp"; /bin/mv -f "$tmp" "$dst"; }
fetch_atomic "$BASE/sovereign-runtime/market-scout-v1.py" "$ROOT/market-scout-v1.py"
fetch_atomic "$BASE/sovereign-runtime/revenue-loop-v1.py" "$ROOT/revenue-loop-v1.py"
fetch_atomic "$BASE/sovereign-runtime/planner-v2.py" "$ROOT/planner-v2.py"
fetch_atomic "$BASE/sovereign-runtime/railcall-adapter-v1.py" "$ROOT/railcall-adapter-v1.py"
MARKET_CMD="/usr/bin/python3 $ROOT/market-scout-v1.py {payload}"
REVENUE_CMD="/usr/bin/python3 $ROOT/revenue-loop-v1.py {payload}"
RAILCALL_CMD="/usr/bin/python3 $ROOT/railcall-adapter-v1.py {payload}"
MARKET_HEALTH="/usr/bin/python3 -c \"import pathlib,sys; sys.exit(0 if pathlib.Path('$ROOT/market-scout-v1.py').is_file() else 1)\""
REVENUE_HEALTH="/usr/bin/python3 -c \"import pathlib,sys; sys.exit(0 if pathlib.Path('$ROOT/revenue-loop-v1.py').is_file() else 1)\""
RAILCALL_HEALTH="/usr/bin/python3 -c \"import pathlib,sys; sys.exit(0 if pathlib.Path('/var/lib/daube/remote-commander/railcall/bin/railcall').is_file() else 1)\""
/usr/bin/python3 "$ROOT/runtime.py" --db "$DB" capability market.local market.discovery "$MARKET_CMD" --health "$MARKET_HEALTH" --priority 100 >/dev/null
/usr/bin/python3 "$ROOT/runtime.py" --db "$DB" capability revenue.local revenue "$REVENUE_CMD" --health "$REVENUE_HEALTH" --priority 100 >/dev/null
/usr/bin/python3 "$ROOT/runtime.py" --db "$DB" capability railcall.local railcall "$RAILCALL_CMD" --health "$RAILCALL_HEALTH" --priority 100 >/dev/null
/usr/bin/python3 "$ROOT/runtime.py" --db "$DB" health > "$STATE/revenue-mesh-health.json"
fetch_atomic "$BASE/remote-commander/agent-v0.5.py" "$AGENT"
{
 printf '{"release_sha":"%s","installed_at":"%s","files":{' "$RELEASE_SHA" "$(date -u +%FT%TZ)"
 printf '"market":"%s",' "$(sha256sum "$ROOT/market-scout-v1.py"|awk '{print $1}')"
 printf '"revenue":"%s",' "$(sha256sum "$ROOT/revenue-loop-v1.py"|awk '{print $1}')"
 printf '"planner":"%s",' "$(sha256sum "$ROOT/planner-v2.py"|awk '{print $1}')"
 printf '"railcall_adapter":"%s",' "$(sha256sum "$ROOT/railcall-adapter-v1.py"|awk '{print $1}')"
 printf '"agent":"%s"' "$(sha256sum "$AGENT"|awk '{print $1}')"
 printf '}}\n'
} > "$STATE/revenue-mesh-v1-install-receipt.json"
AGENT_PID="$PPID"
nohup /bin/sh -c "sleep 8; /bin/kill -TERM ${AGENT_PID}" >/dev/null 2>&1 &
echo "DAUBE_REVENUE_MESH_V1_INSTALLED release=${RELEASE_SHA} agent_upgrade=0.5.0 restart_scheduled=1"
