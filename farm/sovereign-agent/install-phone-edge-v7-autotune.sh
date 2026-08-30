#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

REVISION="${DAUBE_PHONE_EDGE_V7_REVISION:-393dcb43af29f2c92f353b35f8a012bb88ec0b89}"
BASE="https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/${REVISION}/farm/sovereign-agent"
BIN_DIR="$HOME/.local/bin"
LIB_DIR="$HOME/.local/lib/daube-sovereign-agent-v7"
STATE_DIR="$HOME/.local/share/daube-phone-edge"
mkdir -p "$BIN_DIR" "$LIB_DIR" "$STATE_DIR"

case "${PREFIX:-}" in *com.termux*) ;; *) echo 'ERROR: run inside Termux on Android' >&2; exit 2;; esac
pkg install -y python curl coreutils >/dev/null

if ! command -v daube-phone-edge-v5-batch >/dev/null 2>&1; then
  curl -fsSL https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/main/farm/sovereign-agent/install-phone-edge-v5-fastpath.sh | bash
fi
if ! command -v daube-phone-edge-v6-premultiply >/dev/null 2>&1 || ! command -v daube-phone-edge-thermal-headroom >/dev/null 2>&1; then
  curl -fsSL https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/main/farm/sovereign-agent/install-phone-edge-v6-maxperf.sh | bash
fi

curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$BASE/run-phone-edge-v7-autotune.py" -o "$LIB_DIR/run-phone-edge-v7-autotune.py"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$BASE/run-phone-edge-v7-auto-premultiply.py" -o "$LIB_DIR/run-phone-edge-v7-auto-premultiply.py"
python -m py_compile "$LIB_DIR/run-phone-edge-v7-autotune.py" "$LIB_DIR/run-phone-edge-v7-auto-premultiply.py"
chmod 0755 "$LIB_DIR"/*.py

cat > "$BIN_DIR/daube-phone-edge-v7-autotune" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
export PATH="$BIN_DIR:\$PATH"
exec python "$LIB_DIR/run-phone-edge-v7-autotune.py"
EOF
cat > "$BIN_DIR/daube-phone-edge-auto-premultiply" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
export PATH="$BIN_DIR:\$PATH"
exec python "$LIB_DIR/run-phone-edge-v7-auto-premultiply.py" "\$@"
EOF
cat > "$BIN_DIR/daube-phone-edge-v7-maintain" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
PROFILE="$HOME/.local/share/daube-phone-edge/perf-profile-v7.json"
V5="$(command -v daube-phone-edge-v5-batch || true)"
V6="$(command -v daube-phone-edge-v6-premultiply || true)"
[[ -n "$V5" && -n "$V6" ]] || exit 0
current="$(python - "$V5" "$V6" <<'PY'
import hashlib,sys
h=hashlib.sha256()
for p in sys.argv[1:]:
 h.update(p.encode()); h.update(open(p,'rb').read())
print(h.hexdigest())
PY
)"
stored="$(python - "$PROFILE" 2>/dev/null <<'PY' || true
import json,sys
try: print(json.load(open(sys.argv[1]))['runtimeFingerprint'])
except Exception: pass
PY
)"
if [[ "$current" == "$stored" && -n "$stored" ]]; then
  printf '%s\n' '{"schema":"daube.phone-edge-v7-maintain.v1","status":"NOOP_PROFILE_FRESH","paidSpendAuthorized":false}'
  exit 0
fi
exec daube-phone-edge-v7-autotune
EOF
chmod 0755 "$BIN_DIR/daube-phone-edge-v7-autotune" "$BIN_DIR/daube-phone-edge-auto-premultiply" "$BIN_DIR/daube-phone-edge-v7-maintain"

# Calibrate once now. Thermal guard fails closed; installation itself remains valid if calibration is deferred.
set +e
daube-phone-edge-v7-autotune
CAL_RC=$?
set -e

SCHEDULER="NOT_SCHEDULED"
if command -v termux-job-scheduler >/dev/null 2>&1; then
  set +e
  termux-job-scheduler --script "$BIN_DIR/daube-phone-edge-v7-maintain" --job-id 17067 --period-ms 86400000 --network any --battery-not-low true --storage-not-low false --charging false --persisted true >/dev/null
  [[ $? -eq 0 ]] && SCHEDULER="TERMUX_V7_MAINTENANCE_24H_PERSISTED" || SCHEDULER="SCHEDULE_FAILED"
  set -e
fi

printf '%s\n' "{\"schema\":\"daube.phone-edge-v7-install.v1\",\"status\":\"INSTALLED\",\"revision\":\"$REVISION\",\"calibrationExitCode\":$CAL_RC,\"scheduler\":\"$SCHEDULER\",\"autoRuntime\":\"daube-phone-edge-auto-premultiply\",\"maintainer\":\"daube-phone-edge-v7-maintain\",\"privateAssetsUsed\":false,\"paidSpendAuthorized\":false}"
