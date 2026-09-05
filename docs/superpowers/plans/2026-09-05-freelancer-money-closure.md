# Freelancer Money Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close verified Freelancer engagements from delivery through bounded revision, milestone release request, and settlement-only revenue ledger.

**Architecture:** Add a separate post-execution controller that consumes authoritative V7/V8 evidence and uses only official Freelancer SDK messaging/milestone APIs. All marketplace writes are idempotent and fail closed; revenue is append-only and only admitted from official released/paid milestone evidence.

**Tech Stack:** Python 3.12, existing `freelancersdk`, zipfile/hashlib/json standard library, systemd, unittest.

**Spec:** `docs/superpowers/specs/2026-09-05-freelancer-money-closure-design.md`

## Global Constraints
- No payout/bank/tax/identity/KYC changes or off-platform payment.
- No fund withdrawal/destination changes.
- One bounded automatic revision cycle maximum.
- No delivery without real artifacts and green QA evidence.
- No revenue from bid/award/delivery/request/pending milestone states.
- Secrets are never bundled or logged.

---

### Task 1: Pure evidence and state classifiers
- [ ] Write failing tests for delivery eligibility, revision scope guard, revision cap, milestone-release eligibility, and settlement classification.
- [ ] Verify RED.
- [ ] Implement minimal pure functions.
- [ ] Verify GREEN.

### Task 2: Delivery packaging and official messaging
- [ ] Add deterministic tests for idempotency and bundle content exclusion.
- [ ] Implement zip bundle, official project thread/message selection, `post_message`, `post_attachment` and delivery receipt.
- [ ] Fail closed on any attachment/message error.

### Task 3: Client reply and one bounded revision
- [ ] Add tests for no reply, in-scope reply, scope expansion, and second revision.
- [ ] Implement official message reads and revision request handoff to executor.

### Task 4: Milestone release and settlement ledger
- [ ] Add tests for release-request gating and settlement-only ledger admission.
- [ ] Implement `get_milestones` and `request_release_milestone_payment` wrapper.
- [ ] Append only clearly released/paid milestones; dedupe by milestone ID/project ID.

### Task 5: Hardened timer and verification
- [ ] Installer runs unit tests + compile before activation.
- [ ] Install 15-minute oneshot/timer with worker-directory-only write access and read-only token/venv.
- [ ] Print queue/state counts without secrets.

### Task 6: PR review and merge
- [ ] Verify no secrets/destructive fund operations.
- [ ] Open PR.
- [ ] Merge only if mergeable/check gates are clear.
- [ ] Pin production installer to merge commit.