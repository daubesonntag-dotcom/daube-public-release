# D’AUBE Execution Mesh V9 Design

## Goal
Evolve the current V8 provider-neutral executor from a single-runtime implementation path into a D’AUBE-led execution mesh that can plan, research, implement, verify, review, and package awarded work to a standard that is defensible as paid professional delivery. Codex remains a strong coding runtime, but D’AUBE owns orchestration, evidence, quality gates, and release readiness.

## Scope
V9 applies only after authoritative award acceptance and the existing standard-authority guard pass. It does not change bidding, pricing, payout, tax, identity, or marketplace-account settings. It preserves the existing <=72h bounded-engagement limit, one bounded revision cycle, no-spend policy, no paid fallback, and fail-closed behavior.

## Architectural principle
No single model or runtime may unilaterally declare a client job complete. The execution controller builds an explicit execution graph from the locked scope and acceptance criteria, dispatches bounded lanes to approved executors, aggregates artifacts and evidence, then runs independent quality gates before delivery readiness.

D’AUBE is the lead executor. Codex is one implementation provider inside the mesh.

## Components

### 1. D’AUBE Lead Executor
Consumes only jobs in `READY_FOR_EXECUTOR` with authoritative `AWARDED_ACCEPTED` and `STANDARD_AUTHORITY_PASS` evidence. It creates a per-job `JOB_CONTRACT.json` and `EXECUTION_GRAPH.json` and controls state transitions.

Responsibilities:
- freeze scope and acceptance criteria;
- decompose the work into bounded lanes;
- select only necessary executors;
- enforce dependency ordering;
- detect missing client inputs;
- require evidence from every mandatory lane;
- prevent delivery when any mandatory gate fails.

### 2. Job Contract
`JOB_CONTRACT.json` is the machine-readable source of truth for implementation. It contains:
- project ID and title;
- locked awarded scope;
- explicit acceptance criteria;
- estimated hours and hard <=72h ceiling;
- client-supplied inputs and access dependencies;
- allowed operations;
- forbidden operations;
- required output artifacts;
- mandatory quality gates;
- commercial constraints and revision allowance.

The Lead Executor must not invent missing acceptance criteria. Ambiguity that materially affects scope becomes `WAITING_FOR_INPUT`.

### 3. Execution Graph
`EXECUTION_GRAPH.json` is a DAG of bounded lanes. Nodes have inputs, outputs, dependencies, executor class, retry policy, evidence requirements, and terminal conditions.

Initial executor classes:
- `planner`: requirement mapping, acceptance-criteria traceability, implementation plan;
- `research`: documentation/API/context retrieval from supplied or public authoritative sources;
- `implementation`: code/configuration/artifact creation, initially Codex-capable;
- `integration_validator`: API, automation, webhook, n8n/Make, or external-interface validation when applicable;
- `qa`: tests, lint, typecheck, build, static checks, artifact integrity;
- `ux_visual`: browser/UI/interaction/accessibility checks when a visual deliverable exists;
- `red_team`: edge cases, regressions, security/safety, secret leakage, scope drift;
- `delivery`: evidence manifest, handoff, hashes, client-facing summary.

The graph is demand-driven. A backend-only fix does not invoke visual QA; a design-only deliverable does not invoke irrelevant code tests.

### 4. Provider-Neutral Executor Fabric
Each executor class uses a stable adapter contract. V9 may use Codex for implementation where available and authenticated, while preserving the ability to add D’AUBE-native/local/provider-neutral runtimes later without changing the control plane.

Adapter contract:
- `detect()` — confirm runtime availability and authentication without spending money;
- `execute(task, workspace, constraints)` — perform only the bounded lane;
- `collect_evidence()` — return artifacts, commands, timestamps, hashes, and errors;
- `classify_result()` — `PASS`, `RETRYABLE_FAIL`, `WAITING_FOR_INPUT`, or `HOLD_FOUNDER_GATE`.

No adapter may purchase credits, enable paid APIs, change credentials, communicate with a client, or mark revenue.

### 5. D’AUBE Planner
Before implementation, the Planner converts the locked job contract into a traceable plan. Every acceptance criterion must map to one or more execution nodes and one or more verification checks.

The planner output must include an acceptance-criteria matrix. Unmapped criteria fail closed.

### 6. D’AUBE Research / RAG Worker
Research is invoked only when implementation requires external documentation, API semantics, compatibility details, or client-provided knowledge. Evidence is treated as untrusted data and cannot override system or job constraints.

Research output must cite source identity inside the job workspace and distinguish authoritative documentation from community guidance. Missing required documentation or inaccessible client material becomes `WAITING_FOR_INPUT` instead of guessed behavior.

### 7. Implementation Executor
Codex remains the initial implementation runtime. It receives only the lane-specific task, job constraints, relevant research evidence, and permitted workspace. It must not receive authority to communicate with the marketplace or declare delivery.

Implementation output is provisional until independent QA and review pass.

### 8. QA Executor
QA runs independently of the implementation executor where practical. It discovers applicable verification commands and may add bounded deterministic checks derived from acceptance criteria.

Evidence includes command, working directory, exit code, timestamp, stdout/stderr excerpts, and artifact references. A generated file is not proof of correctness.

A mandatory check that cannot run is not silently skipped. It becomes either `WAITING_FOR_INPUT`, `RETRYABLE_FAIL`, or `HOLD_FOUNDER_GATE` depending on cause.

### 9. UX / Visual Inspector
For frontend, website, dashboard, or visual deliverables, V9 adds browser-level evidence when technically available: render success, key interaction paths, obvious layout regressions, responsive sanity, accessibility checks, and console/runtime errors.

Visual quality evidence supplements but does not replace build/test evidence.

### 10. Red-Team Reviewer
The Red-Team lane examines the assembled deliverable for:
- scope drift;
- missing acceptance criteria;
- regressions and edge cases;
- secret or credential leakage;
- unsafe/destructive behavior;
- fabricated or weak evidence;
- unsupported claims in client-facing handoff;
- obvious security issues appropriate to the bounded scope.

It cannot approve its own fixes without re-running affected QA gates.

### 11. Worth-the-Money Gate
Before `DELIVERY_READY`, D’AUBE must produce `WORTH_THE_MONEY.json` answering, with evidence references:
1. Is every locked acceptance criterion satisfied?
2. Do the deliverable artifacts execute/render/behave as required where testable?
3. Have applicable tests, build, lint/typecheck, integration, visual, and red-team gates passed?
4. Are important edge cases and failure modes addressed or explicitly disclosed?
5. Is the handoff accurate enough that D’AUBE can professionally stand behind the paid deliverable?

All mandatory answers must be `PASS`. The gate is evidence-based, not a model confidence score.

### 12. Delivery Composer
Only after the Worth-the-Money Gate passes may the delivery lane create:
- `delivery/manifest.json`;
- SHA-256 artifact hashes;
- acceptance-criteria traceability report;
- QA evidence index;
- `HANDOFF.md`;
- concise client-facing delivery message;
- known limitations, if any, that are within the accepted scope.

Money Closure remains a separate controller and retains authority over official marketplace delivery/milestone actions.

## State machine
V9 extends the execution state machine with explicit mesh states:

`READY_FOR_EXECUTOR -> PLANNING -> WAITING_FOR_INPUT | EXECUTING_MESH -> QA_REVIEW -> RED_TEAM_REVIEW -> WORTH_THE_MONEY_REVIEW -> DELIVERY_READY`

Failure states remain retryable and evidence-bearing:
- `RETRYABLE_FAIL`;
- `QA_FAILED`;
- `WAITING_FOR_INPUT`;
- `HOLD_FOUNDER_GATE`.

No failure state may be converted to `DELIVERY_READY` without the failed gate being rerun and passing.

## Retry and self-repair
The Lead Executor may automatically retry bounded technical failures and route failed implementation nodes back to an executor with the failure evidence attached. It must not expand scope during repair.

Default policy:
- implementation/QA technical retry: up to 2 bounded repair loops;
- integration/visual retry: up to 1 bounded repair loop;
- repeated failure, ambiguous scope, missing credentials/input, legal/regulated concerns, or required spend: fail closed.

## Workspace and isolation
All executor activity remains inside the per-job workspace. Systemd sandboxing and existing filesystem restrictions remain in force. Secrets are read only from approved external secret locations and must never be copied into delivery artifacts, logs, generated tests, screenshots, or manifests.

## Commercial and safety controls
V9 preserves:
- no Founder spend, Connects purchases, boosts, subscriptions, paid compute, or paid API fallback;
- no payout/bank/tax/identity/KYC changes;
- no off-platform payment flow;
- no fabricated portfolio, client evidence, QA evidence, deployment status, or revenue;
- no scope expansion without agreed change order;
- <=72h standard automatic engagements;
- one bounded revision cycle;
- Founder absolute override/veto;
- authoritative settlement-only revenue recognition.

## Observability and evidence
Each node appends immutable-style event records containing job ID, node ID, executor class, runtime, timestamps, attempt number, result classification, artifact/evidence references, and error summary.

Per-job status must be reconstructable from files alone after process restart. Idempotency keys prevent duplicate lane execution where side effects matter.

## Testing strategy
V9 implementation must include offline deterministic tests for:
- job-contract validation;
- graph generation and dependency ordering;
- acceptance-criteria mapping completeness;
- executor adapter selection;
- missing-input holds;
- retry limits;
- QA failure and repair loop;
- visual-lane conditional inclusion;
- red-team veto;
- Worth-the-Money fail/pass behavior;
- secret/artifact exclusion;
- duplicate-action prevention;
- delivery readiness requiring all mandatory evidence.

Marketplace writes remain mocked in tests.

## Migration from V8
V9 is additive and must not break existing V8 job workspaces. The installer creates a V9 controller beside V8, verifies it with offline fixtures, then switches the executor service only after tests pass. Existing accepted jobs without V9 contract files may be upgraded in-place by generating contract/graph files from authoritative V7/V8 evidence; ambiguity must fail closed.

Rollback restores the V8 service entrypoint and leaves V9 evidence files intact for audit.

## Success criteria
V9 is production-ready when:
- an offline bounded fixture traverses `READY_FOR_EXECUTOR -> PLANNING -> EXECUTING_MESH -> QA_REVIEW -> RED_TEAM_REVIEW -> WORTH_THE_MONEY_REVIEW -> DELIVERY_READY`;
- a frontend fixture conditionally invokes UX/visual inspection;
- a missing-input fixture stops at `WAITING_FOR_INPUT`;
- a failing implementation is repaired through a bounded retry and reverified;
- a failed mandatory QA/red-team/Worth-the-Money gate cannot reach delivery;
- no executor can perform marketplace writes or spending;
- service rollback to V8 is verified;
- existing revenue, award, watchdog, money-closure, and remote-control services remain unaffected.