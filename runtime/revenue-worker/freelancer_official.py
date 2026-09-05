#!/usr/bin/env python3
"""Official Freelancer.com scout/bid adapter.

Uses freelancer/freelancer-sdk-python only. No browser/session-cookie automation.
Writes are fail-closed unless both FLN_OAUTH_TOKEN and
FREELANCER_PROPOSAL_WRITE_ALLOWED=1 are present.
"""

import json
import os
import sys
from dataclasses import dataclass, asdict
from typing import Any

from freelancersdk.session import Session
from freelancersdk.resources.projects.projects import search_projects
from freelancersdk.resources.projects.helpers import create_search_projects_filter
from freelancersdk.resources.projects import place_project_bid
from freelancersdk.resources.users import get_self_user_id

QUERIES = [
    "React TypeScript",
    "OpenAI API integration",
    "LLM chatbot",
    "RAG knowledge assistant",
    "n8n automation",
    "Make.com automation",
    "Google Sheets API",
    "Google Workspace API",
    "API integration",
    "frontend bug fix",
]

@dataclass
class Candidate:
    project_id: int
    title: str
    description: str
    min_budget: float
    max_budget: float
    currency_code: str
    score: float
    query: str


def _num(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _project_budget(project: dict) -> tuple[float, float]:
    budget = project.get("budget") or {}
    return _num(budget.get("minimum")), _num(budget.get("maximum"))


def _currency(project: dict) -> str:
    currency = project.get("currency") or {}
    return str(currency.get("code") or currency.get("sign") or "UNKNOWN")


def _score(project: dict, query: str) -> float:
    title = str(project.get("title") or "").lower()
    description = str(project.get("description") or "").lower()
    text = f"{title} {description}"
    min_budget, max_budget = _project_budget(project)
    score = 0.0
    preferred = ["react", "typescript", "api", "openai", "llm", "rag", "n8n", "make", "google sheets", "workspace", "automation", "frontend"]
    risky = ["casino", "gambling", "medical diagnosis", "crypto wallet recovery", "adult", "scrape login", "captcha", "account farming", "bypass"]
    score += sum(5 for term in preferred if term in text)
    score -= sum(30 for term in risky if term in text)
    if max_budget >= 80:
        score += 15
    if max_budget >= 250:
        score += 10
    if 0 < max_budget < 25:
        score -= 100
    if len(description) < 40:
        score -= 10
    if query.lower() in text:
        score += 5
    return score


def scout(session: Session) -> list[Candidate]:
    seen: dict[int, Candidate] = {}
    search_filter = create_search_projects_filter(sort_field="time_updated", or_search_query=True)
    for query in QUERIES:
        result = search_projects(session, query=query, active_only=True, search_filter=search_filter)
        for project in result.get("projects", []):
            pid = int(project["id"])
            candidate = Candidate(
                project_id=pid,
                title=str(project.get("title") or ""),
                description=str(project.get("description") or ""),
                min_budget=_project_budget(project)[0],
                max_budget=_project_budget(project)[1],
                currency_code=_currency(project),
                score=_score(project, query),
                query=query,
            )
            previous = seen.get(pid)
            if previous is None or candidate.score > previous.score:
                seen[pid] = candidate
    return sorted(seen.values(), key=lambda x: x.score, reverse=True)


def place_bid(session: Session, candidate: Candidate, amount: float, period_days: int, description: str) -> dict:
    if os.environ.get("FREELANCER_PROPOSAL_WRITE_ALLOWED") != "1":
        raise RuntimeError("FOUNDER_PLATFORM_GATE: exact Freelancer proposal write permission is not enabled")
    if not description.strip():
        raise ValueError("proposal description cannot be empty")
    bidder_id = get_self_user_id(session)
    return place_project_bid(
        session,
        project_id=candidate.project_id,
        bidder_id=bidder_id,
        amount=amount,
        period=period_days,
        milestone_percentage=100,
        description=description,
    )


def main() -> int:
    token = os.environ.get("FLN_OAUTH_TOKEN") or os.environ.get("FREELANCER_OFFICIAL_TOKEN")
    if not token:
        print(json.dumps({"status": "FOUNDER_PLATFORM_GATE", "reason": "FLN_OAUTH_TOKEN_ABSENT"}))
        return 0
    session = Session(oauth_token=token, url=os.environ.get("FLN_URL"))
    candidates = scout(session)[:20]
    print(json.dumps({"status": "SCOUTED", "candidates": [asdict(c) for c in candidates]}, ensure_ascii=False))
    # Submission is intentionally separated from discovery. A caller must pass a
    # qualified candidate, bounded amount/period, and evidence-grounded proposal.
    return 0


if __name__ == "__main__":
    sys.exit(main())
