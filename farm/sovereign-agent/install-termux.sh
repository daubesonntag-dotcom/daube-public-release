#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

# D'AUBE Sovereign Edge — Android/Termux one-tap installer.
# The agent is pinned to an immutable revision that supports Android runtime
# detection plus Ed25519 through either the openssl CLI or libcrypto via ctypes.
AGENT_REVISION="${DAUBE_SOVEREIGN_AGENT_REVISION:-823bebf5484d283d0b3692428cc9de5c181f5469}"
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

# Some Termux builds can start with apt cache directories absent.
APP_ROOT="${PREFIX%/files/usr}"
mkdir -p \
  "$APP_ROOT/cache/apt" \
  "$PREFIX/var/cache/apt/archives/partial" \
  "$PREFIX/var/lib/apt/lists/partial" 2>/dev/null || true

# The openssl package provides libcrypto. Some Termux distributions expose the
# openssl CLI separately as openssl-tool, so install that only as a best-effort
# optimization; the sovereign agent no longer requires the CLI.
pkg install -y python openssl curl coreutils >/dev/null
pkg install -y openssl-tool >/dev/null 2>&1 || true

# Verify that at least one Ed25519 crypto backend is available. This succeeds on
# Termux builds where the CLI is missing as long as libcrypto is loadable.
if ! command -v openssl >/dev/null 2>&1; then
  if ! python - <<'PY'
import ctypes, ctypes.util, os, sys
prefix=os.environ.get('PREFIX','')
candidates=[]
if prefix:
    candidates.extend([f'{prefix}/lib/libcrypto.so', f'{prefix}/lib/libcrypto.so.3'])
found=ctypes.util.find_library('crypto')
if found:
    candidates.append(found)
candidates.extend(['libcrypto.so.3','libcrypto.so'])
for candidate in candidates:
    try:
        lib=ctypes.CDLL(candidate)
        fn=getattr(lib, 'EVP_PKEY_new_raw_private_key', None)
        if fn is not None:
            sys.exit(0)
    except OSError:
        pass
sys.exit(1)
PY
  then
    echo "ERROR: Neither the openssl CLI nor usable libcrypto is available." >&2
    echo "Try: pkg update && pkg install openssl" >&2
    exit 4
  fi
fi

# F-Droid builds usually obtain termux-job-scheduler through termux-api.
# Google Play builds can expose scheduler support directly in the main app.
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
printf '  daube-sovereign-status\n'
printf '  daube-sovereign-proof\n'

if [[ "$rc" -eq 3 ]]; then
  printf '\nPAIRING_REQUIRED\n'
  printf '1. Open: %s\n' "$PAIRING_URL"
  printf '2. Run workflow → action=approve\n'
  printf '3. Paste public_key_sha256=%s\n' "$fingerprint"
  printf '4. After approval, run: daube-sovereign-proof\n'
else
  printf '\nInitial proof is VERIFIED. Resource Farm may admit sovereign-local while evidence remains fresh.\n'
fi

if [[ "$scheduler" == "UNAVAILABLE" ]]; then
  printf '\nNOTE: automatic refresh is unavailable; manual proof still works with daube-sovereign-proof.\n'
elif [[ "$scheduler" == "AVAILABLE_BUT_SCHEDULE_FAILED" ]]; then
  printf '\nNOTE: Android rejected background scheduling. Manual proof still works; check Termux battery/background restrictions.\n'
fi
