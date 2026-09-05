#!/usr/bin/env bash
set -euo pipefail

BASE="$HOME/daube-revenue-worker"
OPS="$BASE/full-loop"
V9="$OPS/v9"
ROLLBACK="$OPS/v9-rollback"
REF="${DAUBE_V9_REF:-main}"
RAW="https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/${REF}/runtime/freelancer-v9"
UNIT="/etc/systemd/system/daube-freelancer-executor.service"
TIMER="/etc/systemd/system/daube-freelancer-executor.timer"

FILES=(
  adapters.py contract.py controller.py delivery.py graph.py integration.py
  models.py planner.py qa.py red_team.py research.py run.py visual.py
  worth_money.py test_v9.py
)

command -v curl >/dev/null || { echo "V9_BLOCKED=CURL_MISSING"; exit 1; }
command -v python3 >/dev/null || { echo "V9_BLOCKED=PYTHON3_MISSING"; exit 1; }
command -v systemctl >/dev/null || { echo "V9_BLOCKED=SYSTEMD_MISSING"; exit 1; }
command -v sudo >/dev/null || { echo "V9_BLOCKED=SUDO_MISSING"; exit 1; }

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "=== V9 STAGE SOURCE ref=$REF ==="
for file in "${FILES[@]}"; do
  curl -fsSL "$RAW/$file" -o "$STAGE/$file"
done

echo "=== V9 OFFLINE VERIFICATION ==="
(
  cd "$STAGE"
  PYTHONPATH="$STAGE" python3 -m unittest -v test_v9
  python3 -m py_compile \
    adapters.py contract.py controller.py delivery.py graph.py integration.py \
    models.py planner.py qa.py red_team.py research.py run.py visual.py worth_money.py
  PYTHONPATH="$STAGE" python3 "$STAGE/run.py" --verify
)

mkdir -p "$OPS" "$ROLLBACK"
chmod 700 "$ROLLBACK"

if ! sudo test -f "$UNIT"; then
  echo "V9_BLOCKED=NO_EXECUTOR_UNIT_TO_SNAPSHOT"
  exit 1
fi
sudo cat "$UNIT" > "$ROLLBACK/daube-freelancer-executor.service.before-v9"
if sudo test -f "$TIMER"; then
  sudo cat "$TIMER" > "$ROLLBACK/daube-freelancer-executor.timer.before-v9"
fi
chmod 600 "$ROLLBACK"/* 2>/dev/null || true

PRE_REVENUE="$(systemctl is-active daube-revenue-worker.timer 2>/dev/null || true)"
PRE_AWARD="$(systemctl is-active daube-freelancer-award-watcher.timer 2>/dev/null || true)"
PRE_WATCHDOG="$(systemctl is-active daube-runtime-watchdog.timer 2>/dev/null || true)"
PRE_MONEY="$(systemctl is-active daube-freelancer-money-closure.timer 2>/dev/null || true)"

NEXT="$OPS/v9.next"
PREV="$OPS/v9.prev"
rm -rf "$NEXT"
mkdir -p "$NEXT"
chmod 700 "$NEXT"
for file in "${FILES[@]}"; do
  install -m 600 "$STAGE/$file" "$NEXT/$file"
done

cat > "$NEXT/run.sh" <<'SH'
#!/usr/bin/env bash
set -u
V9="$HOME/daube-revenue-worker/full-loop/v9"
export PYTHONPATH="$V9"
exec python3 "$V9/run.py" "$@"
SH
chmod 700 "$NEXT/run.sh"

rm -rf "$PREV"
if [ -d "$V9" ]; then
  mv "$V9" "$PREV"
fi
mv "$NEXT" "$V9"

cat > "$V9/rollback-v8.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
OPS="$HOME/daube-revenue-worker/full-loop"
ROLLBACK="$OPS/v9-rollback"
UNIT="/etc/systemd/system/daube-freelancer-executor.service"
TIMER="/etc/systemd/system/daube-freelancer-executor.timer"
test -f "$ROLLBACK/daube-freelancer-executor.service.before-v9"
sudo cp "$ROLLBACK/daube-freelancer-executor.service.before-v9" "$UNIT"
if [ -f "$ROLLBACK/daube-freelancer-executor.timer.before-v9" ]; then
  sudo cp "$ROLLBACK/daube-freelancer-executor.timer.before-v9" "$TIMER"
fi
sudo systemctl daemon-reload
sudo systemctl enable --now daube-freelancer-executor.timer
echo "ROLLBACK=RESTORED_PRE_V9_EXECUTOR"
SH
chmod 700 "$V9/rollback-v8.sh"

rollback() {
  echo "V9_ACTIVATION_FAILED=ROLLING_BACK"
  "$V9/rollback-v8.sh" || true
}

USER_NAME="$(id -un)"
sudo tee "$UNIT" >/dev/null <<EOF
[Unit]
Description=D'AUBE Freelancer Execution Mesh v9
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$USER_NAME
Environment=HOME=$HOME
Environment=PYTHONPATH=$V9
ExecStart=$V9/run.sh
Nice=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$BASE
EOF

if ! sudo test -f "$TIMER"; then
  sudo tee "$TIMER" >/dev/null <<'EOF'
[Unit]
Description=Run D'AUBE Freelancer execution mesh

[Timer]
OnBootSec=6min
OnUnitActiveSec=15min
Persistent=true
RandomizedDelaySec=45

[Install]
WantedBy=timers.target
EOF
fi

sudo systemctl daemon-reload
sudo systemctl enable --now daube-freelancer-executor.timer

if ! PYTHONPATH="$V9" python3 "$V9/run.py" --verify; then
  rollback
  exit 1
fi
if ! systemctl show -p ExecStart --value daube-freelancer-executor.service | grep -F "$V9/run.sh" >/dev/null; then
  rollback
  exit 1
fi
if ! sudo systemctl start daube-freelancer-executor.service; then
  rollback
  exit 1
fi
if [ "$(systemctl is-active daube-freelancer-executor.timer || true)" != "active" ]; then
  rollback
  exit 1
fi

check_untouched_timer() {
  local name="$1" before="$2"
  if [ "$before" = "active" ] && [ "$(systemctl is-active "$name" 2>/dev/null || true)" != "active" ]; then
    echo "V9_REGRESSION=$name"
    rollback
    exit 1
  fi
}
check_untouched_timer daube-revenue-worker.timer "$PRE_REVENUE"
check_untouched_timer daube-freelancer-award-watcher.timer "$PRE_AWARD"
check_untouched_timer daube-runtime-watchdog.timer "$PRE_WATCHDOG"
check_untouched_timer daube-freelancer-money-closure.timer "$PRE_MONEY"

echo "=== D'AUBE EXECUTION MESH V9 ==="
echo "VERSION=v9-daube-execution-mesh"
echo "SOURCE_REF=$REF"
echo "OFFLINE_TESTS=PASS"
echo "EXECUTOR_TIMER=$(systemctl is-active daube-freelancer-executor.timer || true)"
echo "EXECUTOR_ENTRYPOINT=$(systemctl show -p ExecStart --value daube-freelancer-executor.service)"
echo "ROLLBACK=$V9/rollback-v8.sh"
echo "CUTOVER=VERIFIED"
