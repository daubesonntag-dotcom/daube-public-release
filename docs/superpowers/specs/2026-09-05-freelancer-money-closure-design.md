# Freelancer Money Closure Design

## Goal
Close the post-execution commercial loop for verified Freelancer engagements: client reply monitoring, evidence-gated delivery, bounded revision handling, milestone release requests, and settlement-only revenue recognition.

## Architecture
A 15-minute `money_closure.py` controller scans V7/V8 job workspaces. It never creates work or claims revenue by itself. It advances only from authoritative local evidence produced by the award watcher/executor plus official Freelancer SDK reads/writes.

## State flow
`DELIVERY_READY -> DELIVERY_SENT -> WAITING_CLIENT -> REVISION_REQUIRED|MILESTONE_RELEASE_REQUESTED -> SETTLEMENT_PENDING -> SETTLED`.

Unexpected scope, missing evidence, failed attachment upload, ambiguous milestone state, or auth/API errors produce HOLD and an evidence file rather than a false success.

## Delivery gate
Delivery requires all of:
- authoritative `accept-<project>-<bid>.json` receipt;
- executor state `DELIVERY_READY`;
- `delivery/manifest.json` with `qa_green=true` and at least one artifact hash;
- `qa/qa-report.json` with `green=true`;
- local delivery bundle generated from the `work/`, `delivery/`, and QA evidence only.

The controller posts a concise delivery message through the official Freelancer messaging SDK and uploads the delivery bundle through `post_attachment`/`create_attachment`. Duplicate delivery is prevented by a receipt/idempotency ledger.

## Client reply and revision
Official thread/message reads are used to detect messages after delivery. One bounded revision cycle is allowed only when the reply maps to the locked scope. Any request containing explicit scope-expansion indicators or regulated/risky terms transitions to `HOLD_FOUNDER_GATE` and never changes scope automatically.

A valid bounded revision writes `REVISION_REQUEST.json`, returns executor state to `REVISION_REQUIRED`, and increments revision count exactly once.

## Milestone and settlement
The controller reads project milestones using `get_milestones`. After delivery evidence exists, it may call the official `request_release_milestone_payment` only for a milestone that belongs to the project, is not already released/cancelled, and has a positive ID/amount. It never creates a new charge against the Founder and never releases employer-side funds.

Revenue is recognized only from a later official milestone read that clearly indicates released/paid status. Bids, awards, delivery, release requests, invoices, pending milestones, and ambiguous statuses are never revenue.

Settled records append to `revenue-ledger.jsonl` with provider, project_id, milestone_id, amount, currency when present, provider status, and observed timestamp. Duplicate settlement IDs are ignored.

## Safety constraints
- No payout/bank/tax/identity/KYC changes.
- No off-platform payment.
- No fund withdrawal or destination changes.
- No scope expansion without an agreed paid change order.
- No more than one automatic bounded revision cycle.
- No fabricated delivery, payment, settlement, client message, or revenue evidence.
- No secrets included in delivery bundle, receipts, or logs.

## Success criteria
Offline tests prove delivery evidence gating, duplicate suppression, revision cap/scope-expansion hold, milestone-release eligibility, and settlement-only revenue classification. Installer runs tests and compile before enabling a hardened 15-minute systemd timer.