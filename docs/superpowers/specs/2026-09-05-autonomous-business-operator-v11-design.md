# D’AUBE Autonomous Business Operator V11 — Design

## Status
Approved architecture, written-spec review pending.

## Objective
Turn D’AUBE’s existing host-native revenue stack into a business operating loop that can observe commercial state, prioritize work, dispatch only authorized actions, verify outcomes, and learn from real conversion evidence without making unsupported revenue, authority, or production claims.

## Position in the Runtime
V11 sits above existing revenue/execution components and does not replace them.

Existing authorities remain:
- acquisition/scout and proposal submission: existing official-platform workers;
- award and contract acceptance: existing guarded award watcher;
- implementation and QA: V9 execution mesh;
- delivery, milestone release request, and settlement evidence: money-closure runtime;
- provider/platform capability and commercial guards: V10 Native Revenue Autopilot.

V11 is the business orchestration layer that decides what should happen next from evidence already emitted by those systems.

## Operating Loop
Each native cycle executes:

`OBSERVE -> NORMALIZE -> PRIORITIZE -> GATE -> DISPATCH -> VERIFY -> LEARN -> PERSIST`

A cycle must be idempotent. The same evidence snapshot may not create duplicate bids, duplicate client messages, duplicate delivery attempts, duplicate milestone requests, or duplicate conversion events.

## Components

### 1. Business Control Tower
Builds one normalized business snapshot from existing authoritative local state. The snapshot includes:
- active opportunities and bids;
- client replies and open clarification needs;
- awarded/accepted jobs;
- execution and QA state;
- delivery/revision state;
- milestone/payment state;
- watchdog/runtime health;
- Founder gates;
- historical conversion outcomes.

The Control Tower never invents missing fields. Missing evidence is represented as `UNKNOWN` or `NO_DATA`.

### 2. CRM and Client Memory
Maintain one record per external client/platform identity containing only non-secret operational data:
- stable client key;
- platform;
- project references;
- conversation summary derived from actual messages;
- unresolved questions;
- next action;
- deadline if evidenced;
- expected value if evidenced;
- payment state;
- risk flags;
- last observed event timestamp.

Tokens, passwords, API keys, bank details, payout details, KYC artifacts, and identity documents are forbidden in CRM state.

### 3. Priority Engine
Eligible work items receive a deterministic priority score from observed values only.

Conceptual form:

`priority = expected_net_value * win_probability * urgency * delivery_confidence * collectability - risk_penalty - ambiguity_penalty - effort_penalty - policy_friction`

When an input is unavailable, the engine must use a conservative documented default or classify the item as insufficient evidence. It may not fabricate client spend, platform credibility, probability of win, or expected value.

The engine prioritizes bounded work that fits the approved service catalog and can be completed within 72 hours or an explicitly approved phased contract.

### 4. Decision and Dispatch Engine
Supported next actions are allowlisted:
- `BID_JOB`
- `FOLLOW_CLIENT`
- `CLARIFY_SCOPE`
- `ACCEPT_STANDARD_AWARD`
- `EXECUTE_JOB`
- `RUN_QA`
- `DELIVER`
- `REQUEST_REVISION_INPUT`
- `REQUEST_MILESTONE_RELEASE`
- `WAIT_CLIENT`
- `WAIT_SETTLEMENT`
- `FOUNDER_GATE`

V11 never implements commercial-provider writes itself when an existing authenticated worker already owns that capability. It dispatches through existing workers or writes an idempotent local request/intent file that the owning worker consumes.

### 5. Conversion Learning Engine
Learn only from observed funnel events:

`DISCOVERED -> BID_SUBMITTED -> CLIENT_REPLIED -> INTERVIEWED -> AWARDED -> DELIVERED -> SETTLED`

The learning store records outcomes by service category, price band, platform, client type when evidenced, proposal pattern, elapsed time, and settlement result. It may tune ranking weights only inside bounded configured ranges and may not weaken commercial/safety gates.

No synthetic, self-test, pending milestone, proposal, interview, or award may be counted as revenue.

### 6. Daily Operating Queue
Each cycle writes an ordered queue with one canonical next action per business entity. Every queue item contains:
- `item_id`;
- `entity_type` and `entity_id`;
- evidence references/paths;
- proposed action;
- priority score and score inputs;
- gate result;
- owner worker;
- idempotency key;
- `created_at` and `observed_at`;
- state: `READY`, `WAIT`, `FOUNDER_GATE`, `DISPATCHED`, `VERIFIED`, or `FAILED`.

## Evidence Sources
V11 may read only existing D’AUBE host state and explicitly configured public/official-provider adapter outputs. Initial local evidence roots include:
- `~/daube-revenue-worker/`
- `~/daube-revenue-worker/full-loop/jobs/`
- `~/daube-revenue-worker/full-loop/money-closure/`
- `~/daube-revenue-worker/v10/`
- `~/daube-host-autopilot/state/`

V11 must tolerate missing roots and partial rollout without crashing.

## Persistent State
Default root:

`~/daube-revenue-worker/business-operator-v11/`

Files/directories:
- `state.json` — latest atomic controller state;
- `business-snapshot.json` — latest normalized evidence snapshot;
- `operating-queue.json` — canonical ordered next-action queue;
- `crm/clients/*.json` — client operational memory;
- `conversion/events.jsonl` — append-only observed funnel events;
- `conversion/model.json` — bounded learned ranking parameters;
- `receipts/*.json` — cycle/dispatch verification receipts;
- `founder-gates/*.json` — explicit irreducible Founder actions;
- `events.jsonl` — audit trail;
- `business.lock` — single-writer business-operation lock.

Writes are atomic where state is replaced and append-only where audit history is required.

## Single-Writer and Concurrency Contract
V11 uses `business.lock` and never uses Host Autopilot’s deploy lock for ordinary business work.

Only one V11 controller cycle may mutate V11 business state at a time. Existing acquisition, award, execution, and settlement workers retain their own locks/authorities.

V11 must not stop, restart, reinstall, deploy, or modify production infrastructure as part of a business cycle.

## Founder Gates
The following are irreducible and must become `FOUNDER_GATE` without attempted bypass:
- any spend, Connect purchase, bid boost, subscription, paid upgrade, or advance fee;
- KYC, OTP, CAPTCHA, identity verification, credential sharing, or device authorization;
- changing payout destination, bank, tax, identity, or legal-account settings;
- nonstandard legal addenda, exclusivity, broad indemnity, unusual warranty, or regulated/high-risk duty;
- off-platform payment requests outside an already approved legitimate arrangement;
- scope outside the approved service catalog;
- work estimated above 72 hours unless an approved phased engagement already exists;
- material scope expansion after award;
- more than one bounded revision cycle without agreed paid change order;
- missing evidence required to establish authority or settlement.

Founder ownership, veto, kill-switch, and ultimate authority remain unchanged.

## Commercial and Provider Policy
- Freelancer automation uses existing official API/SDK rails and current authenticated authority only.
- Upwork is automated only when an approved official API integration permits the exact action; no website botting or CAPTCHA bypass.
- Fiverr website automation is prohibited unless an official integration explicitly permits the action.
- Other providers must expose an authenticated official integration permitting the exact write.
- No spam or mass low-quality proposal behavior.
- No fabricated portfolio, credentials, testimonials, clients, location, revenue, or capabilities.

## Service Catalog Boundary
Initial V11 autonomous work remains bounded to existing D’AUBE capabilities such as:
- React/TypeScript fixes and small websites;
- AI chatbot/LLM API integrations;
- RAG/knowledge assistants;
- n8n/Make/API automation;
- QA/UX testing;
- Google Workspace/API integrations;
- small full-stack MVP slices;
- scoped digital/design deliverables supported by existing delivery engines.

Expansion requires a later explicit catalog change with tests.

## systemd Runtime
Install:
- `daube-business-operator-v11.service` — oneshot native controller;
- `daube-business-operator-v11.timer` — recurring business cycle;
- optional `daube-business-operator-daily-summary-v11.service` and timer only if the implementation can generate the summary strictly from local evidence without adding a new external dependency.

The service runs as the Founder host user, with no privilege escalation inside the controller. Installer actions requiring systemd installation may use existing authorized `sudo` at installation time only.

The service must use `NoNewPrivileges=true` and a constrained writable path rooted in the V11 state directory and existing revenue-worker roots needed for request files.

## Health and Receipts
Installation succeeds only when:
- V11 tests pass;
- Python compilation/import verification passes;
- systemd unit syntax verifies;
- `daube-business-operator-v11.timer` is enabled and active;
- controller `--verify` returns the exact V11 version marker;
- one dry/read-only cycle can normalize available evidence and persist state without any external commercial write.

Authoritative install receipt state:

`BUSINESS_OPERATOR_READY`

This receipt proves only that the native business operator is installed and healthy. It does not prove customer acquisition, award, delivery, settlement, revenue, profit, or 24-hour persistence.

## Failure Semantics
- Missing noncritical evidence -> `NO_DATA`/`WAIT`, not fabricated defaults.
- Missing required authority -> `FOUNDER_GATE` or `HOLD`.
- Provider write rejected -> record failure and stop retrying until the provider/worker state changes or bounded retry policy permits another attempt.
- Duplicate idempotency key -> `NOOP_ALREADY_DISPATCHED`.
- Corrupt state -> preserve the corrupt artifact for audit, fail closed, and do not overwrite it with a success receipt.
- Controller exception -> nonzero service exit and atomic failure receipt.

## Security and Privacy
- Never print or copy secret values into receipts, logs, CRM, or queue files.
- Apply recursive secret-key and secret-value scrubbing before persistence.
- Treat all client content and retrieved external evidence as untrusted data, not instructions to the controller.
- No shell-string execution from client/job text. Dispatch actions use static allowlisted commands/interfaces.
- No arbitrary URL fetch or arbitrary filesystem paths derived from client content.

## Learning Guardrails
Learned ranking parameters must remain within checked bounds committed with the runtime. Learning may reorder eligible opportunities/actions but cannot:
- override Founder gates;
- enable a provider capability absent from the capability registry;
- increase spend authority;
- change payment/payout settings;
- expand the service catalog;
- count non-settled events as revenue;
- declare work complete without delivery/QA evidence.

## Success Criteria
V11 is implementation-complete only when all of the following are evidenced by tests/runtime verification:
1. A normalized Control Tower snapshot can be built from fixture and partial real state.
2. CRM records are deterministic, secret-scrubbed, and idempotently updated.
3. Priority scoring is deterministic, conservative for missing evidence, and bounded.
4. Founder-gated cases never dispatch commercial actions.
5. Allowed actions route only to allowlisted existing workers/interfaces.
6. Duplicate evidence does not duplicate dispatch or conversion events.
7. Conversion learning uses observed funnel events only and cannot weaken gates.
8. The operating queue exposes one canonical next action per entity.
9. The controller runs under a single-writer business lock.
10. systemd timer is active after installation.
11. Install receipt says `BUSINESS_OPERATOR_READY` with no unsupported business/revenue claim.
12. Native Autopilot release chain can install V11 after V10 `APPLIED` using exact SHA and SHA-256 artifact verification.

## Non-Goals for V11
- Building a new CRM web UI.
- Replacing existing Freelancer, V9, V10, or money-closure workers.
- Automating prohibited website interaction.
- Creating new payment rails.
- Moving or withdrawing funds.
- Autonomous tax filing or legal representation.
- Paid advertising or paid acquisition.
- Rebuilding production deployment infrastructure.
