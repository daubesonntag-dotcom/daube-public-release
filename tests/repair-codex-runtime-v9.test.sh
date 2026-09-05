#!/usr/bin/env bash
set -u
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
SCRIPT="$ROOT/installers/repair-codex-runtime-v9.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail(){ echo "FAIL: $*" >&2; exit 1; }
pass(){ echo "PASS: $*"; }

[ -f "$SCRIPT" ] || fail "v9 script missing"

# shell auth predicate must reject the classic false positive and accept real ChatGPT auth.
# shellcheck disable=SC1090
source "$SCRIPT"
auth_status_ok "Not logged in" && fail "Not logged in was accepted" || true
auth_status_ok "Logged in using ChatGPT" || fail "valid ChatGPT auth rejected"
pass "auth predicate"

fixture="$TMP/executor.py"
cat > "$fixture" <<'PY'
from pathlib import Path
import shutil, subprocess
HOME=Path.home()

def detect_runtime():
    # formatting changed from v8 on purpose
    candidate = shutil.which("codex")
    if candidate:
        return {"name": "codex", "path": candidate}
    return None

def other():
    return 1
PY

"$SCRIPT" --patch-only "$fixture" "/home/test/.local/bin/codex" >"$TMP/out1"
grep -q '^PATCHED_AUTH_AWARE_RUNTIME_DETECTION$' "$TMP/out1" || fail "structural patch did not report PATCHED"
grep -q 'Codex is admitted only with verified ChatGPT auth' "$fixture" || fail "auth-aware marker missing"
python3 -m py_compile "$fixture" || fail "patched fixture does not compile"

fakebin="$TMP/bin"
mkdir -p "$fakebin"
cat > "$fakebin/codex" <<'FAKE'
#!/usr/bin/env bash
if [ "${1:-}" = "login" ] && [ "${2:-}" = "status" ]; then
  printf '%s\n' "${CODEX_TEST_STATUS:-Not logged in}"
  exit 0
fi
exit 1
FAKE
chmod +x "$fakebin/codex"
PATH="$fakebin:$PATH" CODEX_TEST_STATUS='Not logged in' python3 - "$fixture" <<'PYRUN' || fail "patched runtime false-positive probe errored"
import importlib.util,sys
spec=importlib.util.spec_from_file_location('fixture',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
assert m.detect_runtime() is None, m.detect_runtime()
PYRUN
PATH="$fakebin:$PATH" CODEX_TEST_STATUS='Logged in using ChatGPT' python3 - "$fixture" <<'PYRUN' || fail "patched runtime valid-auth probe failed"
import importlib.util,sys
spec=importlib.util.spec_from_file_location('fixture',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
r=m.detect_runtime(); assert r and r.get('name') == 'codex', r
PYRUN
pass "structural patch and auth behavior"

sha1="$(sha256sum "$fixture" | awk '{print $1}')"
"$SCRIPT" --patch-only "$fixture" "/home/test/.local/bin/codex" >"$TMP/out2"
sha2="$(sha256sum "$fixture" | awk '{print $1}')"
grep -q '^NO_CHANGE_AUTH_AWARE_RUNTIME_DETECTION$' "$TMP/out2" || fail "idempotent run did not report NO_CHANGE"
[ "$sha1" = "$sha2" ] || fail "idempotent run changed file"
pass "idempotence"

bad="$TMP/no-function.py"
printf 'x = 1\n' > "$bad"
before="$(sha256sum "$bad" | awk '{print $1}')"
if "$SCRIPT" --patch-only "$bad" "/home/test/.local/bin/codex" >"$TMP/out3" 2>"$TMP/err3"; then
  fail "missing detect_runtime unexpectedly succeeded"
fi
after="$(sha256sum "$bad" | awk '{print $1}')"
[ "$before" = "$after" ] || fail "failed patch mutated file"
grep -q 'EXECUTOR_DETECT_RUNTIME_FUNCTION_NOT_FOUND' "$TMP/err3" || fail "wrong missing-function error"
pass "fail-closed missing function"

pipe_fixture="$TMP/pipe-executor.py"
cat > "$pipe_fixture" <<'PY'
from pathlib import Path
import shutil, subprocess
HOME=Path.home()

def detect_runtime():
    candidate = shutil.which("codex")
    return {"name": "codex", "path": candidate} if candidate else None
PY
if ! cat "$SCRIPT" | bash -s -- --patch-only "$pipe_fixture" "/home/test/.local/bin/codex" >"$TMP/pipe-out" 2>"$TMP/pipe-err"; then
  cat "$TMP/pipe-err" >&2
  fail "piped execution failed"
fi
grep -q '^PATCHED_AUTH_AWARE_RUNTIME_DETECTION$' "$TMP/pipe-out" || fail "piped entrypoint did not execute main"
python3 -m py_compile "$pipe_fixture" || fail "piped patch produced invalid Python"
pass "pipe-to-bash entrypoint"

echo "ALL_V9_TESTS_PASS"
