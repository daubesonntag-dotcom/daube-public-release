# D’AUBE Host Autopilot V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a host-resident desired-state deployer that can stage, verify, activate, health-check, self-heal, and roll back approved D’AUBE runtime releases without depending on a live ChatGPT Remote Desktop Commander session.

**Architecture:** A small Python control plane runs under systemd on the persistent VM. It reads a public desired-state manifest from GitHub, fetches only target-revision-pinned artifacts, verifies hashes and declared checks, then activates through an allowlisted installer transaction with snapshot/rollback. A separate watchdog lane preserves autopilot availability and evidence while unrelated revenue/business timers continue independently.

**Tech Stack:** Python 3.12 standard library, Bash, systemd user/system units, `flock`, GitHub raw content, SHA-256, `unittest`.

**Spec:** `docs/superpowers/specs/2026-09-05-host-autopilot-v1-design.md`

## Global Constraints
- No paid services, subscriptions, credits, boosts, paid compute, or paid API fallback.
- No payout, bank, tax, identity, KYC, billing, SSH-key, sudoers, firewall, or cloud-account-policy changes.
- No arbitrary shell strings from remote desired state; only argv arrays and allowlisted installer entrypoints.
- Activation artifacts must be fetched from an exact 40-hex Git revision and match SHA-256.
- Founder override is absolute; local `~/daube-host-autopilot/DISABLED` blocks new deployments.
- Revenue and other business timers are independent and must not be stopped on autopilot failure.
- Any failed post-snapshot activation or health gate triggers rollback; rollback failure becomes `HOLD_FOUNDER_GATE`.

---

### Task 1: Manifest model and validator

**Files:**
- Create: `runtime/host-autopilot/models.py`
- Create: `runtime/host-autopilot/manifest.py`
- Create: `runtime/host-autopilot/test_autopilot.py`

**Interfaces:**
- `validate_manifest(data: dict) -> tuple[bool, str]`
- `load_manifest_bytes(raw: bytes) -> dict`
- atomic JSON/event helpers in `models.py`.

- [ ] Write failing tests for schema, exact 40-hex revision, artifact SHA-256, argv-only checks, allowlisted activation entrypoint, and rollback required.
- [ ] Run `PYTHONPATH=runtime/host-autopilot python3 -m unittest -v runtime/host-autopilot/test_autopilot.py` and verify RED.
- [ ] Implement minimal validator; reject shell strings, paths outside `installers/` or `runtime/`, and duplicate artifact paths.
- [ ] Re-run tests and verify GREEN.

### Task 2: Fetch/stage/hash lane

**Files:**
- Create: `runtime/host-autopilot/stage.py`
- Modify: `runtime/host-autopilot/test_autopilot.py`

**Interfaces:**
- `artifact_url(repo: str, revision: str, path: str) -> str`
- `stage_release(manifest: dict, stage_dir: Path, fetcher) -> dict`

- [ ] Add failing tests proving URLs are pinned to target SHA, SHA mismatch fails, duplicate release does not restage, and file modes are validated.
- [ ] Implement staging using injected fetcher for offline tests; write artifact bytes only below stage dir and verify SHA before rename.
- [ ] Verify GREEN.

### Task 3: Check runner and evidence redaction

**Files:**
- Create: `runtime/host-autopilot/checks.py`
- Modify: `runtime/host-autopilot/test_autopilot.py`

**Interfaces:**
- `run_checks(stage_dir: Path, checks: list[list[str]], runner) -> dict`
- `redact_text(text: str) -> str`

- [ ] Add failing tests for argv-only execution, cwd confinement, nonzero failure, timeout classification, and secret-like redaction.
- [ ] Implement bounded command runner with no `shell=True`, capped output excerpts, and redaction.
- [ ] Verify GREEN.

### Task 4: Transaction state machine and activation/rollback

**Files:**
- Create: `runtime/host-autopilot/transaction.py`
- Modify: `runtime/host-autopilot/test_autopilot.py`

**Interfaces:**
- `run_transaction(manifest, paths, adapters) -> dict`
- states: `DISCOVERED`, `STAGED`, `VERIFIED`, `SNAPSHOTTED`, `ACTIVATING`, `HEALTH_CHECK`, `APPLIED`, `FAILED`, `ROLLING_BACK`, `ROLLED_BACK`, `HOLD_FOUNDER_GATE`.

- [ ] Add failing tests for kill switch, activation failure rollback, health failure rollback, rollback failure hold, idempotent last-applied behavior, and unrelated timer preservation.
- [ ] Implement snapshot and adapter boundaries; transaction never stops unrelated timers.
- [ ] Verify GREEN.

### Task 5: Watcher/controller lane

**Files:**
- Create: `runtime/host-autopilot/controller.py`
- Create: `runtime/host-autopilot/run.py`
- Modify: `runtime/host-autopilot/test_autopilot.py`

**Interfaces:**
- `poll_once(config, adapters) -> dict`
- CLI flags: `--verify`, `--once`.

- [ ] Add failing tests for disabled manifest, no-op same revision, new release transaction dispatch, and malformed remote manifest fail-closed.
- [ ] Implement controller with kernel-lock expectation and atomic current/last-applied/receipt state.
- [ ] Verify GREEN and `python3 runtime/host-autopilot/run.py --verify`.

### Task 6: Watchdog lane

**Files:**
- Create: `runtime/host-autopilot/watchdog.py`
- Modify: `runtime/host-autopilot/test_autopilot.py`

**Interfaces:**
- `evaluate_health(expected_units: list[str], unit_reader) -> dict`
- `self_heal(report, restarter, allowlist) -> dict`

- [ ] Add failing tests that only allowlisted D’AUBE timers may be restarted and unknown/system units are never touched.
- [ ] Implement health report and bounded self-heal for autopilot timers plus configured expected D’AUBE timers.
- [ ] Verify GREEN.

### Task 7: Bootstrap installer and systemd

**Files:**
- Create: `installers/install-host-autopilot-v1.sh`
- Create: `.daube/autopilot/host-desired-state.json`

**Interfaces:**
- Install runtime to `~/daube-host-autopilot/runtime`.
- Install `daube-host-autopilot.service/.timer` and `daube-host-autopilot-watchdog.service/.timer`.
- Initial desired state uses `enabled: false` so bootstrap cannot change business runtimes.

- [ ] Write installer with stage-first verification; run Python tests and compile before writing units.
- [ ] Add `flock` around deploy service entrypoint.
- [ ] Install timers at ~10-minute cadence with persistence and randomized delay.
- [ ] Add systemd hardening and narrow writable paths.
- [ ] Add installer rollback for partial bootstrap failure.
- [ ] Verify `bash -n installers/install-host-autopilot-v1.sh`.

### Task 8: Production fixture release for V9 executor cutover

**Files:**
- Modify: `.daube/autopilot/host-desired-state.json`
- Add exact hashes for `installers/install-freelancer-execution-mesh-v9.sh` and required runtime files from merge commit `89e7ea9e2ece88f5ffbc3f856b746aefca6a5427` only after repository-byte hashes are computed and verified.

- [ ] Keep manifest disabled until host autopilot bootstrap is verified.
- [ ] After bootstrap evidence exists, enable a V9 release manifest pinned to exact merge revision.
- [ ] Verify staging/checks/activation/health receipt on host.
- [ ] Confirm all existing revenue/award/executor/watchdog/money-closure timers remain active except the executor entrypoint intentionally upgraded V8→V9.
- [ ] Confirm rollback script/path exists and a no-op subsequent poll does not redeploy.

### Task 9: Final verification and PR

- [ ] Run full `unittest` suite.
- [ ] Run `python3 -m py_compile runtime/host-autopilot/*.py`.
- [ ] Run `bash -n installers/install-host-autopilot-v1.sh`.
- [ ] Run `python3 runtime/host-autopilot/run.py --verify`.
- [ ] Review changed paths against Founder sovereignty protected paths.
- [ ] Open PR, inspect mergeability and CI truth, and merge only with exact head SHA after evidence is acceptable.
