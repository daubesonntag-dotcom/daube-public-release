# D’AUBE Autonomous Revenue Worker Closure

Status: ACTIVE / fail-closed

## Objective
Operate the commercial loop with minimal Founder intervention:

Scout -> qualify -> official authenticated submit -> bounded negotiation -> standard contract acceptance -> execution -> QA -> delivery -> payment release request -> authoritative settlement ledger.

## Authority boundaries
Routine proposal submission is allowed only through an official authenticated API/MCP/integration that explicitly permits the exact action. Standard platform-native fixed-price engagements may be accepted automatically only when they stay inside the Founder-authorized bounded contract policy. All KYC/OTP/CAPTCHA, non-standard legal documents, tax/payout changes, paid spend, credential sharing, identity/location misrepresentation, unofficial browser automation, or off-platform payment requirements fail closed to FOUNDER_GATE.

## Revenue truth
Only authoritative external settlement evidence counts as revenue. Proposals, interviews, awards, funded milestones, pending releases, self-payments, synthetic events, or internal receipts are not revenue.

## Persistent worker state machine

- DISCOVER
- QUALIFY
- PREPARE_APPLICATION
- OFFICIAL_SUBMIT or FOUNDER_PLATFORM_GATE
- CLIENT_RESPONSE
- CONTRACT_POLICY_CHECK
- ACCEPT_STANDARD or FOUNDER_CONTRACT_GATE
- FREEZE_SCOPE
- EXECUTE
- VERIFY
- DELIVER
- REVISION_WINDOW
- REQUEST_RELEASE
- AWAIT_SETTLEMENT
- SETTLED
- CLOSED

Every transition must record platform/source, authoritative external identifier when available, timestamp, evidence reference, current blocker, and next allowed action.

## Commercial ranking
Rank opportunities by expected net value, skill fit, competition, client credibility/spend history, bounded delivery effort, D’AUBE evidence match, payment collectability, and risk. Reject bait pricing, unclear/unbounded scope, unpaid tests, regulated/high-liability work, suspicious credential/payment requests, identity/location deception, unverifiable claims, and work below USD 25 equivalent unless strategically exceptional. Prefer >= USD 80 fixed.

## Delivery policy
Freeze scope and acceptance criteria before implementation. Use a dedicated workspace/branch. Run appropriate lint/type/build/unit/integration/browser/QA/security/accessibility checks. Never fabricate tests, deployment, completion, acceptance, or settlement. One normal revision cycle is included unless the engagement says otherwise; scope expansion requires a paid change order or explicit client agreement.

## Notification policy
Notify Founder only for: provider-mandated human apply/confirm, official auto-submission, client response/award/contract acceptance, delivery completion/material issue, Founder-only KYC/OTP/CAPTCHA/non-standard contract/tax/payout action, or externally settled revenue.

## Closure requirement
This document is governance only. Runtime is not considered autonomous until a persistent executor has authoritative marketplace auth binding, scheduler/trigger, durable state, duplicate-suppression, official submit/delivery/payment adapters, and settlement reconciliation evidence.
