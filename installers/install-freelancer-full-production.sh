#!/usr/bin/env bash
set -u

WATCHDOG_SHA="a66f13a19180564ba2913f649c1f97bfbdd1ed78"
CLOSURE_SHA="115fb5bc5bbfcdeda8d0416a40c4674091df135f"
ROOT="https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release"

echo '=== INSTALL WATCHDOG ==='
curl -fsSL "$ROOT/$WATCHDOG_SHA/installers/install-runtime-watchdog-v1.sh" | bash || { echo WATCHDOG_INSTALL_FAILED; exit 1; }

echo '=== INSTALL MONEY CLOSURE ==='
curl -fsSL "$ROOT/$CLOSURE_SHA/installers/install-freelancer-money-closure-v1.sh" | bash || { echo MONEY_CLOSURE_INSTALL_FAILED; exit 1; }

echo '=== VERIFY FIVE TIMERS ==='
failed=0
for t in \
  daube-revenue-worker.timer \
  daube-freelancer-award-watcher.timer \
  daube-freelancer-executor.timer \
  daube-runtime-watchdog.timer \
  daube-freelancer-money-closure.timer
 do
  s="$(systemctl is-active "$t" 2>/dev/null || true)"
  printf '%-44s %s\n' "$t" "$s"
  [ "$s" = active ] || failed=1
 done

echo '=== RUN WATCHDOG NOW ==='
"$HOME/daube-revenue-worker/watchdog/run.sh" || true

echo '=== RUN MONEY CLOSURE NOW ==='
"$HOME/daube-revenue-worker/full-loop/money-closure/run.sh" || true

echo '=== CURRENT REVENUE EVIDENCE ==='
ledger="$HOME/daube-revenue-worker/full-loop/money-closure/revenue-ledger.jsonl"
if [ -s "$ledger" ]; then tail -n 10 "$ledger"; else echo 'NO_SETTLED_REVENUE_EVIDENCE_YET'; fi

if [ "$failed" -ne 0 ]; then
  echo 'FULL_PRODUCTION_VERIFY_FAILED'
  exit 1
fi

echo 'FULL_PRODUCTION_TIMERS_ACTIVE'
