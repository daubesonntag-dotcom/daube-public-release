#!/usr/bin/env bash
set -euo pipefail
INSTALLER='/opt/daube/remote-commander/railcall-install-official.sh'
EXPECTED='1f14fa17969fa260437415689e5d1d87a5c67a194c4ac73756390b6a71c44e6b'
STATE='/var/lib/daube/remote-commander'
RC_HOME="$STATE/railcall"
RC_CONF="$STATE/railcall-conf"
USER_HOME="$STATE/railcall-user"
RECEIPT="$STATE/railcall-install-receipt.json"
[[ -s "$INSTALLER" ]] || { echo 'official installer missing' >&2; exit 2; }
GOT="$(sha256sum "$INSTALLER" | awk '{print $1}')"
[[ "$GOT" == "$EXPECTED" ]] || { echo "installer sha mismatch expected=$EXPECTED got=$GOT" >&2; exit 3; }
mkdir -p "$RC_HOME" "$RC_CONF" "$USER_HOME"
export HOME="$USER_HOME"
export RAILCALL_HOME="$RC_HOME"
export RAILCALL_CONF="$RC_CONF"
export RAILCALL_NO_TELEMETRY=1
/usr/bin/bash "$INSTALLER"
BIN="$RC_HOME/bin/railcall"
[[ -x "$BIN" ]] || { echo 'railcall launcher missing after install' >&2; exit 4; }
VERSION="$($BIN version 2>&1)"
DOCTOR="$($BIN doctor 2>&1 || true)"
python3 - "$EXPECTED" "$GOT" "$VERSION" "$DOCTOR" "$BIN" > "$RECEIPT" <<'PY'
import json,sys,hashlib,datetime
expected,got,version,doctor,binary=sys.argv[1:]
p={"status":"INSTALLED","installer_sha256":got,"expected_installer_sha256":expected,"binary":binary,"version_output":version,"doctor_output":doctor[-12000:],"installed_at":datetime.datetime.now(datetime.timezone.utc).isoformat()}
s=json.dumps(p,sort_keys=True,separators=(',',':'),ensure_ascii=False)
p['receipt_sha256']=hashlib.sha256(s.encode()).hexdigest()
print(json.dumps(p,sort_keys=True,ensure_ascii=False))
PY
cat "$RECEIPT"
