# D’AUBE Native Revenue Autopilot V10 — Design

## Status
Founder-approved architecture on 2026-09-05. Written specification for implementation review.

## Goal
Run the D’AUBE revenue lifecycle persistently on `daube-host-01` without requiring an active ChatGPT session: discover suitable work, qualify and bid through permitted official rails, monitor client/award state, accept only standard-authority engagements, execute with V9, communicate routine project status, deliver, process one bounded revision, request milestone release, reconcile authoritative settlement evidence, and maintain a truthful revenue ledger.

## Existing Assets Reused
V10 composes existing production components rather than replacing them:
- `daube-revenue-worker.timer` — opportunity discovery/scoring/official bid submission under existing gates.
- `daube-freelancer-award-watcher.timer` — award verification, standard-contract guard, official bid acceptance, job workspace creation.
- `daube-freelancer-executor.timer` — provider-neutral V8/V9 execution path.
- `daube-runtime-watchdog.timer` — bounded self-heal.
- `daube-freelancer-money-closure.timer` — delivery, one-revision gate, milestone-release request, settlement ledger.
- D’AUBE Native Host Autopilot — exact-SHA installation and rollback.

V10 adds one native orchestration/control layer plus a client-concierge policy module. Existing authoritative receipts remain authoritative.

## Revenue Lifecycle

`SCOUT -> QUALIFY -> BID -> CLIENT_ACTIVITY -> AWARD -> CONTRACT_GUARD -> ACCEPT -> EXECUTE -> QA -> DELIVER -> REVISION? -> RELEASE_REQUEST -> SETTLEMENT -> LEDGER`

Every transition is evidence-backed. Unknown state is never promoted to success.

## Scope of Autonomous Authority

### Allowed without per-action Founder confirmation
- Search/read public or official-platform opportunities.
- Score and reject opportunities using approved service catalog and risk rules.
- Submit a bounded proposal through an official authenticated API only when existing bid gates pass.
- Read project/bid/message/milestone state through official authenticated rails.
- Accept a platform-native fixed-price award only when the existing standard-authority guard passes.
- Create/maintain local job workspace and locked acceptance criteria.
- Execute approved scope using V9.
- Send routine project-thread messages through official APIs: acknowledgement, input request, status update, delivery note, bounded clarification, one in-scope revision acknowledgement, milestone-release request context.
- Deliver safe artifacts only after QA evidence is green.
- Request milestone release through the official API.
- Record revenue only from explicit external released/paid evidence.

### Mandatory Founder gate
- KYC, OTP, CAPTCHA, passkey, identity verification, tax, banking, payout destination or account-ownership changes.
- Any purchase, subscription, Connects/credits, boost, paid fallback or advance fee.
- Off-platform payment, credential sharing, identity/location misrepresentation.
- Non-standard legal addendum, exclusivity, non-compete, broad indemnity, unusual warranty, regulated professional duty.
- Scope outside approved service catalog, estimated delivery >72 hours, ambiguous acceptance criteria, or unusual client access requirements.
- More than one revision cycle or material scope expansion.
- Any platform action not explicitly permitted by its official authenticated integration.

## Platform Policy

### Freelancer.com
Primary autonomous execution rail for V10. Use the existing official Freelancer SDK and stored host token. No scraping or browser automation is required.

### Upwork
Discovery may use public evidence. Autonomous platform writes are disabled unless an approved official Upwork API integration available to D’AUBE explicitly permits the exact write and the account satisfies provider requirements. Never use browser bots, scraping, CAPTCHA bypass or paid Connects/boosts.

### Fiverr
No website automation. Autonomous writes remain disabled unless Fiverr exposes an official integration explicitly permitting the action.

### Contra and future providers
Provider adapters must expose explicit capabilities. If the provider requires prepare/confirm or human confirmation for a write, V10 must surface a Founder gate rather than bypass it.

## Architecture

### 1. Native Revenue Controller
New runtime: `runtime/revenue-v10/controller.py`.

Runs as a systemd oneshot timer. It does not duplicate marketplace workers. It observes evidence and coordinates allowed existing workers.

Responsibilities:
- inspect timer/service health;
- inspect acquisition, bid, award, executor, delivery and settlement evidence;
- derive one canonical lifecycle state per project;
- detect stalled/contradictory states;
- trigger only allowlisted local worker services when a state is eligible;
- write atomic state and append-only events;
- never mark revenue from proposals, awards, pending milestones or internal test data.

### 2. Lifecycle State Model
Canonical states:
- `DISCOVERING`
- `BID_SUBMITTED`
- `WAITING_CLIENT`
- `AWARD_DETECTED`
- `FOUNDER_GATE`
- `AWARDED_ACCEPTED`
- `WAITING_INPUT`
- `EXECUTING`
- `QA_HOLD`
- `DELIVERY_READY`
- `DELIVERED`
- `REVISION_REQUIRED`
- `SETTLEMENT_PENDING`
- `SETTLED`
- `CLOSED_NO_REVENUE`
- `FAILED_CLOSED`

State precedence is conservative: a terminal hold/failure cannot be overwritten by weaker inferred evidence.

### 3. Evidence Resolver
New runtime: `runtime/revenue-v10/evidence.py`.

Reads existing local evidence only:
- bid receipts under `~/daube-revenue-worker/receipts` and `~/daube-freelancer-live/receipts`;
- award/accept receipts under `~/daube-revenue-worker/full-loop/receipts`;
- job workspaces under `~/daube-revenue-worker/full-loop/jobs/<project_id>`;
- V9 executor and QA/delivery evidence;
- money-closure receipts and `revenue-ledger.jsonl`.

It validates project ID, bid ID, authoritative markers, exact expected states, and cross-file consistency before admitting a transition.

### 4. Client Concierge
New runtime: `runtime/revenue-v10/concierge.py`.

Purpose: routine bounded client communication after a verified project relationship exists.

Allowed message intents:
- `AWARD_ACK`
- `INPUT_REQUEST`
- `STATUS_UPDATE`
- `CLARIFICATION`
- `DELIVERY_NOTICE`
- `REVISION_ACK`
- `PAYMENT_RELEASE_CONTEXT`

Rules:
- send only through an official provider adapter;
- only for project/thread identities backed by authoritative local/provider evidence;
- no unsolicited cold-message spam;
- no claims of work/revenue/credentials not supported by evidence;
- no promises outside locked scope/deadline;
- no request to move payment off-platform;
- redact secrets and never echo stored tokens;
- deduplicate each intent per project/status epoch;
- rate limit routine status messages to at most one per 6 hours unless responding to new client activity;
- if client asks for scope expansion, risky content, extra revisions, off-platform payment, credentials, identity change or unsupported legal terms, write `FOUNDER_ACTION_REQUIRED.json` and stop automated replies for that project.

V10 initially composes the existing award-watcher and money-closure messaging paths; it does not create duplicate messages when an existing authoritative receipt shows the intent was already sent.

### 5. Provider Capability Adapter
New runtime: `runtime/revenue-v10/providers.py`.

Defines explicit capabilities:
- `read_opportunities`
- `submit_bid`
- `read_award`
- `accept_award`
- `read_messages`
- `send_message`
- `deliver_attachment`
- `read_milestones`
- `request_release`
- `read_settlement`

Freelancer adapter maps to the existing official SDK. Other providers default to read-only/unsupported until a permitted integration is explicitly available.

An unsupported capability returns `FOUNDER_GATE` or `NO_ACTION`; never emulate it with browser automation.

### 6. Orchestration Actions
V10 may start only these allowlisted services:
- `daube-revenue-worker.service`
- `daube-freelancer-award-watcher.service`
- `daube-freelancer-executor.service`
- `daube-freelancer-money-closure.service`

It may not restart arbitrary services, reboot the VM, install packages, rotate credentials, or modify marketplace account/payment settings.

Default periodic timer remains bounded and low-frequency; individual existing timers continue their own cadence.

### 7. State and Audit
Host paths:
- `~/daube-revenue-worker/v10/state.json`
- `~/daube-revenue-worker/v10/events.jsonl`
- `~/daube-revenue-worker/v10/projects/<project_id>.json`
- `~/daube-revenue-worker/v10/founder-gates/<project_id>.json`

Writes are atomic. Events are append-only. No secrets are persisted in V10 state.

### 8. Revenue Truth
Revenue is counted only when the provider’s authoritative milestone/payment read explicitly indicates released/paid settlement and money-closure has written an external-settlement ledger row.

The following never count as revenue:
- opportunity value;
- bid/proposal submitted;
- client chat/interview;
- award or accepted project;
- milestone created/pending;
- delivery sent;
- release requested;
- internal/self/test/synthetic transactions.

### 9. Watchdog and Self-Heal
V10 can detect inactive allowlisted revenue timers and request restart of only the known timers/services through the existing bounded watchdog policy. It cannot widen the allowlist from remote marketplace data.

## Stuck-State Handling
- Bid with no response: remain `WAITING_CLIENT`; no spam follow-up loop.
- Award with failed authority guard: `FOUNDER_GATE`.
- Missing client input: `WAITING_INPUT`; one bounded input request, then wait.
- Executor failure/ambiguous QA: `QA_HOLD` or `FAILED_CLOSED`; no delivery.
- Client requests second revision or expanded scope: `FOUNDER_GATE`.
- Release request with no settlement: `SETTLEMENT_PENDING`; periodically read milestones, no repeated release-request spam.
- Contradictory external evidence: `FAILED_CLOSED` with audit event.

## Installation and Cutover
Installer: `installers/install-native-revenue-autopilot-v10.sh`.

The installer:
1. requires the existing Freelancer venv/token file but never prints token content;
2. downloads V10 runtime from an exact 40-hex revision;
3. runs offline unit tests and Python compile before activation;
4. snapshots any prior V10 unit files;
5. installs `daube-native-revenue-autopilot.service` and `.timer`;
6. verifies required existing revenue timers remain active/unchanged;
7. activates the V10 timer;
8. rolls back V10 unit files on install failure.

V10 installation is published as a later Native Autopilot release-chain phase after Execution Mesh V9. It does not overwrite an unrelated current desired-state release.

## Testing
Deterministic offline tests must cover:
- lifecycle precedence and terminal holds;
- authoritative bid/accept/delivery/settlement evidence matching;
- malformed/mismatched receipts rejected;
- proposals/awards/pending milestones never counted as revenue;
- one-revision cap;
- scope expansion -> Founder gate;
- risky/off-platform/identity/payment terms -> Founder gate;
- concierge deduplication and 6-hour rate limit;
- no unsolicited messages without verified project relationship;
- unsupported provider capability -> no write;
- service allowlist enforcement;
- state atomicity;
- secret/token redaction;
- existing timer preservation during installer activation.

## Acceptance Criteria
V10 is complete only when:
1. all V10 offline tests pass and Python compiles;
2. installer passes `bash -n`;
3. Native Autopilot installs V10 from an exact-SHA/SHA-256 pinned phase;
4. `daube-native-revenue-autopilot.timer` is active on the host;
5. existing scout, award, executor, watchdog and money-closure timers remain active;
6. controller produces a truthful canonical lifecycle snapshot from real local evidence;
7. routine supported client communication is deduplicated and official-rail only;
8. standard-authority awarded jobs can progress without ChatGPT intervention through execution/delivery/release-request;
9. settlement is written only from authoritative released/paid evidence;
10. no spend, KYC/identity/payout/tax mutation, unsupported platform automation, secret exposure or fabricated evidence occurs.
