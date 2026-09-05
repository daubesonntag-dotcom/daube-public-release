# Freelancer V8 Provider-Neutral Executor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fail-closed provider-neutral execution and delivery pipeline for V7-authorized Freelancer engagements.

**Architecture:** Add a local executor state machine that consumes V7 job manifests, invokes an approved local coding runtime through an adapter, verifies real artifacts, and emits a delivery package. Keep Freelancer messaging/milestone writes behind evidence gates and preserve strict external-settlement revenue truth.

**Tech Stack:** Python 3.12 standard library, existing `freelancersdk`, systemd user-host services/timers, shell installer, unittest.

**Spec:** `docs/superpowers/specs/2026-09-05-freelancer-v8-provider-neutral-executor-design.md`

## Global Constraints
- No paid API/runtime fallback and no Founder spend.
- Maximum authorized automatic engagement scope remains 72 hours with one bounded revision cycle.
- Never expand scope, alter payout/bank/tax/identity/KYC, or use off-platform payment.
- No delivery without real artifact plus green QA evidence.
- Only authoritative externally settled payment may count as revenue.
- Marketplace writes use the official Freelancer SDK and are idempotent/fail-closed.

---

### Task 1: Executor core and state guards

**Files:**
- Create: `installers/install-freelancer-executor-v8.sh` (installer embeds focused Python modules under the host `full-loop/v8` directory)
- Test: embedded `test_executor.py`

**Interfaces:**
- Consumes: V7 `jobs/<project_id>/EXECUTOR_JOB.json`, `job.json`, `SCOPE.md`.
- Produces: `executor-state.json`, `events.jsonl`, `EXECUTION_BRIEF.md`, `NEEDS_INPUT.json`.

- [ ] Write failing offline tests proving invalid/missing V7 evidence is rejected, missing runtime/input enters a HOLD/WAIT state, and only `READY_FOR_EXECUTOR` jobs are claimable.
- [ ] Run `python -m unittest -v test_executor.py` and verify RED for missing executor functions.
- [ ] Implement minimal manifest validation, atomic per-job lock, state persistence, event ledger, and execution-brief generation.
- [ ] Run tests and verify GREEN.
- [ ] Commit executor core.

### Task 2: Provider-neutral runtime adapter

**Files:**
- Modify: `installers/install-freelancer-executor-v8.sh`
- Test: embedded `test_executor.py`

**Interfaces:**
- Produces: `detect_runtime() -> RuntimeChoice|None`; `execute_runtime(choice, brief, workspace) -> ExecutionResult`.

- [ ] Add failing tests for Codex preference, no-runtime fail-closed behavior, timeout/nonzero exit handling, and command construction that confines work to the job workspace.
- [ ] Verify RED.
- [ ] Implement Codex CLI detection and bounded invocation without paid fallback; do not infer authentication from binary presence alone when a non-writing probe can establish readiness.
- [ ] Verify GREEN.
- [ ] Commit adapter.

### Task 3: QA and delivery evidence gate

**Files:**
- Modify: `installers/install-freelancer-executor-v8.sh`
- Test: embedded `test_executor.py`

**Interfaces:**
- Produces: `qa/qa-report.json`, `delivery/manifest.json`, `delivery/HANDOFF.md`.

- [ ] Add failing tests that DELIVERY_READY is impossible with no artifact, failed required command, or absent QA report; add hash/idempotency test.
- [ ] Verify RED.
- [ ] Implement project check discovery for available test/lint/typecheck/build commands, command receipts, artifact inventory/hashes, handoff generation, and DELIVERY_READY transition.
- [ ] Verify GREEN.
- [ ] Commit QA gate.

### Task 4: Official Freelancer delivery and milestone controller

**Files:**
- Modify: `installers/install-freelancer-executor-v8.sh`
- Test: embedded `test_executor.py`

**Interfaces:**
- Consumes: V7 authoritative accept receipt plus V8 green delivery manifest.
- Produces: official messaging receipt, milestone-request receipt where contractually available, idempotency ledger.

- [ ] Add failing tests using deterministic fake marketplace interface: no acceptance receipt blocks delivery; duplicate delivery is suppressed; milestone request requires delivery receipt and a requestable milestone; no state is labeled revenue.
- [ ] Verify RED.
- [ ] Implement official SDK wrapper and evidence gates. Do not release/withdraw/move funds.
- [ ] Verify GREEN.
- [ ] Commit delivery controller.

### Task 5: systemd installation, offline smoke test, and operational handoff

**Files:**
- Modify: `installers/install-freelancer-executor-v8.sh`

**Interfaces:**
- Produces: `daube-freelancer-executor.service`, `daube-freelancer-executor.timer`; dry-run output with no marketplace write.

- [ ] Add installer syntax validation and embedded offline fixture that traverses READY_FOR_EXECUTOR to DELIVERY_READY using a fake executor command and fake marketplace.
- [ ] Run shell syntax check and unit suite; verify fixture cannot contact Freelancer.
- [ ] Install systemd one-shot executor timer at 15-minute cadence, with `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict`, and write access limited to D’AUBE worker/job paths.
- [ ] Print runtime readiness, three timer states, queue counts, and latest evidence; never print secrets.
- [ ] Commit installer and verification.

### Task 6: Branch verification and review

**Files:**
- Review all V8 changes.

- [ ] Verify no token/secret literals exist in the diff.
- [ ] Verify the installer is shell-syntax valid by inspection plus host-side installer check instructions.
- [ ] Verify all unit tests are embedded and default installer runs them before enabling the timer.
- [ ] Open PR against `main` with explicit Production Truth limitations: no real award means no claim of real execution/delivery/payment.
