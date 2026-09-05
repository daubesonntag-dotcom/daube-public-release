#!/usr/bin/env bash
set -u

BASE="$HOME/daube-revenue-worker"
V8="$BASE/full-loop/v8"
EXECUTOR="$V8/executor.py"

lower_text() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

auth_status_ok() {
  local text lowered
  text="${1:-}"
  lowered="$(lower_text "$text")"
  case "$lowered" in
    *"not logged in"*|*"not authenticated"*|*"logged out"*|*"authentication required"*|*"sign in required"*) return 1 ;;
  esac
  case "$lowered" in
    *"logged in using chatgpt"*|*"logged in"*|*"authenticated"*|*"chatgpt"*) return 0 ;;
  esac
  return 1
}

patch_executor() {
  local executor="$1" codex_bin="$2"
  python3 - "$executor" "$codex_bin" <<'PY'
import ast
from pathlib import Path
import sys

path = Path(sys.argv[1])
codex = sys.argv[2]
source = path.read_text()
tree = ast.parse(source)
functions = [
    node for node in tree.body
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == 'detect_runtime'
]
if len(functions) != 1:
    print('EXECUTOR_DETECT_RUNTIME_FUNCTION_NOT_FOUND', file=sys.stderr)
    raise SystemExit(3)
node = functions[0]
lines = source.splitlines(keepends=True)
start = node.lineno - 1
end = node.end_lineno
segment = ''.join(lines[start:end])
if 'DAUBE_CODEX_RUNTIME_V9' in segment:
    print('NO_CHANGE_AUTH_AWARE_RUNTIME_DETECTION')
    raise SystemExit(0)
replacement = f'''def detect_runtime():
    # Provider-neutral contract. DAUBE_CODEX_RUNTIME_V9: Codex is admitted only with verified ChatGPT auth.
    candidates=[shutil.which('codex'), {codex!r}, str(HOME/'.local/bin/codex')]
    seen=set()
    negative=('not logged in','not authenticated','logged out','authentication required','sign in required')
    positive=('logged in using chatgpt','logged in','authenticated','chatgpt')
    for candidate in candidates:
        if not candidate or candidate in seen: continue
        seen.add(candidate)
        if not Path(candidate).is_file(): continue
        try:
            r=subprocess.run([candidate,'login','status'],text=True,capture_output=True,timeout=20)
            out=((r.stdout or '')+' '+(r.stderr or '')).lower()
            if r.returncode != 0: continue
            if any(marker in out for marker in negative): continue
            if any(marker in out for marker in positive):
                return {{'name':'codex','path':candidate}}
        except Exception: continue
    return None
'''
updated = ''.join(lines[:start]) + replacement + ''.join(lines[end:])
ast.parse(updated)
path.write_text(updated)
print('PATCHED_AUTH_AWARE_RUNTIME_DETECTION')
PY
}

find_codex() {
  command -v codex 2>/dev/null || true
  [ -x "$HOME/.local/bin/codex" ] && printf '%s\n' "$HOME/.local/bin/codex"
  find "$HOME/.codex/packages/standalone/releases" -type f -name codex -perm -u+x 2>/dev/null | sort -V -r | head -n 1
}

restore_executor() {
  local backup="$1"
  if [ -f "$backup" ]; then
    cp -p "$backup" "$EXECUTOR"
    echo 'EXECUTOR_RESTORED_FROM_BACKUP'
  fi
}

main() {
  if [ "${1:-}" = "--patch-only" ]; then
    [ "$#" -eq 3 ] || { echo 'USAGE: --patch-only EXECUTOR CODEX_BIN' >&2; return 64; }
    patch_executor "$2" "$3"
    return $?
  fi

  export PATH="$HOME/.local/bin:$HOME/bin:$PATH"
  local codex_bin auth_out auth_rc backup patch_out tests_rc=0 jobs=0 runtime='NONE'
  codex_bin="$(find_codex | awk 'NF&&!seen[$0]++{print;exit}')"
  if [ -z "$codex_bin" ] || [ ! -x "$codex_bin" ]; then
    echo 'CODEX_BINARY_NOT_FOUND'
    return 1
  fi
  mkdir -p "$HOME/.local/bin"
  if [ "$codex_bin" != "$HOME/.local/bin/codex" ]; then
    ln -sfn "$codex_bin" "$HOME/.local/bin/codex"
    codex_bin="$HOME/.local/bin/codex"
  fi
  echo "CODEX_BIN=$codex_bin"
  "$codex_bin" --version || return 1

  auth_out="$("$codex_bin" login status 2>&1)"; auth_rc=$?
  printf '%s\n' "$auth_out"
  if [ "$auth_rc" -ne 0 ] || ! auth_status_ok "$auth_out"; then
    echo '=== ONE-TIME CHATGPT DEVICE AUTH ==='
    "$codex_bin" login --device-auth || { echo 'CODEX_DEVICE_AUTH_NOT_COMPLETED'; return 2; }
    auth_out="$("$codex_bin" login status 2>&1)"; auth_rc=$?
    printf '%s\n' "$auth_out"
  fi
  if [ "$auth_rc" -ne 0 ] || ! auth_status_ok "$auth_out"; then
    echo 'CODEX_AUTH_NOT_VERIFIED'
    return 2
  fi
  echo 'CODEX_AUTH_VERIFIED'

  [ -f "$EXECUTOR" ] || { echo "EXECUTOR_NOT_FOUND=$EXECUTOR"; return 1; }
  backup="${EXECUTOR}.v9-backup.$(date -u +%Y%m%dT%H%M%SZ).$$"
  cp -p "$EXECUTOR" "$backup" || { echo 'EXECUTOR_BACKUP_FAILED'; return 1; }

  if ! patch_out="$(patch_executor "$EXECUTOR" "$codex_bin" 2>&1)"; then
    printf '%s\n' "$patch_out" >&2
    restore_executor "$backup"
    return 1
  fi
  printf '%s\n' "$patch_out"

  if ! python3 -m py_compile "$EXECUTOR"; then
    echo 'EXECUTOR_PY_COMPILE_FAILED'
    restore_executor "$backup"
    return 1
  fi
  if [ -f "$V8/test_executor.py" ]; then
    PYTHONPATH="$V8" python3 -m unittest -v "$V8/test_executor.py" || tests_rc=$?
    if [ "$tests_rc" -ne 0 ]; then
      echo 'V8_TESTS_FAILED'
      restore_executor "$backup"
      return 1
    fi
  fi
  rm -f "$backup"
  echo 'EXECUTOR_VERIFY_PASS'

  sudo mkdir -p /etc/systemd/system/daube-freelancer-executor.service.d || return 1
  sudo tee /etc/systemd/system/daube-freelancer-executor.service.d/10-codex-path.conf >/dev/null <<EOF
[Service]
Environment=PATH=$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:/bin
EOF
  sudo systemctl daemon-reload || return 1
  sudo systemctl restart daube-freelancer-executor.timer || return 1
  sudo systemctl start daube-freelancer-executor.service || true

  echo '=== CODEX RUNTIME V9 ==='
  "$V8/run.sh" || true
  if [ -d "$BASE/full-loop/jobs" ]; then
    jobs="$(find "$BASE/full-loop/jobs" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
  fi
  if PYTHONPATH="$V8" python3 - <<'PY' >/tmp/daube-v9-runtime.$$ 2>/dev/null
import executor
r=executor.detect_runtime()
print((r or {}).get('name','NONE'))
PY
  then
    runtime="$(cat /tmp/daube-v9-runtime.$$ 2>/dev/null || printf 'NONE')"
  fi
  rm -f /tmp/daube-v9-runtime.$$ 2>/dev/null || true

  echo '=== THREE TIMERS ==='
  systemctl is-active daube-revenue-worker.timer || true
  systemctl is-active daube-freelancer-award-watcher.timer || true
  systemctl is-active daube-freelancer-executor.timer || true
  echo "AUTH=PASS"
  echo "RUNTIME=$runtime"
  echo "JOBS=$jobs"
  echo 'V9=PASS'
}

_daube_source="${BASH_SOURCE[0]-}"
if [ -z "$_daube_source" ] || [ "$_daube_source" = "$0" ]; then
  main "$@"
fi
unset _daube_source
