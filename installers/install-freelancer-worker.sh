#!/usr/bin/env bash
set -u

BASE="$HOME/daube-revenue-worker"
TOKEN_FILE="$HOME/.config/daube/secrets/freelancer.token"
VENV="$HOME/.venvs/freelancer"

mkdir -p "$BASE"
chmod 700 "$BASE"

if [ ! -r "$TOKEN_FILE" ]; then
  echo "❌ Missing token file: $TOKEN_FILE"
  exit 0
fi

if [ ! -x "$VENV/bin/python" ]; then
  echo "❌ Missing Freelancer venv: $VENV"
  exit 0
fi

cat > "$BASE/worker.py" <<'PY'
import os, json, time
from pathlib import Path
from freelancersdk.session import Session
from freelancersdk.resources.projects.projects import search_projects
from freelancersdk.resources.projects.helpers import create_search_projects_filter

TOKEN_FILE = Path.home() / ".config/daube/secrets/freelancer.token"
STATE_FILE = Path.home() / "daube-revenue-worker/state.json"
LOG_FILE = Path.home() / "daube-revenue-worker/opportunities.jsonl"
URL = "https://www.freelancer.com"
QUERIES = [
    "React TypeScript", "Next.js", "API integration", "AI chatbot",
    "LLM integration", "RAG", "automation", "n8n", "web testing", "QA website"
]
GOOD = {
    "react", "typescript", "javascript", "next.js", "nextjs", "api", "rest",
    "automation", "n8n", "make.com", "chatbot", "openai", "llm", "rag",
    "python", "fastapi", "qa", "testing", "ux", "website", "frontend",
    "full stack", "full-stack"
}
BAD = {
    "trading", "forex", "crypto bot", "betting", "gambling", "medical diagnosis",
    "legal advice", "on-site", "onsite", "adult", "casino", "tallyprime",
    "sap training", "dynamics training"
}

def load_state():
    if not STATE_FILE.exists():
        return {"seen": []}
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {"seen": []}

def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=2))

def score_project(p):
    title = (p.get("title") or "").lower()
    desc = (p.get("description") or "").lower()
    text = title + " " + desc
    if any(x in text for x in BAD):
        return 0, ["risk_or_mismatch"]
    score = 20
    reasons = []
    hits = sum(1 for x in GOOD if x in text)
    score += min(hits * 8, 40)
    if hits:
        reasons.append(f"skill_hits={hits}")
    if (p.get("type") or "").lower() == "fixed":
        score += 10
        reasons.append("fixed_price")
    budget = p.get("budget") or {}
    try:
        maximum = float(budget.get("maximum") or 0)
    except Exception:
        maximum = 0
    if maximum >= 80:
        score += 10
        reasons.append("budget_ok")
    huge_terms = [
        "complete platform", "full platform", "marketplace", "fleet management",
        "crm", "multi-tenant", "payment gateway", "admin dashboard"
    ]
    huge_hits = sum(1 for x in huge_terms if x in text)
    if huge_hits >= 3:
        score -= 30
        reasons.append("scope_too_large")
    if len(desc) > 7000:
        score -= 10
        reasons.append("very_large_spec")
    return max(0, min(score, 100)), reasons

def main():
    token = TOKEN_FILE.read_text().strip()
    if not token:
        print("TOKEN_MISSING")
        return
    session = Session(oauth_token=token, url=URL)
    state = load_state()
    seen = set(state.get("seen", []))
    flt = create_search_projects_filter(sort_field="time_updated", or_search_query=True)
    candidates = []
    for q in QUERIES:
        try:
            result = search_projects(session, query=q, active_only=True, search_filter=flt)
        except Exception as e:
            print("SEARCH_FAIL", q, type(e).__name__, str(e)[:200])
            continue
        for p in result.get("projects", []):
            pid = p.get("id")
            if not pid or pid in seen:
                continue
            score, reasons = score_project(p)
            record = {
                "timestamp": int(time.time()), "project_id": pid,
                "title": p.get("title"), "type": p.get("type"),
                "status": p.get("status"), "budget": p.get("budget"),
                "currency": p.get("currency"), "score": score,
                "reasons": reasons,
                "decision": "QUALIFIED" if score >= 75 else "REJECT",
                "url": f"https://www.freelancer.com/projects/{pid}",
            }
            with LOG_FILE.open("a") as f:
                f.write(json.dumps(record) + "\n")
            if score >= 75:
                candidates.append(record)
            seen.add(pid)
    state["seen"] = list(seen)[-3000:]
    save_state(state)
    print(f"QUALIFIED={len(candidates)}")
    for c in sorted(candidates, key=lambda x: x["score"], reverse=True)[:10]:
        print(c["score"], c["project_id"], c["title"], c["url"])

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
Description=D'AUBE Freelancer Revenue Worker
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
Description=Run D'AUBE Freelancer Revenue Worker

[Timer]
OnBootSec=3min
OnUnitActiveSec=15min
Persistent=true
RandomizedDelaySec=60

[Install]
WantedBy=timers.target
EOF2

sudo systemctl daemon-reload
sudo systemctl enable --now daube-revenue-worker.timer
sudo systemctl start daube-revenue-worker.service

echo "=== WORKER STATUS ==="
systemctl --no-pager --full status daube-revenue-worker.service || true
echo "=== TIMER ==="
systemctl --no-pager list-timers daube-revenue-worker.timer || true
echo "=== RECENT OUTPUT ==="
journalctl -u daube-revenue-worker.service -n 40 --no-pager || true
