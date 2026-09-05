#!/usr/bin/env bash
set -u

BASE="$HOME/daube-revenue-worker"
TOKEN_FILE="$HOME/.config/daube/secrets/freelancer.token"
VENV="$HOME/.venvs/freelancer"

mkdir -p "$BASE" "$BASE/receipts" "$BASE/packets"
chmod 700 "$BASE" "$BASE/receipts" "$BASE/packets"

if [ ! -r "$TOKEN_FILE" ]; then
  echo "❌ Missing token file: $TOKEN_FILE"
  exit 0
fi
if [ ! -x "$VENV/bin/python" ]; then
  echo "❌ Missing Freelancer venv: $VENV"
  exit 0
fi

cat > "$BASE/worker.py" <<'PY'
import json, time
from datetime import datetime, timezone
from pathlib import Path
import requests

from freelancersdk.session import Session
from freelancersdk.resources.projects.projects import search_projects, get_projects
from freelancersdk.resources.projects.helpers import (
    create_search_projects_filter,
    create_get_projects_object,
    create_get_projects_project_details_object,
    create_get_projects_user_details_object,
)

VERSION = "v3-full-detail-autobid"
HOME = Path.home()
BASE = HOME / "daube-revenue-worker"
TOKEN_FILE = HOME / ".config/daube/secrets/freelancer.token"
STATE_FILE = BASE / "state.json"
LOG_FILE = BASE / "opportunities.jsonl"
PACKET_DIR = BASE / "packets"
RECEIPT_DIR = BASE / "receipts"
URL = "https://www.freelancer.com"
AUTO_BID_THRESHOLD = 90
MAX_AUTO_BIDS_PER_RUN = 2
MAX_AUTO_BIDS_PER_DAY = 6

QUERIES = [
    "React TypeScript", "Next.js", "API integration", "AI chatbot",
    "LLM integration", "RAG", "automation", "n8n", "web testing",
    "QA website", "FastAPI", "small website fix", "Google API integration"
]
GOOD = {
    "react", "typescript", "javascript", "next.js", "nextjs", "api", "rest",
    "automation", "n8n", "make.com", "chatbot", "openai", "llm", "rag",
    "python", "fastapi", "qa", "testing", "ux", "website", "frontend",
    "full stack", "full-stack", "google api", "webhook", "integration"
}
BLOCKED = {
    "trading", "forex", "crypto bot", "betting", "gambling", "casino",
    "medical diagnosis", "legal advice", "adult", "on-site", "onsite",
    "tallyprime", "sap training", "dynamics training", "scraping captcha",
    "bypass captcha", "mass account", "fake review"
}
HUGE = {
    "complete platform", "full platform", "marketplace", "fleet management",
    "multi-tenant", "payment gateway", "admin dashboard", "erp", "crm",
    "native ios", "native android", "entire application", "from scratch"
}

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def load_state():
    try:
        s = json.loads(STATE_FILE.read_text())
    except Exception:
        s = {}
    if s.get("version") != VERSION:
        return {"version": VERSION, "seen": [], "submitted": [], "daily": {}}
    return s

def save_state(s):
    s["version"] = VERSION
    STATE_FILE.write_text(json.dumps(s, indent=2) + "\n")

def token():
    return TOKEN_FILE.read_text().strip()

def headers(json_body=False):
    h = {
        "Freelancer-OAuth-V1": token(),
        "Accept": "application/json",
        "User-Agent": "D-AUBE-Revenue-Worker/3.0",
    }
    if json_body:
        h["Content-Type"] = "application/json"
    return h

def self_id():
    r = requests.get(f"{URL}/api/users/0.1/self/", headers=headers(), timeout=20)
    r.raise_for_status()
    uid = int(r.json()["result"]["id"])
    if uid <= 0:
        raise RuntimeError("FREELANCER_SELF_ID_MISSING")
    return uid

def nested_truthy(obj, keys):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if str(k).lower() in keys and v in (True, 1, "true", "verified"):
                return True
            if nested_truthy(v, keys):
                return True
    elif isinstance(obj, list):
        return any(nested_truthy(v, keys) for v in obj)
    return False

def nested_positive_count(obj, keys):
    best = 0
    if isinstance(obj, dict):
        for k, v in obj.items():
            if str(k).lower() in keys and isinstance(v, (int, float)):
                best = max(best, int(v))
            best = max(best, nested_positive_count(v, keys))
    elif isinstance(obj, list):
        for v in obj:
            best = max(best, nested_positive_count(v, keys))
    return best

def detail_batch(session, ids):
    q = create_get_projects_object(
        project_ids=ids,
        project_details=create_get_projects_project_details_object(
            full_description=True, jobs=True, qualifications=True,
        ),
        user_details=create_get_projects_user_details_object(
            basic=True, profile_description=True, reputation=True,
        ),
    )
    return get_projects(session, q)

def user_for(result, p):
    owner = p.get("owner_id") or p.get("owner")
    users = result.get("users") or {}
    if isinstance(users, dict):
        return users.get(str(owner)) or users.get(owner) or {}
    if isinstance(users, list):
        for u in users:
            if str(u.get("id")) == str(owner):
                return u
    return {}

def score_project(p, user):
    title = (p.get("title") or "").strip()
    desc = (p.get("description") or "").strip()
    jobs = p.get("jobs") or []
    skills = [str(j.get("name", "")).strip() for j in jobs if isinstance(j, dict)]
    text = (title + " " + desc + " " + " ".join(skills)).lower()
    reasons = []

    if any(x in text for x in BLOCKED):
        return 0, ["risk_or_mismatch"], skills, 0
    if (p.get("type") or "").lower() != "fixed":
        return 0, ["not_fixed_price"], skills, 0
    if (p.get("status") or "").lower() != "active":
        return 0, ["not_active"], skills, 0

    currency = (p.get("currency") or {}).get("code") or ""
    budget = p.get("budget") or {}
    try:
        minimum = float(budget.get("minimum") or 0)
        maximum = float(budget.get("maximum") or 0)
    except Exception:
        minimum = maximum = 0

    score = 35
    hits = sorted({x for x in GOOD if x in text})
    score += min(len(hits) * 7, 35)
    reasons.append(f"capability_hits={len(hits)}")

    if 100 <= len(desc) <= 4500:
        score += 8
        reasons.append("bounded_description")
    elif len(desc) > 7000:
        score -= 25
        reasons.append("oversized_spec")

    huge_hits = sum(1 for x in HUGE if x in text)
    if huge_hits >= 3:
        score -= 35
        reasons.append("scope_too_large")
    elif huge_hits == 2:
        score -= 20
        reasons.append("scope_large")
    elif huge_hits == 1:
        score -= 8
        reasons.append("scope_watch")

    if currency == "USD" and 80 <= maximum <= 1000 and maximum >= minimum >= 25:
        score += 10
        reasons.append("usd_budget_guard")
    else:
        reasons.append("manual_currency_or_budget_gate")

    if nested_truthy(user, {"payment_verified", "payment_verified_status", "verified_payment"}):
        score += 5
        reasons.append("payment_verified")
    reviews = nested_positive_count(user.get("reputation", user), {"reviews", "review_count", "reviews_count", "completed_projects", "project_count"})
    if reviews > 0:
        score += 4
        reasons.append("client_history")

    estimated_hours = 24
    if len(desc) > 2500 or huge_hits == 1:
        estimated_hours = 48
    if len(desc) > 4500 or huge_hits >= 2:
        estimated_hours = 96

    return max(0, min(score, 100)), reasons, skills, estimated_hours

def proposal(p, skills, hours):
    title = (p.get("title") or "your project").strip()
    focus = ", ".join(skills[:5]) if skills else "the requested web/API scope"
    days = 2 if hours <= 48 else 3
    return (
        f"Hi — I reviewed the scope for {title}. The strongest fit on my side is {focus}. "
        "I would start by freezing the acceptance criteria, reproduce or map the current workflow, "
        "then implement the smallest production-ready slice with explicit error handling and evidence-based QA. "
        f"For this bounded scope I can target a {days}-day delivery, including implementation, verification, "
        "and a concise handoff. Relevant evidence I can provide is D’AUBE-owned product/system work; I will not "
        "represent internal work as past client work. If the repository or credentials reveal an undisclosed blocker, "
        "I will surface it before expanding scope rather than silently increasing the commitment."
    )

def bid_amount(p):
    b = p.get("budget") or {}
    lo, hi = float(b.get("minimum") or 0), float(b.get("maximum") or 0)
    return round(max(lo, min(hi, lo + 0.35 * (hi - lo))), 2)

def submit_bid(p, score, desc, hours):
    amount = bid_amount(p)
    period = 2 if hours <= 48 else 3
    payload = {
        "project_id": int(p["id"]),
        "bidder_id": self_id(),
        "amount": amount,
        "period": period,
        "milestone_percentage": 100,
        "description": desc,
    }
    packet = {
        "source": "freelancer_official_api",
        "created_at": now_iso(),
        "qualification_score": score,
        "currency_code": (p.get("currency") or {}).get("code"),
        "estimated_hours": hours,
        **payload,
    }
    (PACKET_DIR / f"{p['id']}.json").write_text(json.dumps(packet, indent=2) + "\n")
    r = requests.post(f"{URL}/api/projects/0.1/bids/", headers=headers(True), json=payload, timeout=30)
    body = r.json() if r.content else {}
    if not r.ok:
        raise RuntimeError(body.get("message") or f"HTTP_{r.status_code}")
    bid_id = int((body.get("result") or {}).get("id") or 0)
    if bid_id <= 0:
        raise RuntimeError("AUTHORITATIVE_BID_ID_MISSING")
    receipt = {
        "type": "marketplace_submission_receipt",
        "authoritative": True,
        "provider": "freelancer_official_api",
        "recorded_at": now_iso(),
        "project_id": int(p["id"]),
        "bid_id": bid_id,
        "submitted_amount": amount,
        "delivery_days": period,
        "qualification_score": score,
        "request_id": body.get("request_id"),
    }
    (RECEIPT_DIR / f"{p['id']}-{bid_id}.json").write_text(json.dumps(receipt, indent=2) + "\n")
    return receipt

def main():
    t = token()
    if not t:
        print("TOKEN_MISSING")
        return
    session = Session(oauth_token=t, url=URL)
    state = load_state()
    seen = set(map(int, state.get("seen", [])))
    submitted = set(map(int, state.get("submitted", [])))
    search_filter = create_search_projects_filter(sort_field="time_updated", or_search_query=True)

    ids = []
    for q in QUERIES:
        try:
            result = search_projects(session, query=q, active_only=True, search_filter=search_filter)
        except Exception as e:
            print("SEARCH_FAIL", q, type(e).__name__, str(e)[:160])
            continue
        for p in result.get("projects", []):
            pid = int(p.get("id") or 0)
            if pid > 0 and pid not in ids and pid not in submitted:
                ids.append(pid)
            if len(ids) >= 60:
                break
        if len(ids) >= 60:
            break

    qualified = []
    auto_ready = []
    for start in range(0, len(ids), 20):
        batch = ids[start:start+20]
        try:
            detail = detail_batch(session, batch)
        except Exception as e:
            print("DETAIL_FAIL", type(e).__name__, str(e)[:200])
            continue
        for p in detail.get("projects", []):
            pid = int(p.get("id") or 0)
            user = user_for(detail, p)
            score, reasons, skills, hours = score_project(p, user)
            proposal_text = proposal(p, skills, hours) if score >= 75 else None
            currency = (p.get("currency") or {}).get("code")
            budget = p.get("budget") or {}
            record = {
                "timestamp": int(time.time()), "scorer_version": VERSION,
                "project_id": pid, "title": p.get("title"), "type": p.get("type"),
                "status": p.get("status"), "budget": budget, "currency": p.get("currency"),
                "skills": skills, "score": score, "reasons": reasons,
                "estimated_hours": hours,
                "decision": "AUTO_BID_READY" if score >= AUTO_BID_THRESHOLD and hours <= 72 and currency == "USD" else ("QUALIFIED" if score >= 75 else "REJECT"),
                "proposal": proposal_text,
                "url": f"https://www.freelancer.com/projects/{pid}",
            }
            with LOG_FILE.open("a") as f:
                f.write(json.dumps(record) + "\n")
            seen.add(pid)
            if score >= 75:
                qualified.append(record)
            try:
                lo = float(budget.get("minimum") or 0); hi = float(budget.get("maximum") or 0)
            except Exception:
                lo = hi = 0
            if (score >= AUTO_BID_THRESHOLD and hours <= 72 and currency == "USD" and 25 <= lo <= hi <= 1000 and proposal_text):
                auto_ready.append((p, record))

    today = datetime.now(timezone.utc).date().isoformat()
    daily = state.setdefault("daily", {})
    used = int(daily.get(today, 0))
    allowance = max(0, min(MAX_AUTO_BIDS_PER_RUN, MAX_AUTO_BIDS_PER_DAY - used))
    submitted_now = 0
    for p, rec in sorted(auto_ready, key=lambda x: x[1]["score"], reverse=True):
        pid = int(p["id"])
        if submitted_now >= allowance or pid in submitted:
            break
        try:
            receipt = submit_bid(p, rec["score"], rec["proposal"], rec["estimated_hours"])
            submitted.add(pid)
            submitted_now += 1
            print("SUBMITTED", pid, "BID_ID", receipt["bid_id"], "SCORE", rec["score"])
        except Exception as e:
            print("BID_FAIL", pid, type(e).__name__, str(e)[:180])

    daily[today] = used + submitted_now
    state["seen"] = sorted(seen)[-4000:]
    state["submitted"] = sorted(submitted)[-1000:]
    save_state(state)

    print(f"SCANNED={len(ids)} QUALIFIED={len(qualified)} AUTO_READY={len(auto_ready)} SUBMITTED={submitted_now}")
    for c in sorted(qualified, key=lambda x: x["score"], reverse=True)[:10]:
        print(c["score"], c["decision"], c["project_id"], c["title"], c["url"])

if __name__ == "__main__":
    main()
PY

cat > "$BASE/run.sh" <<'SH'
#!/usr/bin/env bash
set -u
VENV="$HOME/.venvs/freelancer"
if [ ! -x "$VENV/bin/python" ]; then
  echo "VENV_MISSING"
  exit 0
fi
exec "$VENV/bin/python" "$HOME/daube-revenue-worker/worker.py"
SH
chmod 700 "$BASE/run.sh"

sudo tee /etc/systemd/system/daube-revenue-worker.service >/dev/null <<EOF2
[Unit]
Description=D'AUBE Freelancer Revenue Worker v3
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$(id -un)
Environment=HOME=$HOME
ExecStart=$BASE/run.sh
Nice=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$HOME/daube-revenue-worker
ReadOnlyPaths=$HOME/.config/daube/secrets $HOME/.venvs/freelancer
EOF2

sudo tee /etc/systemd/system/daube-revenue-worker.timer >/dev/null <<'EOF2'
[Unit]
Description=Run D'AUBE Freelancer Revenue Worker v3

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
Persistent=true
RandomizedDelaySec=45

[Install]
WantedBy=timers.target
EOF2

sudo systemctl daemon-reload
sudo systemctl enable --now daube-revenue-worker.timer
sudo systemctl start daube-revenue-worker.service || true

echo "=== D'AUBE FREELANCER WORKER V3 ==="
"$BASE/run.sh" || true
echo "=== TIMER ==="
systemctl is-active daube-revenue-worker.timer || true
systemctl --no-pager list-timers daube-revenue-worker.timer || true
