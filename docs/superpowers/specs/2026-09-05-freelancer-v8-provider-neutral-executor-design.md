# Freelancer V8 Provider-Neutral Executor Design

## Goal
Extend the verified V7 Freelancer control plane so an awarded, accepted, bounded engagement can progress from `EXECUTOR_JOB.json` through real implementation, verification, packaging, delivery readiness, client status, and milestone-request readiness without fabricating work or spending Founder funds.

## Architecture
V8 adds a provider-neutral executor controller beside the existing revenue and award-watcher timers. The controller consumes only V7 job workspaces whose `EXECUTOR_JOB.json` state is `READY_FOR_EXECUTOR`. It detects an approved local coding runtime, preferring Codex CLI, and invokes it through an adapter with a generated execution brief. If no approved runtime is available, required client inputs are missing, or verification fails, the job enters a fail-closed HOLD state rather than being marked delivered.

The executor never treats model output as proof. Completion requires filesystem artifacts plus command-level QA evidence. Delivery and milestone actions are separate gated phases so an executor cannot directly claim payment or revenue.

## Components

### 1. Executor controller
`full-loop/executor.py` discovers queued jobs, validates the V7 manifest and scope lock, acquires a per-job lock, chooses an adapter, and advances a finite state machine.

States: `READY_FOR_EXECUTOR`, `WAITING_FOR_INPUT`, `EXECUTING`, `QA_FAILED`, `DELIVERY_READY`, `DELIVERY_SENT`, `REVISION_REQUIRED`, `MILESTONE_REQUEST_READY`, `HOLD_FOUNDER_GATE`, `DONE`.

### 2. Runtime adapters
Adapters expose one contract: runtime detection and bounded execution. V8 initially supports Codex CLI when present and authenticated. The controller is structured so additional approved local runtimes can be added later without changing Freelancer control-plane logic. No paid API fallback is introduced.

### 3. Execution brief
For each job, V8 creates `EXECUTION_BRIEF.md` from `job.json`, `SCOPE.md`, current client-input files, and explicit constraints. The brief forbids scope expansion, secret exfiltration, purchases, credential changes, fabricated evidence, and destructive operations outside the job workspace.

### 4. Verification gate
The executor detects the project stack and runs bounded available checks such as tests, lint, typecheck, and build. Results are persisted to `qa/qa-report.json` with commands, exit codes, timestamps, and output excerpts. A job cannot enter `DELIVERY_READY` unless required verification commands succeed and at least one deliverable artifact exists.

### 5. Delivery package
A successful run creates `delivery/manifest.json`, `delivery/HANDOFF.md`, artifact hashes, QA report reference, and a concise client-facing delivery message. The package distinguishes D’AUBE-owned tooling from client deliverables.

### 6. Freelancer delivery controller
A separate gated controller reads `DELIVERY_READY`. It may post the delivery/status message through the official Freelancer messaging SDK only when authoritative award acceptance exists and QA evidence is green. It records the provider response as a receipt and transitions to `DELIVERY_SENT`.

Milestone request is never inferred as revenue. It may only be requested through the official SDK after delivery evidence exists and a milestone is contractually available/requestable. Settlement is tracked separately; only authoritative external settled-payment evidence can update revenue.

## Input and access handling
V8 does not invent repository URLs, credentials, sample data, deployment access, or client decisions. If implementation needs unavailable input, it writes `NEEDS_INPUT.json`, sets `WAITING_FOR_INPUT`, and permits the official client thread to request only the missing items. Secrets remain outside generated artifacts and logs.

## Safety and commercial guards
- No Founder spending, Connects purchases, boosts, subscriptions, or paid compute/API fallback.
- No payout, bank, tax, identity, KYC, or credential-setting changes.
- No off-platform payment flow.
- No scope expansion without an agreed paid change order.
- No delivery claim without artifact and QA evidence.
- No revenue recognition from bids, awards, milestones, invoices, or pending payments.
- Standard automatic execution remains limited to the V7-authorized bounded engagements, maximum 72 hours and one bounded revision cycle.
- Unexpected legal, regulated, identity, destructive, credential, or nonstandard contractual requirements transition to `HOLD_FOUNDER_GATE`.

## Failure handling
All state transitions are append-only in an event ledger. Runtime absence, adapter failure, missing input, test failure, messaging failure, or ambiguous marketplace state fails closed and remains retryable. Per-job locks prevent concurrent execution. Idempotency keys prevent duplicate delivery messages and milestone requests.

## Testing
V8 includes offline unit tests for state transitions, adapter selection, input holds, QA gating, artifact hashing, duplicate-action prevention, and revenue-truth rules. Marketplace writes are not exercised in tests; official SDK calls are wrapped behind interfaces and tested with deterministic fakes. Installer verification performs syntax/import checks and a dry-run with no marketplace write.

## Success criteria
V8 is installed when the revenue worker, award watcher, and executor timers are active; a synthetic offline fixture can traverse `READY_FOR_EXECUTOR -> EXECUTING -> DELIVERY_READY` with QA evidence without contacting Freelancer; missing runtime/input produces HOLD/WAIT states; and no delivery/milestone/revenue state can be produced without its required authoritative evidence.