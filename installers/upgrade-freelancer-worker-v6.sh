#!/usr/bin/env bash
set -u

BASE="$HOME/daube-revenue-worker"
WORKER="$BASE/worker.py"

if [ ! -f "$WORKER" ]; then
  echo "ERROR: $WORKER not found; install v5 first."
  exit 1
fi

python3 - "$WORKER" <<'PY'
from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text()

if 'VERSION="v5-scope-safe-autobid"' not in s and 'VERSION="v6-currency-equivalent-autobid"' not in s:
    raise SystemExit("ERROR: unexpected worker version; refusing blind patch")

s = s.replace('VERSION="v5-scope-safe-autobid"', 'VERSION="v6-currency-equivalent-autobid"')
s = s.replace('"User-Agent":"D-AUBE-Revenue-Worker/5.0"', '"User-Agent":"D-AUBE-Revenue-Worker/6.0"')

old = '''    usd_guard=(currency=="USD" and 25<=lo<=hi<=1000 and hi>=80)\n    if usd_guard: score+=8; reasons.append("usd_budget_guard")\n    else: reasons.append("manual_budget_currency_gate")\n'''
new = '''    cur_obj=p.get("currency") or {}\n    try: fx=float(cur_obj.get("exchange_rate") or 0)\n    except Exception: fx=0\n    if currency=="USD": fx=1.0\n    # Freelancer currency.exchange_rate is used as local currency units per USD.\n    # Fail closed when it is absent or nonsensical.\n    currency_guard=False\n    lo_usd=hi_usd=0.0\n    if 0 < fx < 100000:\n        lo_usd=lo/fx; hi_usd=hi/fx\n        currency_guard=(hi_usd>=25 and lo_usd<=1000 and hi_usd<=1000)\n    if currency_guard:\n        score+=8; reasons.append(f"currency_equivalent_guard:{currency}:{fx:.6g}:{lo_usd:.2f}-{hi_usd:.2f}USD")\n    else:\n        reasons.append(f"manual_budget_currency_gate:{currency}:fx={fx}")\n'''
if old not in s and 'currency_equivalent_guard' not in s:
    raise SystemExit("ERROR: budget gate block not found; refusing partial patch")
s = s.replace(old, new)

old2 = '''    auto_credible=payment or history>=1\n    return max(0,min(score,100)),reasons,skills,hours,(usd_guard and auto_credible and safe_shape)\n'''
new2 = '''    auto_credible=payment or history>=1\n    return max(0,min(score,100)),reasons,skills,hours,(currency_guard and auto_credible and safe_shape)\n'''
if old2 not in s and '(currency_guard and auto_credible and safe_shape)' not in s:
    raise SystemExit("ERROR: auto credibility gate block not found; refusing partial patch")
s = s.replace(old2, new2)

old3 = '''    for c in sorted(qualified,key=lambda x:x["score"],reverse=True)[:12]: print(c["score"],c["decision"],c["project_id"],c["title"],c["url"])\n'''
new3 = '''    for c in sorted(qualified,key=lambda x:x["score"],reverse=True)[:12]:\n        print(c["score"],c["decision"],c["project_id"],c["title"],c["url"],"GATES=",",".join(c["reasons"]))\n'''
s = s.replace(old3, new3)

p.write_text(s)
print("PATCHED", p)
PY

sudo systemctl daemon-reload
sudo systemctl restart daube-revenue-worker.timer
sudo systemctl start daube-revenue-worker.service || true

echo "=== D'AUBE FREELANCER WORKER V6 ==="
"$BASE/run.sh" || true
echo "=== TIMER ==="
systemctl is-active daube-revenue-worker.timer || true
systemctl --no-pager list-timers daube-revenue-worker.timer || true

echo "=== RECEIPTS ==="
find "$BASE/receipts" -maxdepth 1 -type f -name '*.json' -printf '%f\n' 2>/dev/null | tail -n 10 || true
