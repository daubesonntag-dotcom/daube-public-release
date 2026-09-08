#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
umask 077

STATE_DIR="${DAUBE_SOVEREIGN_HOME:-$HOME/.local/share/daube-sovereign-host}"
CI_DIR="$STATE_DIR/ci"
RECEIPT="$CI_DIR/toolchain-receipt.json"
BIN_DIR="$HOME/.local/bin"
INSTALL_DIR="$HOME/.local/lib/daube-sovereign-agent"
PAYLOAD_REVISION="${DAUBE_SOVEREIGN_CI_RELEASE_REVISION:-246dfaa1e6ff8668e87c6054ba557d57217613da}"
BASE="https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/${PAYLOAD_REVISION}/farm/sovereign-agent"
ATTEST_PATH="$INSTALL_DIR/sovereign-ci-attest.py"
WORKER_PATH="$INSTALL_DIR/sovereign-ci-worker-v2.py"
ATTEST_BIN="$BIN_DIR/daube-sovereign-ci-proof"
WORKER_BIN="$BIN_DIR/daube-sovereign-ci-worker"
AGE_IDENTITY="$CI_DIR/transport-age-identity.txt"
AGE_RECIPIENT_FILE="$CI_DIR/transport-age-recipient.txt"
ATTEST_JOB_ID=17062
WORKER_JOB_ID=17063

case "${PREFIX:-}" in
  *com.termux*) ;;
  *) echo "ERROR: run this inside Termux on Android" >&2; exit 2 ;;
esac

mkdir -p "$CI_DIR" "$BIN_DIR" "$INSTALL_DIR"
chmod 700 "$STATE_DIR" "$CI_DIR"

# rage is the Termux-packaged age-v1-compatible implementation. No GitHub/cloud
# bearer credential, runner token, root path, or paid provider is introduced.
pkg install -y git python curl coreutils tar zstd rage >/dev/null
if ! command -v node >/dev/null 2>&1; then
  if ! pkg install -y nodejs-lts >/dev/null 2>&1; then
    pkg install -y nodejs >/dev/null
  fi
fi
if ! command -v npm >/dev/null 2>&1; then
  pkg install -y npm >/dev/null
fi
for tool in git python curl sha256sum tar zstd rage rage-keygen node npm; do
  command -v "$tool" >/dev/null 2>&1 || { echo "ERROR: required tool unavailable: $tool" >&2; exit 3; }
done

NODE_VERSION="$(node --version)"
NODE_MAJOR="${NODE_VERSION#v}"; NODE_MAJOR="${NODE_MAJOR%%.*}"
[[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] && (( NODE_MAJOR >= 22 )) || { echo "ERROR: Node >=22 required; found $NODE_VERSION" >&2; exit 4; }
NPM_VERSION="$(npm --version)"
GIT_VERSION="$(git --version | awk '{print $3}')"
PYTHON_VERSION="$(python --version 2>&1 | awk '{print $2}')"
ZSTD_VERSION="$(zstd --version | head -n1)"
AGE_VERSION="$(rage --version 2>&1 | head -n1)"

if [[ ! -s "$AGE_IDENTITY" ]]; then
  rage-keygen -o "$AGE_IDENTITY" >/dev/null
fi
chmod 0600 "$AGE_IDENTITY"
AGE_RECIPIENT="$(rage-keygen -y "$AGE_IDENTITY" | sed -n '1p')"
[[ "$AGE_RECIPIENT" == age1* ]] || { echo "ERROR: age recipient generation failed" >&2; exit 5; }
printf '%s\n' "$AGE_RECIPIENT" >"$AGE_RECIPIENT_FILE"
chmod 0644 "$AGE_RECIPIENT_FILE"
RECIPIENT_FINGERPRINT="$(printf '%s' "$AGE_RECIPIENT" | sha256sum | awk '{print $1}')"

OBSERVED_AT="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
ARCH="$(uname -m)"
KERNEL="$(uname -srm)"
export RECEIPT NODE_VERSION NPM_VERSION GIT_VERSION PYTHON_VERSION ZSTD_VERSION AGE_VERSION OBSERVED_AT ARCH KERNEL AGE_RECIPIENT RECIPIENT_FINGERPRINT
python - <<'PY'
import json, os, pathlib
receipt = {
    "schema": "daube.sovereign-ci-termux-toolchain-receipt.v2",
    "decision": "READY",
    "runtimeKind": "android-termux",
    "observedAt": os.environ["OBSERVED_AT"],
    "architecture": os.environ["ARCH"],
    "kernel": os.environ["KERNEL"],
    "toolchain": {
        "node": os.environ["NODE_VERSION"],
        "npm": os.environ["NPM_VERSION"],
        "git": os.environ["GIT_VERSION"],
        "python": os.environ["PYTHON_VERSION"],
        "zstd": os.environ["ZSTD_VERSION"],
        "age": os.environ["AGE_VERSION"],
    },
    "sourceTransport": {
        "mode": "encrypted-exact-command-closure",
        "implementation": "rage",
        "recipientType": "age-x25519",
        "ageRecipient": os.environ["AGE_RECIPIENT"],
        "recipientFingerprint": os.environ["RECIPIENT_FINGERPRINT"],
        "sourceIdentityVisibleBeforeDecrypt": False,
        "githubCredentialRequiredOnHost": False,
        "cloudBearerCredentialRequiredOnHost": False,
        "inboundPortRequired": False,
    },
    "authority": {
        "paidSpendAuthorized": False,
        "productionMutationAuthorized": False,
        "credentialExportAuthorized": False,
        "mergeAdmissionAuthorized": False,
    },
    "truthBoundary": "READY proves local Node>=22 plus an age/X25519 transport recipient on this Android/Termux host. It does not prove private-source execution, test PASS, merge, production, or product LIVE."
}
path = pathlib.Path(os.environ["RECEIPT"])
path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
path.chmod(0o600)
PY

fetch_python() {
  local name="$1" dest="$2" tmp
  tmp="$(mktemp)"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$BASE/$name" -o "$tmp"
  python -m py_compile "$tmp"
  install -m 0755 "$tmp" "$dest"
  rm -f "$tmp"
}
fetch_python sovereign-ci-attest.py "$ATTEST_PATH"
fetch_python sovereign-ci-worker-v2.py "$WORKER_PATH"

cat >"$ATTEST_BIN" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
export DAUBE_SOVEREIGN_HOME="$STATE_DIR"
export DAUBE_SOVEREIGN_CI_AGE_IDENTITY="$AGE_IDENTITY"
export DAUBE_SOVEREIGN_CI_AGE_RECIPIENT="$AGE_RECIPIENT_FILE"
exec python "$ATTEST_PATH" "\$@"
EOF
cat >"$WORKER_BIN" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
export DAUBE_SOVEREIGN_HOME="$STATE_DIR"
export DAUBE_SOVEREIGN_CI_AGE_IDENTITY="$AGE_IDENTITY"
export DAUBE_SOVEREIGN_CI_AGE_RECIPIENT="$AGE_RECIPIENT_FILE"
exec python "$WORKER_PATH" "\$@"
EOF
cat >"$BIN_DIR/daube-sovereign-ci-status" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
cat "$RECEIPT"
EOF
chmod 0755 "$ATTEST_BIN" "$WORKER_BIN" "$BIN_DIR/daube-sovereign-ci-status"

if ! grep -Fq 'export PATH="$HOME/.local/bin:$PATH"' "$HOME/.bashrc" 2>/dev/null; then
  printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >>"$HOME/.bashrc"
fi
export PATH="$BIN_DIR:$PATH"

set +e
"$ATTEST_BIN"
ATTEST_RC=$?
set -e
if [[ "$ATTEST_RC" -ne 0 && "$ATTEST_RC" -ne 3 ]]; then
  echo "ERROR: signed CI readiness proof failed with exit code $ATTEST_RC" >&2
  exit "$ATTEST_RC"
fi

WORKER_RC="NOT_RUN"
if [[ "$ATTEST_RC" -eq 0 ]]; then
  set +e
  "$WORKER_BIN"
  WORKER_RC=$?
  set -e
fi

ATTEST_SCHEDULER="UNAVAILABLE"
WORKER_SCHEDULER="UNAVAILABLE"
if command -v termux-job-scheduler >/dev/null 2>&1; then
  set +e
  termux-job-scheduler --script "$ATTEST_BIN" --job-id "$ATTEST_JOB_ID" --period-ms 1800000 --network any --battery-not-low true --storage-not-low false --charging false --persisted true >/dev/null
  [[ $? -eq 0 ]] && ATTEST_SCHEDULER="TERMUX_30M_PERSISTED" || ATTEST_SCHEDULER="SCHEDULE_FAILED"
  termux-job-scheduler --script "$WORKER_BIN" --job-id "$WORKER_JOB_ID" --period-ms 900000 --network any --battery-not-low true --storage-not-low false --charging false --persisted true >/dev/null
  [[ $? -eq 0 ]] && WORKER_SCHEDULER="TERMUX_15M_PERSISTED" || WORKER_SCHEDULER="SCHEDULE_FAILED"
  set -e
fi

printf 'D’AUBE Sovereign CI toolchain READY (local)\n'
printf 'payloadRevision: %s\n' "$PAYLOAD_REVISION"
printf 'workerProtocol: sealed-capsule-v2\n'
printf 'node: %s | npm: %s | git: %s\n' "$NODE_VERSION" "$NPM_VERSION" "$GIT_VERSION"
printf 'ageImplementation: rage | recipientFingerprint: %s\n' "$RECIPIENT_FINGERPRINT"
printf 'attestationExitCode: %s | immediateWorkerExitCode: %s\n' "$ATTEST_RC" "$WORKER_RC"
printf 'attestationScheduler: %s | workerScheduler: %s\n' "$ATTEST_SCHEDULER" "$WORKER_SCHEDULER"
printf 'private-source transport: age-v1/X25519; source identity sealed until decrypt; no GitHub credential on host\n'
printf 'paidSpendAuthorized: false\n'