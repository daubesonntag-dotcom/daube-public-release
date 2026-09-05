#!/usr/bin/env bash
set -u
BASE="$HOME/daube-revenue-worker"
V8="$BASE/full-loop/v8"
EXECUTOR="$V8/executor.py"
CODEX_BIN="$HOME/.local/bin/codex"

[ -x "$CODEX_BIN" ] || { echo "CODEX_BINARY_NOT_FOUND=$CODEX_BIN"; exit 1; }
[ -f "$EXECUTOR" ] || { echo "EXECUTOR_NOT_FOUND=$EXECUTOR"; exit 1; }

is_auth_ok() {
  out="$1"
  low="$(printf '%s' "$out" | tr '[:upper:]' '[:lower:]')"
  case "$low" in
    *"not logged in"*|*"not authenticated"*|*"logged out"*) return 1 ;;
  esac
  printf '%s' "$low" | grep -Eq '(^|[^a-z])(logged in|authenticated)([^a-z]|$)|chatgpt account'
}

AUTH_OUT="$("$CODEX_BIN" login status 2>&1 || true)"
printf '%s\n' "$AUTH_OUT"
if ! is_auth_ok "$AUTH_OUT"; then
  echo "=== ONE-TIME CHATGPT DEVICE AUTH REQUIRED ==="
  "$CODEX_BIN" login --device-auth || { echo 'CODEX_DEVICE_AUTH_NOT_COMPLETED'; exit 2; }
  AUTH_OUT="$("$CODEX_BIN" login status 2>&1 || true)"
  printf '%s\n' "$AUTH_OUT"
fi
if ! is_auth_ok "$AUTH_OUT"; then
  echo 'CODEX_AUTH_NOT_VERIFIED'; exit 2
fi
echo 'CODEX_AUTH_VERIFIED'

python3 - "$EXECUTOR" "$CODEX_BIN" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); codex=sys.argv[2]; s=p.read_text()
start=s.index('def detect_runtime():')
end=s.index('\ndef required_input_missing', start)
new=f'''def detect_runtime():
    # Codex is admitted only after a positive auth status. Explicit negative
    # statuses such as "Not logged in" must never match the positive phrase.
    candidates=[shutil.which('codex'), {codex!r}, str(HOME/'.local/bin/codex')]
    seen=set()
    for candidate in candidates:
        if not candidate or candidate in seen: continue
        seen.add(candidate)
        if not Path(candidate).is_file(): continue
        try:
            r=subprocess.run([candidate,'login','status'],text=True,capture_output=True,timeout=20)
            out=((r.stdout or '')+' '+(r.stderr or '')).strip().lower()
            negative=('not logged in' in out or 'not authenticated' in out or 'logged out' in out)
            positive=('logged in' in out or 'authenticated' in out or 'chatgpt account' in out)
            if r.returncode==0 and positive and not negative:
                return {{'name':'codex','path':candidate}}
        except Exception:
            continue
    return None
'''
s=s[:start]+new+s[end:]
p.write_text(s)
print('PATCHED_STRICT_CODEX_AUTH_DETECTION')
PY

python3 -m py_compile "$EXECUTOR" || exit 1
sudo systemctl daemon-reload
sudo systemctl restart daube-freelancer-executor.timer
sudo systemctl start daube-freelancer-executor.service || true

echo '=== CODEX AUTH FIX V8 ==='
"$V8/run.sh" || true
echo '=== THREE TIMERS ==='
systemctl is-active daube-revenue-worker.timer || true
systemctl is-active daube-freelancer-award-watcher.timer || true
systemctl is-active daube-freelancer-executor.timer || true
