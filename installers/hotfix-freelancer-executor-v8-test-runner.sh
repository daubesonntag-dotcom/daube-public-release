#!/usr/bin/env bash
set -u
BASE="$HOME/daube-revenue-worker"
V8="$BASE/full-loop/v8"

if [ ! -f "$V8/executor.py" ] || [ ! -f "$V8/test_executor.py" ] || [ ! -x "$V8/run.sh" ]; then
  echo "V8_FILES_MISSING"
  exit 1
fi

# Root-cause fix: unittest expects a module name from an importable cwd,
# not an absolute filesystem path converted into a dotted module name.
(
  cd "$V8" || exit 1
  PYTHONPATH="$V8" python3 -m unittest -v test_executor.py
) || { echo "V8_TESTS_FAILED"; exit 1; }

python3 -m py_compile "$V8/executor.py" || { echo "V8_COMPILE_FAILED"; exit 1; }

sudo tee /etc/systemd/system/daube-freelancer-executor.service >/dev/null <<EOF
[Unit]
Description=D'AUBE Freelancer Provider-Neutral Executor v8
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=$(id -un)
Environment=HOME=$HOME
ExecStart=$V8/run.sh
Nice=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$BASE
ReadOnlyPaths=$HOME/.config/daube/secrets $HOME/.venvs/freelancer
EOF

sudo tee /etc/systemd/system/daube-freelancer-executor.timer >/dev/null <<'EOF'
[Unit]
Description=Run D'AUBE Freelancer executor v8
[Timer]
OnBootSec=6min
OnUnitActiveSec=15min
Persistent=true
RandomizedDelaySec=45
[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now daube-freelancer-executor.timer
sudo systemctl start daube-freelancer-executor.service || true

echo "=== D'AUBE FREELANCER EXECUTOR V8 HOTFIX ==="
"$V8/run.sh" || true
echo "=== TIMERS ==="
systemctl is-active daube-revenue-worker.timer || true
systemctl is-active daube-freelancer-award-watcher.timer || true
systemctl is-active daube-freelancer-executor.timer || true
systemctl --no-pager list-timers daube-revenue-worker.timer daube-freelancer-award-watcher.timer daube-freelancer-executor.timer || true
