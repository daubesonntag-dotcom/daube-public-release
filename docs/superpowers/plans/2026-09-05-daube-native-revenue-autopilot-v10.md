# D’AUBE Native Revenue Autopilot V10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent host-native revenue orchestration layer that composes the existing scout, award watcher, V9 executor, money-closure and authoritative receipts into one truthful lifecycle without ChatGPT control-plane dependency.

**Architecture:** `runtime/revenue-v10` remains a thin orchestration layer. `evidence.py` resolves local truth, `providers.py` exposes explicit provider capabilities, `concierge.py` gates/deduplicates routine communication intents, and `controller.py` derives canonical project state and starts only allowlisted existing services. The installer activates one systemd timer from an exact Git SHA; Native Host Autopilot deploys it as a phase after V9.

**Tech Stack:** Python 3.12+, stdlib only for V10 core; existing `freelancersdk` remains inside existing workers; systemd; Bash installer; JSON/JSONL state.

**Spec:** `docs/superpowers/specs/2026-09-05-daube-native-revenue-autopilot-v10-design.md`

## Global Constraints
- No browser automation, scraping, CAPTCHA bypass, paid Connects/boosts, subscriptions or paid fallback.
- No KYC, identity, tax, bank or payout mutation.
- Revenue is true only from existing authoritative external-settlement ledger rows.
- V10 may start only `daube-revenue-worker.service`, `daube-freelancer-award-watcher.service`, `daube-freelancer-executor.service`, and `daube-freelancer-money-closure.service`.
- Unknown, contradictory or malformed evidence fails closed.
- Existing receipts remain authoritative; V10 never invents marketplace success.

---

### Task 1: Evidence resolver and lifecycle model

**Files:**
- Create: `runtime/revenue-v10/evidence.py`
- Create: `runtime/revenue-v10/test_v10.py`

**Interfaces:**
- Produces `resolve_project(project_id: int, roots: dict[str, Path]) -> dict` and `canonical_state(evidence: dict) -> str`.

- [ ] Write tests proving malformed/mismatched receipts are rejected; accepted award, delivery, revision, pending release and settlement precedence are conservative; bids/awards/pending milestones never imply revenue.
- [ ] Run `PYTHONPATH=runtime/revenue-v10 python3 -m unittest -v runtime/revenue-v10/test_v10.py`; expected RED because module does not exist.
- [ ] Implement exact-ID matching, authoritative-marker checks, strict settlement-ledger admission and canonical state precedence.
- [ ] Re-run focused tests; expected PASS.

### Task 2: Provider capability and client concierge policy

**Files:**
- Create: `runtime/revenue-v10/providers.py`
- Create: `runtime/revenue-v10/concierge.py`
- Modify: `runtime/revenue-v10/test_v10.py`

**Interfaces:**
- `provider_capabilities(name: str) -> dict[str, bool]` returns explicit capability flags.
- `classify_client_request(text: str, revision_count: int) -> str` returns `SAFE_REPLY`, `FOUNDER_GATE`, or `NO_ACTION`.
- `may_send(intent: str, relationship_verified: bool, sent: dict, now_ts: float, last_status_ts: float|None, responding_to_new_activity: bool=False) -> tuple[bool,str]`.

- [ ] Add RED tests for unsupported provider writes, no unsolicited communication, intent deduplication, six-hour status limit, one-revision cap, scope/risk/off-platform/payment/identity triggers and secret redaction.
- [ ] Implement capability map with Freelancer enabled only for capabilities already supplied by existing official workers; Upwork/Fiverr writes false by default.
- [ ] Implement deterministic concierge policy; no direct provider write calls in V10 core.
- [ ] Re-run tests; expected PASS.

### Task 3: Native controller and atomic audit

**Files:**
- Create: `runtime/revenue-v10/controller.py`
- Modify: `runtime/revenue-v10/test_v10.py`

**Interfaces:**
- `ALLOWED_SERVICES` exact frozen set.
- `choose_action(snapshot: dict) -> str|None` maps lifecycle states to one eligible existing worker service.
- `run_once(root: Path, service_starter: Callable[[str], bool]) -> dict` writes `state.json`, per-project JSON, append-only `events.jsonl`.

- [ ] Add RED tests for service allowlist enforcement, one action per project cycle, terminal hold precedence, atomic JSON writes and no secret persistence.
- [ ] Implement project discovery from local receipt/job roots and canonical state derivation.
- [ ] Start only allowlisted services; never restart unknown units or count internal/test evidence as revenue.
- [ ] Re-run full V10 tests; expected PASS.

### Task 4: Installer and systemd cutover

**Files:**
- Create: `installers/install-native-revenue-autopilot-v10.sh`
- Modify: `runtime/revenue-v10/test_v10.py` only if installer-contract fixtures are needed.

**Interfaces:**
- Installer accepts `DAUBE_REVENUE_V10_REF` or `DAUBE_AUTOPILOT_TARGET_REVISION`, requiring exact lowercase 40-hex SHA.
- Installs `daube-native-revenue-autopilot.service` and `.timer`.

- [ ] Write shell contract: require readable Freelancer token and executable existing venv without printing secrets; fetch V10 files from exact SHA; run tests + py_compile before activation; snapshot/rollback prior V10 unit files.
- [ ] Service runs `controller.py` as the normal user with HOME set, `NoNewPrivileges=true`, `PrivateTmp=true`, and bounded writable path under `~/daube-revenue-worker/v10`.
- [ ] Timer cadence 10 minutes with randomized delay; verify all five existing revenue timers remain active.
- [ ] Run `bash -n installers/install-native-revenue-autopilot-v10.sh`; expected PASS.

### Task 5: Native Autopilot release-chain admission

**Files:**
- Modify: `.daube/autopilot/release-chain.json`

**Interfaces:**
- Add one phase after `execution-mesh-v9` with exact commit SHA and SHA-256 of `installers/install-native-revenue-autopilot-v10.sh`.
- Health units include `daube-native-revenue-autopilot.timer` plus the five existing revenue timers.

- [ ] Compute installer SHA-256 from the exact commit containing the installer.
- [ ] Add phase `native-revenue-autopilot-v10`, `success_receipt=APPLIED`, `rollback=required` through existing chain schema.
- [ ] Validate chain using existing Host Autopilot chain validator.

### Task 6: Final verification and integration

- [ ] Run fresh full V10 unittest suite; require zero failures.
- [ ] Run `python3 -m py_compile runtime/revenue-v10/*.py`.
- [ ] Run installer `bash -n`.
- [ ] Review diff for secrets, arbitrary systemctl targets, browser automation, spend/payment mutation and fabricated revenue paths; require none.
- [ ] Create PR against `main`, inspect exact-head changed files and CI evidence, merge only exact head when admissible.
- [ ] Publish the V10 chain phase without overwriting an unrelated current desired-state release; Native Autopilot performs host installation and authoritative receipt verification.
