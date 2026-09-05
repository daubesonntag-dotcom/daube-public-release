#!/usr/bin/env bash
set -u
BASE="$HOME/daube-revenue-worker"
V8="$BASE/full-loop/v8"
EXECUTOR="$V8/executor.py"
mkdir -p "$HOME/.local/bin"

find_codex() {
  command -v codex 2>/dev/null || true
  [ -x "$HOME/.local/bin/codex" ] && printf '%s\n' "$HOME/.local/bin/codex"
  [ -x "$HOME/bin/codex" ] && printf '%s\n' "$HOME/bin/codex"
}

CODEX_BIN="$(find_codex | head -n1)"
if [ -z "$CODEX_BIN" ]; then
  echo "=== INSTALLING CODEX CLI FROM OFFICIAL OPENAI INSTALLER ==="
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  curl -fsSL https://chatgpt.com/codex/install.sh -o "$tmp" || { echo 'CODEX_INSTALLER_DOWNLOAD_FAILED'; exit 1; }
  sh "$tmp" || { echo 'CODEX_INSTALL_FAILED'; exit 1; }
  export PATH="$HOME/.local/bin:$HOME/bin:$PATH"
  CODEX_BIN="$(find_codex | head -n1)"
fi

if [ -z "$CODEX_BIN" ] || [ ! -x "$CODEX_BIN" ]; then
  echo "CODEX_BINARY_NOT_FOUND_AFTER_INSTALL"
  exit 1
fi

echo "CODEX_BIN=$CODEX_BIN"
"$CODEX_BIN" --version || exit 1

AUTH_OUT="$("$CODEX_BIN" login status 2>&1 || true)"
printf '%s\n' "$AUTH_OUT"
if ! printf '%s' "$AUTH_OUT" | grep -Eqi 'logged in|authenticated|chatgpt'; then
  echo
  echo "=== ONE-TIME CHATGPT DEVICE AUTH REQUIRED ==="
  echo "Open the URL/code shown below in your browser. This uses ChatGPT login; no API key is requested."
  "$CODEX_BIN" login --device-auth || { echo 'CODEX_DEVICE_AUTH_NOT_COMPLETED'; exit 2; }
  AUTH_OUT="$("$CODEX_BIN" login status 2>&1 || true)"
fi

if ! printf '%s' "$AUTH_OUT" | grep -Eqi 'logged in|authenticated|chatgpt'; then
  echo "CODEX_AUTH_NOT_VERIFIED"
  exit 2
fi

echo "CODEX_AUTH_VERIFIED"

if [ ! -f "$EXECUTOR" ]; then
  echo "EXECUTOR_NOT_FOUND=$EXECUTOR"
  exit 1
fi

python3 - "$EXECUTOR" "$CODEX_BIN" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); codex=sys.argv[2]; s=p.read_text()
old="""def detect_runtime():\n    # Provider-neutral contract; V8 ships Codex adapter first. Never install/buy a runtime here.\n    codex=shutil.which('codex')\n    if codex: return {'name':'codex','path':codex}\n    return None\n"""
new=f"""def detect_runtime():\n    # Provider-neutral contract. Codex is admitted only with verified ChatGPT auth.\n    candidates=[shutil.which('codex'), {codex!r}, str(HOME/'.local/bin/codex'), str(HOME/'bin/codex')]\n    seen=set()\n    for candidate in candidates:\n        if not candidate or candidate in seen: continue\n        seen.add(candidate)\n        if not Path(candidate).is_file(): continue\n        try:\n            r=subprocess.run([candidate,'login','status'],text=True,capture_output=True,timeout=20)\n            out=((r.stdout or '')+' '+(r.stderr or '')).lower()\n            if r.returncode==0 and ('logged in' in out or 'authenticated' in out or 'chatgpt' in out):\n                return {{'name':'codex','path':candidate}}\n        except Exception:\n            continue\n    return None\n"""
if old in s:
    s=s.replace(old,new)
elif "Codex is admitted only with verified ChatGPT auth" not in s:
    raise SystemExit('EXECUTOR_DETECT_RUNTIME_BLOCK_NOT_FOUND')
p.write_text(s)
print('PATCHED_AUTH_AWARE_RUNTIME_DETECTION')
PY

python3 -m py_compile "$EXECUTOR" || exit 1

# Persist user-local CLI path for non-interactive systemd runs.
sudo mkdir -p /etc/systemd/system/daube-freelancer-executor.service.d
sudo tee /etc/systemd/system/daube-freelancer-executor.service.d/10-codex-path.conf >/dev/null <<EOF
[Service]
Environment=PATH=$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:/bin
EOF
sudo systemctl daemon-reload
sudo systemctl restart daube-freelancer-executor.timer
sudo systemctl start daube-freelancer-executor.service || true

echo "=== CODEX RUNTIME BINDING ==="
"$V8/run.sh" || true
echo "=== EXECUTOR TIMER ==="
systemctl is-active daube-freelancer-executor.timer || true
systemctl --no-pager list-timers daube-freelancer-executor.timer || true
