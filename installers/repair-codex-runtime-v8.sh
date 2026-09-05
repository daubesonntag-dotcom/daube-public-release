#!/usr/bin/env bash
set -u
BASE="$HOME/daube-revenue-worker"
V8="$BASE/full-loop/v8"
EXECUTOR="$V8/executor.py"

# Root cause fixed here: the official installer may install Codex successfully,
# then return non-zero when its optional interactive "Start Codex now?" launch
# cannot complete in a piped/non-interactive shell. Therefore never reinstall
# before searching the locations the installer itself reported.
export PATH="$HOME/.local/bin:$HOME/bin:$PATH"
find_codex() {
  command -v codex 2>/dev/null || true
  [ -x "$HOME/.local/bin/codex" ] && printf '%s\n' "$HOME/.local/bin/codex"
  find "$HOME/.codex/packages/standalone/releases" -type f -name codex -perm -u+x 2>/dev/null | sort -V -r | head -n 1
}
CODEX_BIN="$(find_codex | awk 'NF&&!seen[$0]++{print;exit}')"
if [ -z "$CODEX_BIN" ] || [ ! -x "$CODEX_BIN" ]; then
  echo 'CODEX_BINARY_NOT_FOUND'
  exit 1
fi
mkdir -p "$HOME/.local/bin"
if [ "$CODEX_BIN" != "$HOME/.local/bin/codex" ]; then
  ln -sfn "$CODEX_BIN" "$HOME/.local/bin/codex"
  CODEX_BIN="$HOME/.local/bin/codex"
fi
echo "CODEX_BIN=$CODEX_BIN"
"$CODEX_BIN" --version || exit 1

AUTH_OUT="$("$CODEX_BIN" login status 2>&1 || true)"
printf '%s\n' "$AUTH_OUT"
if ! printf '%s' "$AUTH_OUT" | grep -Eqi 'logged in|authenticated|chatgpt'; then
  echo '=== ONE-TIME CHATGPT DEVICE AUTH ==='
  "$CODEX_BIN" login --device-auth || { echo 'CODEX_DEVICE_AUTH_NOT_COMPLETED'; exit 2; }
  AUTH_OUT="$("$CODEX_BIN" login status 2>&1 || true)"
  printf '%s\n' "$AUTH_OUT"
fi
if ! printf '%s' "$AUTH_OUT" | grep -Eqi 'logged in|authenticated|chatgpt'; then
  echo 'CODEX_AUTH_NOT_VERIFIED'; exit 2
fi
echo 'CODEX_AUTH_VERIFIED'

[ -f "$EXECUTOR" ] || { echo "EXECUTOR_NOT_FOUND=$EXECUTOR"; exit 1; }
python3 - "$EXECUTOR" "$CODEX_BIN" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); codex=sys.argv[2]; s=p.read_text()
old="""def detect_runtime():
    # Provider-neutral contract; V8 ships Codex adapter first. Never install/buy a runtime here.
    codex=shutil.which('codex')
    if codex: return {'name':'codex','path':codex}
    return None
"""
new=f"""def detect_runtime():
    # Provider-neutral contract. Codex is admitted only with verified ChatGPT auth.
    candidates=[shutil.which('codex'), {codex!r}, str(HOME/'.local/bin/codex')]
    seen=set()
    for candidate in candidates:
        if not candidate or candidate in seen: continue
        seen.add(candidate)
        if not Path(candidate).is_file(): continue
        try:
            r=subprocess.run([candidate,'login','status'],text=True,capture_output=True,timeout=20)
            out=((r.stdout or '')+' '+(r.stderr or '')).lower()
            if r.returncode==0 and ('logged in' in out or 'authenticated' in out or 'chatgpt' in out):
                return {{'name':'codex','path':candidate}}
        except Exception: continue
    return None
"""
if old in s: s=s.replace(old,new)
elif 'Codex is admitted only with verified ChatGPT auth' not in s:
    raise SystemExit('EXECUTOR_DETECT_RUNTIME_BLOCK_NOT_FOUND')
p.write_text(s)
print('PATCHED_AUTH_AWARE_RUNTIME_DETECTION')
PY
python3 -m py_compile "$EXECUTOR" || exit 1
sudo mkdir -p /etc/systemd/system/daube-freelancer-executor.service.d
sudo tee /etc/systemd/system/daube-freelancer-executor.service.d/10-codex-path.conf >/dev/null <<EOF
[Service]
Environment=PATH=$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:/bin
EOF
sudo systemctl daemon-reload
sudo systemctl restart daube-freelancer-executor.timer
sudo systemctl start daube-freelancer-executor.service || true

echo '=== CODEX RUNTIME REPAIR ==='
"$V8/run.sh" || true
echo '=== THREE TIMERS ==='
systemctl is-active daube-revenue-worker.timer || true
systemctl is-active daube-freelancer-award-watcher.timer || true
systemctl is-active daube-freelancer-executor.timer || true
