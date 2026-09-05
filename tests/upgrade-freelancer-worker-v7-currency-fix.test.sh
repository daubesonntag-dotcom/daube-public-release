#!/usr/bin/env bash
set -u
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
SCRIPT="$ROOT/installers/upgrade-freelancer-worker-v7-currency-fix.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail(){ echo "FAIL: $*" >&2; exit 1; }
pass(){ echo "PASS: $*"; }

[ -f "$SCRIPT" ] || fail "v7 script missing"
bash -n "$SCRIPT" || fail "v7 script syntax"

fixture="$TMP/worker.py"
cat > "$fixture" <<'PY'
VERSION="v6-currency-equivalent-autobid"

def budget_gate(currency, lo, hi, fx):
    if currency=="USD": fx=1.0
    currency_guard=False
    lo_usd=hi_usd=0.0
    if 0 < fx < 100000:
        lo_usd=lo/fx; hi_usd=hi/fx
        currency_guard=(hi_usd>=25 and lo_usd<=1000 and hi_usd<=1000)
    return currency_guard, lo_usd, hi_usd
PY

"$SCRIPT" --patch-only "$fixture" >"$TMP/out1"
grep -q '^PATCHED_CURRENCY_CONVERSION_V7$' "$TMP/out1" || fail "patch did not report PATCHED"
grep -q 'VERSION="v7-currency-multiply-autobid"' "$fixture" || fail "version not upgraded"
grep -q 'lo_usd=lo\*fx; hi_usd=hi\*fx' "$fixture" || fail "multiply conversion missing"
python3 -m py_compile "$fixture" || fail "patched fixture does not compile"

python3 - "$fixture" <<'PYRUN' || fail "currency behavior regression failed"
import importlib.util,sys
spec=importlib.util.spec_from_file_location("worker",sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

ok,lo,hi=m.budget_gate("INR",10000,30000,0.0105)
assert ok, (ok,lo,hi)
assert abs(lo-105.0) < 1e-9, lo
assert abs(hi-315.0) < 1e-9, hi

ok,lo,hi=m.budget_gate("USD",100,300,99)
assert ok and lo==100 and hi==300, (ok,lo,hi)

ok,lo,hi=m.budget_gate("INR",10000,30000,0)
assert not ok and lo==0 and hi==0, (ok,lo,hi)
PYRUN
pass "INR/USD/invalid-FX behavior"

sha1="$(sha256sum "$fixture" | awk '{print $1}')"
"$SCRIPT" --patch-only "$fixture" >"$TMP/out2"
sha2="$(sha256sum "$fixture" | awk '{print $1}')"
grep -q '^NO_CHANGE_CURRENCY_CONVERSION_V7$' "$TMP/out2" || fail "idempotent run did not report NO_CHANGE"
[ "$sha1" = "$sha2" ] || fail "idempotent run changed fixture"
pass "idempotence"

bad="$TMP/bad.py"
printf 'VERSION="other"\n' > "$bad"
before="$(sha256sum "$bad" | awk '{print $1}')"
if "$SCRIPT" --patch-only "$bad" >"$TMP/out3" 2>"$TMP/err3"; then
  fail "unexpected worker version succeeded"
fi
after="$(sha256sum "$bad" | awk '{print $1}')"
[ "$before" = "$after" ] || fail "failed patch mutated bad fixture"
grep -q 'UNEXPECTED_WORKER_VERSION' "$TMP/err3" || fail "wrong fail-closed error"
pass "fail-closed unexpected version"

state="$TMP/state.json"
cat > "$state" <<'JSON'
{"version":"v6-currency-equivalent-autobid","submitted":[123,456],"daily":{"2026-09-05":2},"other":"keep"}
JSON
"$SCRIPT" --migrate-state-only "$state" >"$TMP/state-out"
python3 - "$state" <<'PYRUN' || fail "state migration failed"
import json,sys
x=json.load(open(sys.argv[1]))
assert x["version"]=="v7-currency-multiply-autobid", x
assert x["submitted"]==[123,456], x
assert x["daily"]=={"2026-09-05":2}, x
assert x["other"]=="keep", x
PYRUN
pass "state migration preserves bid history"

echo "ALL_V7_CURRENCY_TESTS_PASS"
