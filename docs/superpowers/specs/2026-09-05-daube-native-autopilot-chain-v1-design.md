# D’AUBE Native Autopilot Chain V1 — Design

## Status
Approved by Founder on 2026-09-05.

## Goal
Move release-phase orchestration out of ChatGPT automations and Remote Desktop Commander into the persistent D’AUBE host runtime on `daube-host-01`, so D’AUBE can autonomously advance approved releases from desired state through verification, activation, health validation, receipt persistence, and rollback without requiring an active ChatGPT session.

## Non-goals
- No autonomous spending, billing, subscriptions, paid fallback, or procurement.
- No KYC, OTP, CAPTCHA, passkey, identity, banking, payout, tax, or account-ownership mutation.
- No automatic expansion of authority merely because the runtime gains capability.
- No bypass of repository, provider, legal, or security controls.
- No fabricated release, runtime, revenue, customer, or settlement evidence.

## Architecture
The existing Host Autopilot remains the execution engine for a single desired-state release. V1 adds a host-native release-chain controller above it.

Data flow:

`release-chain.json -> chain controller -> current phase admission -> existing exact-SHA transaction -> receipt readback -> next phase -> final terminal state`

The release-chain controller runs on `daube-host-01` under systemd and is independent from ChatGPT automations, Remote Desktop Commander, browser sessions, and GitHub Actions runners.

## Components

### 1. Release Chain Manifest
Repository path:
`.daube/autopilot/release-chain.json`

Schema: `daube.native-release-chain.v1`.

Required top-level fields:
- `schema`
- `enabled`
- `chain_id`
- `phases`
- `rollback_policy`

Each phase contains:
- `phase_id`
- `target_revision` — exact 40-hex Git SHA
- `release_id`
- `artifacts` — existing Host Autopilot artifact schema with SHA-256 and mode
- `checks` — argv arrays only, no shell strings
- `activation` — existing Host Autopilot activation contract
- `health_units`
- `depends_on` — zero or one predecessor phase in V1
- `success_receipt`

The chain manifest is declarative only. It cannot contain arbitrary privileged shell commands outside the existing activation contract.

### 2. Chain Controller
New runtime module:
`runtime/host-autopilot/chain.py`

Responsibilities:
- fetch and validate the release-chain manifest;
- read local chain state and prior Host Autopilot receipts;
- select exactly one eligible next phase;
- require predecessor `APPLIED` evidence before advancing;
- materialize a local desired-state payload for the existing Host Autopilot transaction engine;
- never skip a failed, missing, ambiguous, or held predecessor;
- classify results as `DISABLED`, `NOOP`, `WAITING_PREDECESSOR`, `READY`, `APPLIED`, `ROLLED_BACK`, or `HOLD_FOUNDER_GATE`.

The controller never certifies a phase from source state alone. A phase becomes complete only from authoritative local transaction receipt evidence.

### 3. Local Chain State
Host paths:
- `~/daube-host-autopilot/state/native-chain-current.json`
- `~/daube-host-autopilot/state/native-chain-events.jsonl`
- `~/daube-host-autopilot/state/native-chain-receipts/<chain_id>/<phase_id>.json`

State is written atomically. Events are append-only. Re-running the same phase is idempotent when the exact `release_id` + `target_revision` has already reached `APPLIED`.

### 4. Systemd Runtime
New timer/service:
- `daube-native-autopilot-chain.service`
- `daube-native-autopilot-chain.timer`

Cadence: every 10 minutes with bounded randomized delay.

The service uses a kernel `flock` separate from but compatible with the existing deploy lock. It must not run a second activation while Host Autopilot is already mutating production.

### 5. Founder Kill Switch
Existing local kill switch remains authoritative:
`~/daube-host-autopilot/DISABLED`

If present, both single-release Host Autopilot and Native Release Chain return `DISABLED` without mutation.

No remote manifest may override the local kill switch.

## Phase Semantics
A phase is eligible only when all conditions are true:
1. chain `enabled=true`;
2. local Founder kill switch absent;
3. manifest validates;
4. exact target revision is a 40-hex SHA;
5. every artifact is repository-allowlisted and SHA-256 pinned;
6. predecessor is absent or has authoritative `APPLIED` receipt matching the predecessor phase's exact `release_id` and `target_revision`;
7. current phase has not already been applied at the same release ID and target revision;
8. no prior chain state is `HOLD_FOUNDER_GATE` for the current chain revision.

V1 advances at most one phase per service invocation. This prevents cascading multiple production mutations in one transaction and makes every transition externally auditable.

## Rollback
The existing Host Autopilot transaction rollback remains the phase-level rollback mechanism.

Rules:
- activation failure -> phase rollback;
- health failure -> phase rollback;
- rollback success -> `ROLLED_BACK`, chain stops;
- rollback failure -> `HOLD_FOUNDER_GATE`, chain stops;
- a later phase never runs after any predecessor `ROLLED_BACK` or `HOLD_FOUNDER_GATE`;
- V1 never performs a chain-wide reverse cascade automatically. Previous successfully applied phases remain as last-known-good unless their own transaction rollback ran during their activation.

## Exact-SHA Discipline
Every phase is pinned to one exact Git revision. All artifact download URLs use that revision. Activation receives the phase `target_revision` through the existing exact-revision environment contract.

`main`, branch names, tags, mutable URLs, and placeholder hashes are invalid in enabled phases.

## Security and Authority
- argv arrays only for checks;
- no secret values in manifests, receipts, logs, or GitHub;
- activation output is not treated as proof unless post-activation health and transaction receipt are green;
- self-heal remains restricted to the existing D’AUBE systemd allowlist;
- no arbitrary unit restart from remote manifest;
- no sudo policy widening;
- no SSH key, firewall, cloud-account, DNS, billing, payment, payout, identity, KYC, or tax mutation;
- no marketplace write authority is added by this feature.

## Observability
Each cycle records:
- timestamp;
- chain ID;
- selected phase or reason none was selected;
- predecessor evidence used;
- exact target revision;
- transaction result;
- receipt path;
- terminal classification.

Unknown/missing evidence is recorded as `WAITING_PREDECESSOR` or `HOLD_FOUNDER_GATE`, never PASS.

## Migration from ChatGPT Phase-2 Automation
Migration is staged:
1. merge and install Native Autopilot Chain runtime while the current ChatGPT Phase-2 automation remains enabled but unable to mutate unless its existing evidence gate passes;
2. publish a chain containing Host Autopilot self-update as already-applied Phase 1 and Execution Mesh V9 as Phase 2;
3. verify the host-native controller reads Phase 1 receipt and autonomously applies Phase 2;
4. verify V9 `APPLIED` receipt and required runtime timers;
5. retire/disable the ChatGPT `D’AUBE Autopilot Phase 2` automation only after native evidence proves the chain works.

The migration must never leave two independent actors able to activate the same new phase concurrently. Idempotency plus the deploy lock provide the technical guard; automation retirement completes the ownership transfer.

## Initial Chain
Phase 1:
- `phase_id`: `host-autopilot-self-update`
- `release_id`: `host-autopilot-self-update-747d3441`
- `target_revision`: `747d344103827e3aabdcbac95b413cbd0cbba0ec`
- expected status: already applied or waiting for its authoritative local receipt.

Phase 2:
- `phase_id`: `execution-mesh-v9`
- `release_id`: `v9-executor-89e7ea9e`
- `target_revision`: `89e7ea9e2ece88f5ffbc3f856b746aefca6a5427`
- depends on Phase 1 `APPLIED` evidence;
- required health units:
  - `daube-revenue-worker.timer`
  - `daube-freelancer-award-watcher.timer`
  - `daube-freelancer-executor.timer`
  - `daube-runtime-watchdog.timer`
  - `daube-freelancer-money-closure.timer`

## Testing
Offline deterministic tests must cover:
- valid and invalid chain manifests;
- exact-SHA enforcement;
- shell-string rejection;
- disabled chain;
- local kill switch;
- predecessor missing -> `WAITING_PREDECESSOR`;
- predecessor exact receipt match -> phase eligible;
- mismatched predecessor receipt -> blocked;
- one-phase-per-run behavior;
- same exact phase idempotency;
- prior rollback prevents successor;
- prior Founder hold prevents successor;
- exact revision propagation to activation;
- receipt persistence;
- deploy-lock mutual exclusion contract;
- no remote override of kill switch;
- no arbitrary systemd restart authority.

## Acceptance Criteria
Native Autopilot Chain V1 is complete only when:
1. full offline test suite passes;
2. installer passes `bash -n` and Python modules compile;
3. the new systemd timer is active on `daube-host-01`;
4. the controller observes the authoritative Phase 1 receipt locally;
5. without ChatGPT/Remote Commander issuing the deployment command, the host advances Phase 2;
6. Phase 2 produces authoritative local `APPLIED` evidence for `v9-executor-89e7ea9e`;
7. all five required D’AUBE runtime timers remain active;
8. the ChatGPT `D’AUBE Autopilot Phase 2` automation is retired only after criteria 1–7 are proved;
9. no spend, sensitive authority mutation, secret exposure, or fabricated evidence occurs.
