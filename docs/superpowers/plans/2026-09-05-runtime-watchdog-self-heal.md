# Runtime Watchdog + Self-Heal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fail-closed 10-minute watchdog that detects and safely heals bounded runtime failures across the D’AUBE Freelancer worker stack.

**Architecture:** A Python watchdog performs independent checks and writes atomic health/evidence records. A hardened systemd oneshot/timer invokes it; only an explicit allowlist of safe timer restarts and proven stale-lock cleanup is self-healed.

**Tech Stack:** Python 3.12 standard library, systemd, shell installer, unittest.

**Spec:** `docs/superpowers/specs/2026-09-05-runtime-watchdog-self-heal-design.md`

## Global Constraints
- No reboot/package install/paid fallback.
- No credential rotation or payout/bank/tax/identity/KYC changes.
- No marketplace commercial writes or fund movement.
- Never log secret token contents.
- HOLD conditions are never auto-overridden.

---

### Task 1: Pure health classification
**Files:** Create `installers/install-runtime-watchdog-v1.sh`; embedded `watchdog.py`, `test_watchdog.py`.
- [ ] Write failing tests for auth classification, disk thresholds, stale-lock threshold, aggregate state.
- [ ] Verify RED.
- [ ] Implement pure classification helpers.
- [ ] Verify GREEN.

### Task 2: Runtime probes and bounded self-heal
**Files:** Modify installer embedded `watchdog.py`.
- [ ] Add tests for allowlisted timer recovery and stale-lock decision logic using fakes.
- [ ] Implement systemd checks/restart allowlist, read-only Freelancer probe, strict Codex auth probe, disk check, stale-lock scan.
- [ ] Persist `health.json`, `incidents.jsonl`, and `FOUNDER_ACTION_REQUIRED.json` atomically without secrets.
- [ ] Verify tests.

### Task 3: Hardened systemd installer
**Files:** Modify `installers/install-runtime-watchdog-v1.sh`.
- [ ] Run unit tests and compile before activation.
- [ ] Install `daube-runtime-watchdog.service` and `.timer` with 10-minute cadence, NoNewPrivileges, PrivateTmp, ProtectSystem=strict, and write access limited to the D’AUBE worker directory.
- [ ] Start once and print overall state plus four timer states.

### Task 4: Review and merge
- [ ] Verify no secrets or destructive commands in diff.
- [ ] Open PR.
- [ ] Merge only after mergeability/check gates are clear.
- [ ] Pin production installer to merge commit for host deployment.