# D’AUBE Autonomous Business Operator V11 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a host-native business operating loop that turns existing V9/V10 evidence into prioritized next actions, CRM memory, conversion learning, and founder-gated dispatch without creating a second revenue truth plane.

**Architecture:** V11 is a single-writer controller under `runtime/business-v11/`. It reads existing revenue-worker/V9/V10/money-closure artifacts, normalizes them into evidence snapshots, updates client CRM records, scores candidate next actions, dispatches only allowlisted systemd services, records conversion outcomes, and emits atomic control-tower/queue/receipt files. It never mutates payout, KYC, bank, tax, identity, pricing credits, or external settlement truth.

**Tech Stack:** Python 3.12 standard library, JSON/JSONL, `fcntl.flock`, systemd oneshot+timer, existing D’AUBE host paths.

**Spec:** `docs/superpowers/specs/2026-09-05-autonomous-business-operator-v11-design.md`

## Global Constraints

- Founder sovereignty and kill-switch remain absolute.
- No spend, paid credits, boosts, subscriptions, payout/bank/tax/KYC/identity mutation.
- Revenue is authoritative only from existing external-settlement evidence.
- Business lock is separate from deploy lock.
- V11 dispatch is allowlisted to existing revenue execution services only.
- Missing/ambiguous evidence fails closed into `FOUNDER_GATE` or `WAIT_EVIDENCE`.
- No browser bots, scraping bypasses, CAPTCHA bypasses, or off-platform payment automation.

---

### Task 1: Evidence + CRM + Priority Core

**Files:**
- Create: `runtime/business-v11/models.py`
- Create: `runtime/business-v11/evidence.py`
- Create: `runtime/business-v11/crm.py`
- Create: `runtime/business-v11/priority.py`
- Test: `runtime/business-v11/test_v11.py`

**Interfaces:**
- `collect_business_evidence(home: Path) -> dict`
- `merge_client_records(existing: dict, evidence: dict) -> dict`
- `score_action(action: dict) -> float`
- `build_queue(evidence: dict, crm: dict) -> list[dict]`

- [ ] Write failing tests for settlement truth, secret scrubbing, CRM merge, deterministic priority, and founder-gated risky actions.
- [ ] Run focused unittest file and verify RED.
- [ ] Implement minimal modules.
- [ ] Run focused unittest file and verify GREEN.
- [ ] Commit.

### Task 2: Conversion Learning + Control Tower

**Files:**
- Create: `runtime/business-v11/learning.py`
- Create: `runtime/business-v11/controller.py`
- Modify test: `runtime/business-v11/test_v11.py`

**Interfaces:**
- `summarize_conversion(events: list[dict]) -> dict`
- `BusinessOperator.run_once() -> dict`

- [ ] Add failing tests for funnel counting, no synthetic revenue uplift, atomic state, and single-writer locking.
- [ ] Run tests and verify RED.
- [ ] Implement learning and controller.
- [ ] Run tests and verify GREEN.
- [ ] Commit.

### Task 3: Allowlisted Dispatch + Founder Gates

**Files:**
- Create: `runtime/business-v11/dispatch.py`
- Modify: `runtime/business-v11/controller.py`
- Modify test: `runtime/business-v11/test_v11.py`

**Interfaces:**
- `dispatch_action(action: dict, runner) -> dict`

- [ ] Add failing tests proving only approved services can be started and all spend/KYC/payout/legal-risk actions become founder gates.
- [ ] Implement dispatch allowlist and bounded action mapping.
- [ ] Run tests and verify GREEN.
- [ ] Commit.

### Task 4: Runtime Entrypoint + Installer + systemd

**Files:**
- Create: `runtime/business-v11/run.py`
- Create: `installers/install-autonomous-business-operator-v11.sh`
- Test: `runtime/business-v11/test_runtime.py`

**Interfaces:**
- `python3 run.py --verify`
- systemd: `daube-business-operator.service`, `daube-business-operator.timer`

- [ ] Add runtime/import verification test.
- [ ] Implement CLI and installer with exact-ref download, pre-activation tests, rollback, no secret output, and systemd hardening.
- [ ] Verify Python compile, unit tests, `bash -n`, and `run.py --verify`.
- [ ] Commit.

### Task 5: Native Autopilot Phase + Final Verification

**Files:**
- Modify: `.daube/autopilot/release-chain.json`

**Interfaces:**
- New phase depends on `native-revenue-autopilot-v10` and succeeds only on `APPLIED` receipt.

- [ ] Pin exact implementation commit and installer SHA-256.
- [ ] Add V11 phase with health unit `daube-business-operator.timer` plus existing V10 health dependencies.
- [ ] Validate chain structure and exact digest.
- [ ] Run full V11 tests/compile/installer syntax/forbidden-capability scan.
- [ ] Open PR, review exact head, merge only if admissible.
