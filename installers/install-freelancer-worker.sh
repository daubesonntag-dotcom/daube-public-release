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

VERSION = "v4-hard-gated-autobid"
HOME = Path.home()
BASE = HOME / "daube-revenue-worker"
TOKEN_FILE = HOME / ".config/daube/secrets/freelancer.token"
STATE_FILE = BASE / "state.json"
LOG_FILE = BASE / "opportunities.jsonl"
PACKET_DIR = BASE / "packets"
RECEIPT_DIR = BASE / "receipts"
URL = "https://www.freelancer.com"
AUTO_BID_THRESHOLD = 86
MAX_AUTO_BIDS_PER_RUN = 2
MAX_AUTO_BIDS_PER_DAY = 4

QUERIES = [
    "React TypeScript bug fix", "Next.js bug fix", "React frontend fix",
    "REST API integration", "Google API integration", "webhook integration",
    "AI chatbot", "OpenAI API integration", "LLM integration", "RAG chatbot",
    "n8n automation", "Make.com automation", "FastAPI API",
    "website QA testing", "web application testing", "UX QA"
]

CAPABILITY_GROUPS = {
    "frontend": {"react", "typescript", "javascript", "next.js", "nextjs", "frontend", "tailwind", "vite"},
    "api": {"api integration", "rest api", "rest", "webhook", "google api", "oauth", "api"},
    "ai": {"openai", "llm", "rag", "chatbot", "ai chatbot", "prompt", "embeddings"},
    "automation": {"n8n", "make.com", "automation", "workflow automation", "zapier"},
    "backend": {"python", "fastapi", "node.js", "nodejs", "backend"},
    "qa": {"qa", "testing", "test website", "web testing", "ux testing", "bug testing"},
}

HARD_BLOCK = {
    "trading", "forex", "cryptocurrency trading", "crypto bot", "algo trading",
    "betting", "gambling", "casino", "medical diagnosis", "mental health",
    "telehealth", "therapy", "clinical", "legal advice", "law firm",
    "adult content", "on-site", "onsite", "tallyprime", "sap training",
    "dynamics training", "dynamics hr", "microsoft dynamics", "power bi",
    "gohighlevel", "highlevel", "seo campaign", "marketing campaign",
    "cold calling", "lead generation", "appointment setter", "sales closer",
    "three fiber", "react three fiber", "r3f", "3d game", "web rpg", "unity",
    "unreal engine", "scraping captcha", "bypass captcha", "captcha bypass",
    "mass account", "fake review", "fake reviews", "academic cheating",
}

LARGE_SCOPE = {
    "complete platform", "full platform", "entire platform", "marketplace",
    "fleet management", "multi-tenant", "payment gateway", "erp", "crm",
    "native ios", "native android", "entire application", "from scratch",
    "booking platform", "social network", "complete saas", "full saas",
}

SCOPE_POSITIVE = {
    "bug fix", "fix bug", "small fix", "integration", "connect api", "api integration",
    "add feature", "single page", "landing page", "existing project", "existing app",
    "existing website", "webhook", "automation", "workflow", "test", "qa",
    "chatbot", "rag", "endpoint", "form", "dashboard fix"
}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def load_state():
    try:
        s = json.loads(STATE_FILE.read_text())
    except Exception:
        s = {}
    if s.get("version") != VERSION:
        # Keep known submissions so a scorer upgrade can never duplicate a real bid.
        old_submitted = s.get("submitted", []) if isinstance(s, dict) else []
        return {"version": VERSION, "seen": [], "submitted": old_submitted, "daily": {}}
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
        "User-Agent": "D-AUBE-Revenue-Worker/4.0",
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


def capabilities(text):
    matched = {}
    for group, terms in CAPABILITY_GROUPS.items():
        hits = sorted({term for term in terms if term in text})
        if hits:
            matched[group] = hits
    return matched


def score_project(p, user):
    title = (p.get("title") or "").strip()
    desc = (p.get("description") or "").strip()
    jobs = p.get("jobs") or []
    skills = [str(j.get("name", "")).strip() for j in jobs if isinstance(j, dict)]
    text = (title + " " + desc + " " + " ".join(skills)).lower()
    reasons = []

    blocked_hits = sorted({x for x in HARD_BLOCK if x in text})
    if blocked_hits:
        return 0, ["hard_block:" + ",".join(blocked_hits[:4])], skills, 0, {}, False
    if (p.get("type") or "").lower() != "fixed":
        return 0, ["not_fixed_price"], skills, 0, {}, False
    if (p.get("status") or "").lower() != "active":
        return 0, ["not_active"], skills, 0, {}, False
    if len(desc) < 80:
        return 0, ["insufficient_scope_detail"], skills, 0, {}, False

    caps = capabilities(text)
    # Generic words like website/API alone are not enough. Require a strong approved lane.
    strong_groups = {g for g in caps if g in {"frontend", "ai", "automation", "backend", "qa"}}
    if not strong_groups:
        return 0, ["no_approved_capability_lane"], skills, 0, caps, False

    large_hits = sorted({x for x in LARGE_SCOPE if x in text})
    if len(large_hits) >= 2:
        return 0, ["scope_too_large:" + ",".join(large_hits[:4])], skills, 96, caps, False

    currency = (p.get("currency") or {}).get("code") or ""
    budget = p.get("budget") or {}
    try:
        minimum = float(budget.get("minimum") or 0)
        maximum = float(budget.get("maximum") or 0)
    except Exception:
        minimum = maximum = 0

    payment_verified = nested_truthy(user, {"payment_verified", "payment_verified_status", "verified_payment"})
    client_history = nested_positive_count(
        user.get("reputation", user),
        {"reviews", "review_count", "reviews_count", "completed_projects", "project_count"},
    )
    credible_client = bool(payment_verified or client_history > 0)

    score = 42
    score += min(len(strong_groups) * 9, 27)
    reasons.append("lanes=" + ",".join(sorted(strong_groups)))

    all_hits = sum(len(v) for v in caps.values())
    score += min(all_hits * 2, 10)

    if 100 <= len(desc) <= 3000:
        score += 8
        reasons.append("bounded_spec")
    elif len(desc) > 4500:
        score -= 20
        reasons.append("large_spec")

    positive_scope_hits = sum(1 for x in SCOPE_POSITIVE if x in text)
    if positive_scope_hits:
        score += min(positive_scope_hits * 2, 8)
        reasons.append(f"bounded_scope_signals={positive_scope_hits}")

    if len(large_hits) == 1:
        score -= 18
        reasons.append("scope_watch=" + large_hits[0])

    usd_budget_ok = currency == "USD" and 25 <= minimum <= maximum <= 1000 and maximum >= 80
    if usd_budget_ok:
        score += 8
        reasons.append("usd_budget_guard")
    else:
        reasons.append("manual_currency_or_budget_gate")

    if payment_verified:
        score += 5
        reasons.append("payment_verified")
    if client_history > 0:
        score += 4
        reasons.append("client_history")

    estimated_hours = 24
    if len(desc) > 2200 or len(large_hits) == 1:
        estimated_hours = 48
    if len(desc) > 4000:
        estimated_hours = 72

    # A real auto-bid needs client credibility. Missing metadata remains QUALIFIED/manual, never auto-submit.
    auto_contract_safe = bool(usd_budget_ok and credible_client and estimated_hours <= 72 and len(large_hits) == 0)
    if not credible_client:
        reasons.append("client_credibility_unverified")

    return max(0, min(score, 100)), reasons, skills, estimated_hours, caps, auto_contract_safe


def proposal(p, caps, hours):
    title = (p.get("title") or "your project").strip()
    lane_names = ", ".join(sorted(caps.keys())) or "the requested implementation"
    days = 1 if hours <= 24 else (2 if hours <= 48 else 3)
    return (
        f"Hi — I reviewed the requirements for {title}. This fits my {lane_names} workflow. "
        "I would first freeze the acceptance criteria and reproduce/map the current behavior, then implement the "
        "smallest production-ready change with explicit error handling and evidence-based QA. "
        f"For the scope currently described I can target delivery within {days} day(s), including verification and a concise handoff. "
        "My relevant evidence is D’AUBE-owned product/system work; I do not represent internal work as past client work. "
        "If access or repository inspection exposes an undisclosed dependency that changes the scope, I will flag it before expanding the commitment."
    )


def bid_amount(p):
    b = p.get("budget") or {}
    lo, hi = float(b.get("minimum") or 0), float(b.get("maximum") or 0)
    # Stay competitive without bait-pricing: lower third of the published range.
    return round(max(lo, min(hi, lo + 0.30 * (hi - lo))), 2)


def submit_bid(p, score, desc, hours):
    amount = bid_amount(p)
    period = 1 if hours <= 24 else (2 if hours <= 48 else 3)
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
        "paid_spend_required": False,
        "standard_contract_guard": True,
        **payload,
    }
    (PACKET_DIR / f"{p['id']}.json").write_text(json.dumps(packet, indent=2) + "\n")

    r = requests.post(f"{URL}/api/projects/0.1/bids/", headers=headers(True), json=payload, timeout=30)
    try:
        body = r.json() if r.content else {}
    except Exception:
        body = {}
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
            if len(ids) >= 80:
                break
        if len(ids) >= 80:
            break

    qualified = []
    auto_ready = []
    rejects = 0

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
            score, reasons, skills, hours, caps, auto_contract_safe = score_project(p, user)
            proposal_text = proposal(p, caps, hours) if score >= 75 else None
            currency = (p.get("currency") or {}).get("code")
            budget = p.get("budget") or {}

            if score >= AUTO_BID_THRESHOLD and auto_contract_safe:
                decision = "AUTO_BID_READY"
            elif score >= 75:
                decision = "QUALIFIED"
            else:
                decision = "REJECT"
                rejects += 1

            record = {
                "timestamp": int(time.time()),
                "scorer_version": VERSION,
                "project_id": pid,
                "title": p.get("title"),
                "type": p.get("type"),
                "status": p.get("status"),
                "budget": budget,
                "currency": p.get("currency"),
                "skills": skills,
                "capability_lanes": caps,
                "score": score,
                "reasons": reasons,
                "estimated_hours": hours,
                "auto_contract_safe": auto_contract_safe,
                "decision": decision,
                "proposal": proposal_text,
                "url": f"https://www.freelancer.com/projects/{pid}",
            }
            with LOG_FILE.open("a") as f:
                f.write(json.dumps(record) + "\n")

            if score >= 75:
                qualified.append(record)

            try:
                lo = float(budget.get("minimum") or 0)
                hi = float(budget.get("maximum") or 0)
            except Exception:
                lo = hi = 0

            if (
                decision == "AUTO_BID_READY"
                and currency == "USD"
                and 25 <= lo <= hi <= 1000
                and proposal_text
                and pid not in submitted
            ):
                auto_ready.append((p, record))

    today = datetime.now(timezone.utc).date().isoformat()
    daily = state.setdefault("daily", {})
    used = int(daily.get(today, 0))
    allowance = max(0, min(MAX_AUTO_BIDS_PER_RUN, MAX_AUTO_BIDS_PER_DAY - used))
    submitted_now = 0

    for p, rec in sorted(auto_ready, key=lambda x: x[1]["score"], reverse=True):
        pid = int(p["id"])
        if submitted_now >= allowance:
            break
        if pid in submitted:
            continue
        try:
            receipt = submit_bid(p, rec["score"], rec["proposal"], rec["estimated_hours"])
            submitted.add(pid)
            submitted_now += 1
            print("SUBMITTED", pid, "BID_ID", receipt["bid_id"], "SCORE", rec["score"])
        except Exception as e:
            print("BID_FAIL", pid, type(e).__name__, str(e)[:180])

    daily[today] = used + submitted_now
    state["submitted"] = sorted(submitted)[-1000:]
    save_state(state)

    print(
        f"VERSION={VERSION} SCANNED={len(ids)} REJECTED={rejects} "
        f"QUALIFIED={len(qualified)} AUTO_READY={len(auto_ready)} SUBMITTED={submitted_now}"
    )
    for c in sorted(qualified, key=lambda x: x["score"], reverse=True)[:12]:
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
Description=D'AUBE Freelancer Revenue Worker v4
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
Description=Run D'AUBE Freelancer Revenue Worker v4

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

echo "=== D'AUBE FREELANCER WORKER V4 ==="
"$BASE/run.sh" || true
echo "=== TIMER ==="
systemctl is-active daube-revenue-worker.timer || true
systemctl --no-pager list-timers daube-revenue-worker.timer || true
