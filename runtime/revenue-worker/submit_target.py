#!/usr/bin/env python3
"""Submit one pre-qualified Freelancer target through the official SDK.

Safety invariants:
- official OAuth token only;
- exact proposal-write flag must be explicitly enabled;
- target packet must be fresh, USD, bounded, and above minimum;
- GitHub issue #250 is used as a durable duplicate-suppression receipt store;
- receipt is written only after the official Freelancer API returns success.
"""

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

from freelancersdk.session import Session
from freelancersdk.resources.projects.projects import get_project_by_id

from freelancer_official import Candidate, place_bid

REPO = "daubesonntag-dotcom/daube-public-release"
LEDGER_ISSUE = 250
MAX_PACKET_AGE = timedelta(hours=24)


def load_target(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def github_request(method: str, path: str, payload=None):
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise RuntimeError("GITHUB_TOKEN_ABSENT")
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def already_submitted(idempotency_key: str) -> bool:
    comments = github_request("GET", f"/repos/{REPO}/issues/{LEDGER_ISSUE}/comments?per_page=100")
    marker = f"REVENUE_WORKER_RECEIPT {idempotency_key}"
    return any(marker in str(item.get("body") or "") for item in comments)


def write_receipt(target: dict, response: dict):
    key = target["idempotencyKey"]
    body = (
        f"REVENUE_WORKER_RECEIPT {key}\n\n"
        f"- action: OFFICIAL_SUBMIT\n"
        f"- source: Freelancer.com official API/SDK\n"
        f"- project: {target['projectId']}\n"
        f"- amount: {target['bidAmount']} {target['currency']}\n"
        f"- periodDays: {target['periodDays']}\n"
        f"- providerResponse: `{json.dumps(response, ensure_ascii=False)[:3000]}`\n"
        f"- timestamp: {datetime.now(timezone.utc).isoformat()}\n\n"
        "This receipt proves proposal submission only. It is not a contract, payment, settlement, or revenue event."
    )
    github_request("POST", f"/repos/{REPO}/issues/{LEDGER_ISSUE}/comments", {"body": body})


def validate_packet(target: dict):
    if target.get("source") != "freelancer":
        raise RuntimeError("UNSUPPORTED_SOURCE")
    if target.get("currency") != "USD":
        raise RuntimeError("NON_USD_TARGET_REQUIRES_FX_REVIEW")
    amount = float(target.get("bidAmount", 0))
    if amount < 25 or amount > 1000:
        raise RuntimeError("BID_OUTSIDE_STANDARD_AUTHORITY")
    if int(target.get("periodDays", 999)) > 3:
        raise RuntimeError("TARGET_EXCEEDS_72H")
    evidence = target.get("freshEvidence") or {}
    if not evidence.get("openForBidding") or not evidence.get("paymentMethodVerified"):
        raise RuntimeError("TARGET_EVIDENCE_NOT_ADMITTED")
    observed = datetime.fromisoformat(str(evidence.get("observedAt")).replace("Z", "+00:00"))
    if datetime.now(timezone.utc) - observed > MAX_PACKET_AGE:
        raise RuntimeError("TARGET_EVIDENCE_STALE")
    if not target.get("proposal", "").strip():
        raise RuntimeError("EMPTY_PROPOSAL")


def main() -> int:
    target_path = os.environ.get("REVENUE_TARGET", "runtime/revenue-worker/targets/freelancer-40684395.json")
    target = load_target(target_path)
    validate_packet(target)

    if already_submitted(target["idempotencyKey"]):
        print(json.dumps({"status": "DUPLICATE_SUPPRESSED", "idempotencyKey": target["idempotencyKey"]}))
        return 0

    token = os.environ.get("FLN_OAUTH_TOKEN") or os.environ.get("FREELANCER_OFFICIAL_TOKEN")
    if not token:
        print(json.dumps({"status": "FOUNDER_PLATFORM_GATE", "reason": "FLN_OAUTH_TOKEN_ABSENT"}))
        return 0
    if os.environ.get("FREELANCER_PROPOSAL_WRITE_ALLOWED") != "1":
        print(json.dumps({"status": "FOUNDER_PLATFORM_GATE", "reason": "EXACT_PROPOSAL_WRITE_NOT_ENABLED"}))
        return 0

    session = Session(oauth_token=token, url=os.environ.get("FLN_URL"))
    project = get_project_by_id(session, int(target["projectId"]))
    status = str(project.get("status") or project.get("frontend_project_status") or "").lower()
    if status and status not in {"active", "open"}:
        print(json.dumps({"status": "SKIPPED", "reason": f"PROJECT_STATUS_{status.upper()}"}))
        return 0

    candidate = Candidate(
        project_id=int(target["projectId"]),
        title=str(target["title"]),
        description="qualified target packet",
        min_budget=float(target["budgetMin"]),
        max_budget=float(target["budgetMax"]),
        currency_code=str(target["currency"]),
        score=100.0,
        query="qualified-target",
    )
    response = place_bid(
        session,
        candidate,
        float(target["bidAmount"]),
        int(target["periodDays"]),
        str(target["proposal"]),
    )
    if not isinstance(response, dict) or not response:
        raise RuntimeError("OFFICIAL_API_RETURNED_NO_AUTHORITATIVE_RESPONSE")
    write_receipt(target, response)
    print(json.dumps({"status": "OFFICIAL_SUBMIT", "projectId": target["projectId"], "response": response}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
