# D’AUBE Native Autopilot Chain V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move release-phase progression from ChatGPT scheduling into a persistent host-native state machine on `daube-host-01` that autonomously advances exact-SHA releases with receipts, health gates, rollback, and Founder kill-switch enforcement.

**Architecture:** Extend the existing Host Autopilot with a small `chain.py` orchestration layer that validates a declarative release-chain manifest, resolves predecessor evidence from local Host Autopilot receipts, and submits at most one eligible phase to the existing transaction engine per invocation. A dedicated systemd timer uses the same `~/daube-host-autopilot/deploy.lock` as the single-release controller so only one mutation can run at a time.

**Tech Stack:** Python 3.12 standard library, systemd timers/services, kernel `flock`, GitHub raw content, SHA-256 artifact pinning.

**Spec:** `docs/superpowers/specs/2026-09-05-daube-native-autopilot-chain-v1-design.md`

## Global Constraints

- No autonomous spend, billing, paid fallback, procurement, KYC, OTP, CAPTCHA, passkey, banking, payout, tax, identity, ownership, DNS, or permission widening.
- Founder local kill switch `~/daube-host-autopilot/DISABLED` always wins and cannot be overridden remotely.
- Every enabled release artifact is pinned to an exact 40-hex Git SHA and SHA-256 digest.
- Missing, stale, mismatched, rolled-back, or held predecessor evidence never becomes PASS.
- At most one release phase may activate per native-chain invocation.
- Native chain and single-release Host Autopilot share exactly one deploy lock: `~/daube-host-autopilot/deploy.lock`.
- ChatGPT Phase-2 automation is retired only after host-native evidence proves Phase 2 `APPLIED` and all required runtime timers are active.

---

### Task 1: Chain manifest validator and predecessor selection

**Files:**
- Create: `runtime/host-autopilot/chain.py`
- Modify: `runtime/host-autopilot/test_autopilot.py`

**Interfaces:**
- Produces `validate_chain(data) -> tuple[bool, str]`.
- Produces `select_phase(chain, receipt_loader, hold_state=None) -> dict` with classifications `DISABLED`, `NOOP`, `WAITING_PREDECESSOR`, `READY`, or `HOLD_FOUNDER_GATE`.
- Produces `phase_to_manifest(phase) -> dict` compatible with existing `manifest.validate_manifest`.

- [ ] Write failing tests for valid/invalid chain schemas, exact SHA, shell-string rejection, dependency ordering, predecessor receipt match/mismatch, prior rollback/hold, one-phase selection, and idempotency.
- [ ] Run `PYTHONPATH=runtime/host-autopilot python3 -m unittest -v runtime/host-autopilot/test_autopilot.py` and confirm the new tests fail because `chain.py` does not yet exist.
- [ ] Implement `chain.py` with strict validation and receipt-bound predecessor selection.
- [ ] Run the focused tests and require all green.
- [ ] Commit the task.

### Task 2: Host-native chain execution and receipt persistence

**Files:**
- Modify: `runtime/host-autopilot/run.py`
- Modify: `runtime/host-autopilot/test_autopilot.py`

**Interfaces:**
- Add `CHAIN_URL` for `.daube/autopilot/release-chain.json`.
- Add `native_chain_once()` that fetches the chain, selects one phase, invokes existing `transact()` for `READY`, and writes:
  - `state/native-chain-current.json`
  - `state/native-chain-events.jsonl`
  - `state/native-chain-receipts/<chain_id>/<phase_id>.json`
- Add CLI flag `--native-chain`.

- [ ] Write failing tests for kill switch, one-phase-per-run behavior, receipt persistence, exact revision propagation through existing activation env, and fail-closed predecessor states.
- [ ] Run focused tests and confirm red.
- [ ] Implement `native_chain_once()` with atomic writes and no direct marketplace/payment authority.
- [ ] Run focused tests, `python3 -m py_compile runtime/host-autopilot/*.py`, and `PYTHONPATH=runtime/host-autopilot python3 runtime/host-autopilot/run.py --verify`.
- [ ] Commit the task.

### Task 3: Native-chain installer and shared deploy lock

**Files:**
- Create: `installers/install-native-autopilot-chain-v1.sh`
- Modify: `runtime/host-autopilot/test_autopilot.py`

**Interfaces:**
- Installer stages exact-ref Host Autopilot runtime, executes full offline tests, then installs:
  - `daube-native-autopilot-chain.service`
  - `daube-native-autopilot-chain.timer`
- Service `ExecStart` must be `/usr/bin/flock -n $HOME/daube-host-autopilot/deploy.lock /usr/bin/python3 $HOME/daube-host-autopilot/runtime/run.py --native-chain`.
- Timer runs every 10 minutes with bounded randomized delay.

- [ ] Write static regression tests asserting shared lock path, `--native-chain`, no root user service, and no arbitrary remote systemd restart authority.
- [ ] Run tests and require red until installer exists.
- [ ] Implement installer with bootstrap rollback of its own systemd units, offline tests before unit mutation, and exact source ref support through `DAUBE_NATIVE_AUTOPILOT_REF`.
- [ ] Run full unit tests, `bash -n installers/install-native-autopilot-chain-v1.sh`, and Python compile.
- [ ] Commit the task.

### Task 4: Initial two-phase native release chain

**Files:**
- Create: `.daube/autopilot/release-chain.json`
- Test: `runtime/host-autopilot/test_autopilot.py`

**Interfaces:**
- Phase 1: `host-autopilot-self-update-747d3441` at exact revision `747d344103827e3aabdcbac95b413cbd0cbba0ec`.
- Phase 2: `v9-executor-89e7ea9e` at exact revision `89e7ea9e2ece88f5ffbc3f856b746aefca6a5427`, dependent on Phase 1.
- Each phase pins its installer SHA-256 and uses argv checks only.

- [ ] Compute SHA-256 from the exact repository artifact bytes for both installers.
- [ ] Write chain manifest with `enabled=true`, exact hashes, health units, and rollback required.
- [ ] Add validator test that loads the checked-in chain and requires `validate_chain(...)=OK`.
- [ ] Run full tests and manifest validation.
- [ ] Commit the task.

### Task 5: Final verification, PR, merge, and host bootstrap

**Files:**
- No new source files expected unless verification reveals a defect.

- [ ] Run fresh full test suite from the final branch tree.
- [ ] Run `python3 -m py_compile runtime/host-autopilot/*.py`.
- [ ] Run `bash -n installers/install-native-autopilot-chain-v1.sh`.
- [ ] Run `PYTHONPATH=runtime/host-autopilot python3 runtime/host-autopilot/run.py --verify`.
- [ ] Open PR and inspect changed files, mergeability, review threads, and workflow evidence; classify zero-step runner startup failures as `NO_DATA`, never source PASS.
- [ ] Merge only the exact verified PR head when repository state permits.
- [ ] Install Native Autopilot on `daube-host-01` through an available authorized host path. If Remote Desktop Commander is unavailable, use the already-running Host Autopilot self-update mechanism rather than requiring repeated Founder SSH when technically possible.
- [ ] Require host evidence: native timer active; Phase 1 authoritative receipt observed; Phase 2 advanced without ChatGPT issuing deployment; `v9-executor-89e7ea9e` receipt `APPLIED`; five required runtime timers active.
- [ ] Only then disable the ChatGPT `D’AUBE Autopilot Phase 2` automation.
