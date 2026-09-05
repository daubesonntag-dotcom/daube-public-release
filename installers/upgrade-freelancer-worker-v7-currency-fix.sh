#!/usr/bin/env bash
set -u

BASE="$HOME/daube-revenue-worker"
WORKER="$BASE/worker.py"
STATE="$BASE/state.json"
VENV="$HOME/.venvs/freelancer"
TARGET_VERSION="v7-currency-multiply-autobid"

patch_worker() {
  local worker="$1"
  python3 - "$worker" "$TARGET_VERSION" <<'PY'
from pathlib import Path
import sys

p=Path(sys.argv[1]); target=sys.argv[2]
s=p.read_text()

if f'VERSION="{target}"' in s and 'lo_usd=lo*fx; hi_usd=hi*fx' in s:
    print('NO_CHANGE_CURRENCY_CONVERSION_V7')
    raise SystemExit(0)

allowed=(
    'VERSION="v6-currency-equivalent-autobid"',
    'VERSION="v5-scope-safe-autobid"',
)
if not any(x in s for x in allowed):
    print('UNEXPECTED_WORKER_VERSION', file=sys.stderr)
    raise SystemExit(3)

old='lo_usd=lo/fx; hi_usd=hi/fx'
if old not in s:
    print('CURRENCY_DIVIDE_FORMULA_NOT_FOUND', file=sys.stderr)
    raise SystemExit(4)

s=s.replace('VERSION="v6-currency-equivalent-autobid"', f'VERSION="{target}"', 1)
s=s.replace('VERSION="v5-scope-safe-autobid"', f'VERSION="{target}"', 1)
s=s.replace(
    '# Freelancer currency.exchange_rate is used as local currency units per USD.',
    '# DAUBE_CURRENCY_CONVERSION_V7: Freelancer exchange_rate is USD value per 1 local currency unit.',
    1,
)
s=s.replace(old, 'lo_usd=lo*fx; hi_usd=hi*fx', 1)
p.write_text(s)
print('PATCHED_CURRENCY_CONVERSION_V7')
PY
}

migrate_state() {
  local state="$1"
  python3 - "$state" "$TARGET_VERSION" <<'PY'
from pathlib import Path
import json, os, sys

p=Path(sys.argv[1]); target=sys.argv[2]
if not p.exists():
    print('STATE_NOT_PRESENT')
    raise SystemExit(0)
try:
    x=json.loads(p.read_text())
except Exception:
    print('STATE_INVALID_JSON', file=sys.stderr)
    raise SystemExit(5)
if not isinstance(x, dict):
    print('STATE_NOT_OBJECT', file=sys.stderr)
    raise SystemExit(6)
x['version']=target
tmp=p.with_suffix(p.suffix+'.v7tmp')
tmp.write_text(json.dumps(x,indent=2)+'\n')
os.replace(tmp,p)
print('STATE_MIGRATED_PRESERVING_HISTORY')
PY
}

restore_worker() {
  local backup="$1"
  if [ -f "$backup" ]; then
    cp -p "$backup" "$WORKER"
    echo "WORKER_RESTORED_FROM_BACKUP"
  fi
}

main() {
  if [ "${1:-}" = "--patch-only" ]; then
    [ "$#" -eq 2 ] || { echo "USAGE: --patch-only WORKER" >&2; return 64; }
    patch_worker "$2"
    return $?
  fi

  if [ "${1:-}" = "--migrate-state-only" ]; then
    [ "$#" -eq 2 ] || { echo "USAGE: --migrate-state-only STATE" >&2; return 64; }
    migrate_state "$2"
    return $?
  fi

  [ -f "$WORKER" ] || { echo "ERROR worker missing: $WORKER"; return 1; }
  [ -x "$VENV/bin/python" ] || { echo "ERROR Freelancer venv missing: $VENV"; return 1; }

  echo "=== D'AUBE FREELANCER WORKER V7 CURRENCY FIX ==="

  local timer_was_active=0 backup patch_out
  if systemctl is-active --quiet daube-revenue-worker.timer 2>/dev/null; then
    timer_was_active=1
  fi

  sudo systemctl stop daube-revenue-worker.timer || return 1

  for i in $(seq 1 30); do
    systemctl is-active --quiet daube-revenue-worker.service 2>/dev/null || break
    sleep 2
  done
  if systemctl is-active --quiet daube-revenue-worker.service 2>/dev/null; then
    echo "ERROR revenue worker did not become idle"
    [ "$timer_was_active" = "1" ] && sudo systemctl start daube-revenue-worker.timer || true
    return 1
  fi

  backup="${WORKER}.v7-backup.$(date -u +%Y%m%dT%H%M%SZ).$$"
  cp -p "$WORKER" "$backup" || {
    [ "$timer_was_active" = "1" ] && sudo systemctl start daube-revenue-worker.timer || true
    echo "ERROR backup failed"
    return 1
  }

  if ! patch_out="$(patch_worker "$WORKER" 2>&1)"; then
    printf '%s\n' "$patch_out" >&2
    restore_worker "$backup"
    [ "$timer_was_active" = "1" ] && sudo systemctl start daube-revenue-worker.timer || true
    return 1
  fi
  printf '%s\n' "$patch_out"

  if ! python3 -m py_compile "$WORKER"; then
    echo "ERROR worker compile failed"
    restore_worker "$backup"
    [ "$timer_was_active" = "1" ] && sudo systemctl start daube-revenue-worker.timer || true
    return 1
  fi

  if ! grep -q 'VERSION="v7-currency-multiply-autobid"' "$WORKER" \
     || ! grep -q 'lo_usd=lo\*fx; hi_usd=hi\*fx' "$WORKER"; then
    echo "ERROR currency fix verification failed"
    restore_worker "$backup"
    [ "$timer_was_active" = "1" ] && sudo systemctl start daube-revenue-worker.timer || true
    return 1
  fi

  if ! migrate_state "$STATE"; then
    echo "ERROR state migration failed"
    restore_worker "$backup"
    [ "$timer_was_active" = "1" ] && sudo systemctl start daube-revenue-worker.timer || true
    return 1
  fi

  rm -f "$backup"
  echo "WORKER_VERIFY_PASS"

  sudo systemctl daemon-reload || true
  sudo systemctl enable --now daube-revenue-worker.timer || return 1

  echo "=== RUN ONE REVENUE CYCLE ==="
  sudo systemctl start daube-revenue-worker.service || true

  echo "=== CURRENT CYCLE SUMMARY ==="
  sudo journalctl -u daube-revenue-worker.service -n 80 --no-pager 2>/dev/null \
    | grep -E 'VERSION=|SCANNED=|QUALIFIED=|AUTO_READY=|SUBMITTED=|BID_FAIL|SUBMITTED ' \
    | tail -30 || true

  echo "=== RECEIPTS ==="
  find "$BASE/receipts" -maxdepth 1 -type f -name '*.json' -printf '%T@ %p\n' 2>/dev/null \
    | sort -nr | head -10 || true

  echo "=== TIMER ==="
  systemctl is-active daube-revenue-worker.timer || true
  echo "V7_CURRENCY_FIX=PASS"
}

main "$@"
