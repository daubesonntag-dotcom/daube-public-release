#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
mkdir -p "$ROOT/installers" "$ROOT/home/daube-revenue-worker/full-wave-v12" "$ROOT/bin"
cp installers/attest-full-wave-mesh-v12.sh "$ROOT/installers/attest-full-wave-mesh-v12.sh"
cat > "$ROOT/installers/install-full-wave-mesh-lane-v12.sh" <<'SH'
#!/usr/bin/env bash
: > "$HOME/v12-ran.marker"
exit 99
SH
chmod +x "$ROOT/installers/"*.sh
cat > "$ROOT/bin/systemctl" <<'SH'
#!/usr/bin/env bash
exit 0
SH
cat > "$ROOT/bin/sudo" <<'SH'
#!/usr/bin/env bash
exit 1
SH
chmod +x "$ROOT/bin/"*
cat > "$ROOT/home/daube-revenue-worker/full-wave-v12/receipt.json" <<'JSON'
{
  "schema":"daube.full-wave-v12.receipt.v1",
  "classification":"FULL_WAVE_READY",
  "target_revision":"1111111111111111111111111111111111111111",
  "units":{"placeholder":"active"}
}
JSON
set +e
HOME="$ROOT/home" PATH="$ROOT/bin:$PATH" DAUBE_AUTOPILOT_TARGET_REVISION="2222222222222222222222222222222222222222" \
  bash "$ROOT/installers/attest-full-wave-mesh-v12.sh" >/dev/null 2>&1
set -e
[[ -f "$ROOT/home/v12-ran.marker" ]] || {
  echo "FAIL: stale receipt was admitted; V12 was not re-executed" >&2
  exit 1
}
echo "PASS: stale receipt rejected and V12 re-executed"
