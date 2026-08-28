#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

# D'AUBE Sovereign Edge — Android/Termux one-tap installer.
# The default agent is pinned to an immutable, previously published revision.
AGENT_REVISION="${DAUBE_SOVEREIGN_AGENT_REVISION:-8f63749f39e89e6b58dda0ac61293f33eefe0d54}"
SOURCE_URL="${DAUBE_SOVEREIGN_AGENT_URL:-https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/${AGENT_REVISION}/farm/sovereign-agent/direct-agent.py}"
PAIRING_URL="https://github.com/daubesonntag-dotcom/daube-public-release/actions/workflows/sovereign-edge-pair.yml"
INSTALL_DIR="$HOME/.local/lib/daube-sovereign-agent"
BIN_DIR="$HOME/.local/bin"
STATE_DIR="$HOME/.local/share/daube-sovereign-host"
AGENT="$INSTALL_DIR/direct-agent.py"
PROOF_BIN="$BIN_DIR/daube-sovereign-proof"
STATUS_BIN="$BIN_DIR/daube-sovereign-status"
JOB_ID=17061

case "${PREFIX:-}" in
  *com.termux*) ;;
  *) echo "ERROR: This installer must be run inside Termux on Android." >&2; exit 2 ;;
esac

printf '\nD’AUBE Sovereign Edge — Android setup\n'
printf '%s\n' '-------------------------------------'
printf 'Agent revision: %s\n\n' "$AGENT_REVISION"

pkg install -y python openssl curl coreutils >/dev/null

# F-Droid builds usually obtain termux-job-scheduler through termux-api.
# Google Play builds from 2026 can expose the scheduler directly in the main app.
if ! command -v termux-job-scheduler >/dev/null 2>&1; then
  pkg install -y termux-api >/dev/null 2>&1 || true
fi

mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$STATE_DIR"
chmod 700 "$STATE_DIR"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$SOURCE_URL" -o "$tmp"
python -m py_compile "$tmp"
install -m 0755 "$tmp" "$AGENT"

cat >"$PROOF_BIN" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
export DAUBE_SOVEREIGN_HOME="$STATE_DIR"
exec python "$AGENT"
EOF
chmod 0755 "$PROOF_BIN"

cat >"$STATUS_BIN" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
STATE_DIR="$STATE_DIR"
PUB="\$STATE_DIR/host-ed25519.pub.pem"
LATEST="\$STATE_DIR/latest-direct-proof.json"
PAIRING_URL="$PAIRING_URL"

printf 'D’AUBE Sovereign Edge status\n'
printf '%s\n' '----------------------------'
if [[ -f "\$PUB" ]]; then
  fingerprint="\$(sha256sum "\$PUB" | awk '{print \$1}')"
  printf 'publicKeySha256: %s\n' "\$fingerprint"
else
  printf 'publicKeySha256: NOT_CREATED_YET\n'
fi
if [[ -f "\$LATEST" ]]; then
  python - "\$LATEST" <<'PY'
import json, sys
p=json.load(open(sys.argv[1], encoding='utf-8'))
a=p.get('attestation', {})
print('runtimeKind:', a.get('runtimeKind', 'UNKNOWN'))
print('observedAt:', a.get('observedAt', 'UNKNOWN'))
print('cloudDetected:', a.get('cloudHeuristic', {}).get('detected', 'UNKNOWN'))
print('canaryPass:', a.get('canary', {}).get('success', 'UNKNOWN'))
print('hostId:', a.get('hostId', 'UNKNOWN'))
PY
else
  printf 'latestProof: NONE\n'
fi
printf 'Pairing workflow: %s\n' "\$PAIRING_URL"
EOF
chmod 0755 "$STATUS_BIN"

# Ensure the user can call the installed commands in future Termux sessions.
if ! grep -Fq 'export PATH="$HOME/.local/bin:$PATH"' "$HOME/.bashrc" 2>/dev/null; then
  printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$HOME/.bashrc"
fi
export PATH="$BIN_DIR:$PATH"

set +e
"$PROOF_BIN"
rc=$?
set -e
if [[ "$rc" -ne 0 && "$rc" -ne 3 ]]; then
  echo "ERROR: Initial sovereign proof failed with exit code $rc." >&2
  echo "Run: daube-sovereign-proof" >&2
  exit "$rc"
fi

scheduler="UNAVAILABLE"
if command -v termux-job-scheduler >/dev/null 2>&1; then
  # Android N+ enforces a 15-minute minimum. 30 minutes is deliberately
  # conservative for battery while remaining well inside the proof freshness gate.
  set +e
  termux-job-scheduler \
    --script "$PROOF_BIN" \
    --job-id "$JOB_ID" \
    --period-ms 1800000 \
    --network any \
    --battery-not-low true \
    --storage-not-low false \
    --charging false \
    --persisted true >/dev/null
  schedule_rc=$?
  set -e
  if [[ "$schedule_rc" -eq 0 ]]; then
    scheduler="TERMUX_JOB_SCHEDULER_30M_PERSISTED"
  else
    scheduler="AVAILABLE_BUT_SCHEDULE_FAILED"
  fi
fi

fingerprint="UNKNOWN"
if [[ -f "$STATE_DIR/host-ed25519.pub.pem" ]]; then
  fingerprint="$(sha256sum "$STATE_DIR/host-ed25519.pub.pem" | awk '{print $1}')"
fi

printf '\n%s\n' '-------------------------------------'
printf 'D’AUBE founder-controlled edge installed.\n'
printf 'Runtime: android-termux\n'
printf 'Transport: outbound HTTPS only\n'
printf 'Inbound ports: none\n'
printf 'Cloud credentials: none\n'
printf 'GitHub PAT/runner token: none\n'
printf 'Scheduler: %s\n' "$scheduler"
printf 'publicKeySha256: %s\n' "$fingerprint"
printf '\nUseful commands:\n'
printf '  daube-sovereign-status   # show fingerprint and last local proof\n'
printf '  daube-sovereign-proof    # send/refresh signed proof now\n'

if [[ "$rc" -eq 3 ]]; then
  printf '\nPAIRING_REQUIRED\n'
  printf '1. Open: %s\n' "$PAIRING_URL"
  printf '2. Run workflow → action=approve\n'
  printf '3. Paste public_key_sha256=%s\n' "$fingerprint"
  printf '4. After approval, return here and run: daube-sovereign-proof\n'
else
  printf '\nInitial proof is VERIFIED. Resource Farm may admit sovereign-local while the evidence remains fresh.\n'
fi

if [[ "$scheduler" == "UNAVAILABLE" ]]; then
  printf '\nNOTE: automatic refresh was not scheduled because termux-job-scheduler is unavailable.\n'
  printf 'The node still works manually with daube-sovereign-proof. On F-Droid Termux, install the matching Termux:API app/package; current Google Play Termux builds include job-scheduler support in the main app.\n'
elif [[ "$scheduler" == "AVAILABLE_BUT_SCHEDULE_FAILED" ]]; then
  printf '\nNOTE: termux-job-scheduler exists but Android rejected scheduling. Manual proof still works. Check Termux background/battery restrictions, then rerun this installer or daube-sovereign-proof.\n'
fi
