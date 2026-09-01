#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

STATE_DIR="${DAUBE_SOVEREIGN_HOME:-$HOME/.local/share/daube-sovereign-host}"
CI_DIR="$STATE_DIR/ci"
RECEIPT="$CI_DIR/toolchain-receipt.json"
BIN_DIR="$HOME/.local/bin"
INSTALL_DIR="$HOME/.local/lib/daube-sovereign-agent"
ATTEST_REVISION="${DAUBE_SOVEREIGN_CI_ATTEST_REVISION:-8a5a3a4d93aa83184d7d58325774987e7a349a29}"
ATTEST_URL="https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/${ATTEST_REVISION}/farm/sovereign-agent/sovereign-ci-attest.py"
ATTEST_PATH="$INSTALL_DIR/sovereign-ci-attest.py"
ATTEST_BIN="$BIN_DIR/daube-sovereign-ci-proof"
JOB_ID=17062

case "${PREFIX:-}" in
  *com.termux*) ;;
  *) echo "ERROR: run this inside Termux on Android" >&2; exit 2 ;;
esac

mkdir -p "$CI_DIR" "$BIN_DIR" "$INSTALL_DIR"
chmod 700 "$STATE_DIR" "$CI_DIR"

# Source transport uses encrypted exact-command closures. Keep the phone free of
# GitHub/cloud bearer credentials: install only local execution/materialization tools.
pkg install -y git python curl coreutils tar zstd age >/dev/null
if ! command -v node >/dev/null 2>&1; then
  if ! pkg install -y nodejs-lts >/dev/null 2>&1; then
    pkg install -y nodejs >/dev/null
  fi
fi
# Current Termux Node packages recommend npm separately; install it explicitly so
# the receipt is independent of apt recommends behavior.
if ! command -v npm >/dev/null 2>&1; then
  pkg install -y npm >/dev/null
fi

for tool in git python curl sha256sum tar zstd age node npm; do
  command -v "$tool" >/dev/null 2>&1 || { echo "ERROR: required tool unavailable: $tool" >&2; exit 3; }
done

NODE_VERSION="$(node --version)"
NPM_VERSION="$(npm --version)"
GIT_VERSION="$(git --version | awk '{print $3}')"
PYTHON_VERSION="$(python --version 2>&1 | awk '{print $2}')"
ZSTD_VERSION="$(zstd --version | head -n1)"
AGE_VERSION="$(age --version 2>&1 | head -n1)"
OBSERVED_AT="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
ARCH="$(uname -m)"
KERNEL="$(uname -srm)"

export RECEIPT NODE_VERSION NPM_VERSION GIT_VERSION PYTHON_VERSION ZSTD_VERSION AGE_VERSION OBSERVED_AT ARCH KERNEL
python - <<'PY'
import json, os, pathlib
receipt = {
    "schema": "daube.sovereign-ci-termux-toolchain-receipt.v1",
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
    "truthBoundary": "READY proves only that this Android/Termux host has the local toolchain required to receive and execute a bounded sovereign CI closure. It does not prove private-source handoff, Quick Green PASS, production, or external connector authentication."
}
path = pathlib.Path(os.environ["RECEIPT"])
path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
path.chmod(0o600)
PY

# Install a pinned companion attestor. It reuses the existing sovereign Ed25519
# identity and submits only a fixed toolchain probe; it is not a remote shell.
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$ATTEST_URL" -o "$tmp"
python -m py_compile "$tmp"
install -m 0755 "$tmp" "$ATTEST_PATH"

cat >"$BIN_DIR/daube-sovereign-ci-status" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
RECEIPT="$RECEIPT"
if [[ ! -f "\$RECEIPT" ]]; then
  echo 'D’AUBE Sovereign CI toolchain: NOT_READY'
  exit 1
fi
cat "\$RECEIPT"
EOF
chmod 0755 "$BIN_DIR/daube-sovereign-ci-status"

cat >"$ATTEST_BIN" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
export DAUBE_SOVEREIGN_HOME="$STATE_DIR"
exec python "$ATTEST_PATH" "\$@"
EOF
chmod 0755 "$ATTEST_BIN"

if ! grep -Fq 'export PATH="$HOME/.local/bin:$PATH"' "$HOME/.bashrc" 2>/dev/null; then
  printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >>"$HOME/.bashrc"
fi
export PATH="$BIN_DIR:$PATH"

# Submit one fresh signed toolchain proof now. Pairing-required is preserved as a
# non-destructive admission state; other failures remain fail-closed.
set +e
"$ATTEST_BIN"
attest_rc=$?
set -e
if [[ "$attest_rc" -ne 0 && "$attest_rc" -ne 3 ]]; then
  echo "ERROR: signed CI readiness proof failed with exit code $attest_rc" >&2
  exit "$attest_rc"
fi

scheduler="UNAVAILABLE"
if command -v termux-job-scheduler >/dev/null 2>&1; then
  set +e
  termux-job-scheduler \
    --script "$ATTEST_BIN" \
    --job-id "$JOB_ID" \
    --period-ms 1800000 \
    --network any \
    --battery-not-low true \
    --storage-not-low false \
    --charging false \
    --persisted true >/dev/null
  schedule_rc=$?
  set -e
  [[ "$schedule_rc" -eq 0 ]] && scheduler="TERMUX_JOB_SCHEDULER_30M_PERSISTED" || scheduler="AVAILABLE_BUT_SCHEDULE_FAILED"
fi

printf 'D’AUBE Sovereign CI toolchain READY\n'
printf 'receipt: %s\n' "$RECEIPT"
printf 'signedAttestorRevision: %s\n' "$ATTEST_REVISION"
printf 'node: %s | npm: %s | git: %s\n' "$NODE_VERSION" "$NPM_VERSION" "$GIT_VERSION"
printf 'signedReadinessScheduler: %s\n' "$scheduler"
printf 'private-source transport: encrypted exact-command closure; no GitHub credential on host\n'
printf 'paidSpendAuthorized: false\n'
