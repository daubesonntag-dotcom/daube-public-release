# D’AUBE Runtime Watchdog + Self-Heal Design

## Goal
Keep the D’AUBE Freelancer revenue runtime healthy without requiring the Founder to babysit SSH. Detect silent failures across marketplace auth, Codex auth, timers, stale execution locks, scheduler freshness, and disk pressure; repair only bounded safe failures; fail closed with evidence when human action is required.

## Monitored surfaces
1. `daube-revenue-worker.timer`
2. `daube-freelancer-award-watcher.timer`
3. `daube-freelancer-executor.timer`
4. Freelancer API token/authentication through a read-only `/users/0.1/self/` probe
5. Codex CLI login status
6. systemd timer freshness and last/next trigger metadata
7. stale `.executor.lock` files in job workspaces
8. filesystem free space for `$HOME`

## Self-heal policy
The watchdog may enable/start/restart the three known D’AUBE timers, remove only executor lock files proven stale and not held by an active executor service, and write health/incident evidence under `~/daube-revenue-worker/watchdog`.

It must not reboot the host, install packages, rotate credentials, modify payout/bank/tax/identity/KYC, buy anything, delete client artifacts, alter contract state, submit bids, accept awards, deliver work, or move funds.

## Fail-closed escalation
Failures requiring credentials or human authorization produce `FOUNDER_ACTION_REQUIRED.json` containing only the problem class and remediation hint; secrets and raw tokens are never included. Examples: Freelancer 401/403, Codex logged out, disk critically low, repeated service failure, ambiguous stale lock.

## Health model
Each check produces PASS, HEALED, WARN, or HOLD. Overall state is HEALTHY only when every required check is PASS/HEALED. HOLD never gets auto-overridden. The current report is written atomically to `health.json`; transitions append to `incidents.jsonl`.

## Cadence
A hardened systemd oneshot runs every 10 minutes with randomized delay. It is independent from the three business timers so it can recover them.

## Success criteria
- Offline unit tests cover auth classification, disk thresholds, stale-lock policy, and aggregate health.
- Installer runs tests and Python compile before enabling the watchdog.
- A host with the three business timers active, valid Freelancer auth, valid Codex auth, adequate disk, and no stale locks reports HEALTHY.
- Disabling a known timer is safely healed on the next watchdog run.
- Auth failure creates a Founder-action record but never changes credentials.