# D’AUBE Host Autopilot V1 Design

## Goal
Make the persistent D’AUBE VM capable of updating, verifying, activating, repairing, and rolling back approved runtime changes without depending on an active ChatGPT Remote Desktop Commander session.

## Operating model
The host is the durable control plane. GitHub is the desired-state source. Remote Desktop Commander is optional operator access, not a runtime dependency.

The system is split into four independent lanes:

1. **Watcher lane** — periodically reads the public desired-state manifest from `main` and detects a new approved target revision.
2. **Stage/verify lane** — downloads only allowlisted artifacts pinned to the target commit, verifies SHA-256 digests, runs declared offline checks, and produces a staging receipt.
3. **Activation/rollback lane** — snapshots the current allowlisted service files, activates only after staging passes, runs post-activation health checks, and automatically restores the snapshot on failure.
4. **Watchdog/evidence lane** — continuously checks autopilot health, detects stuck or failed deployments, records immutable-style receipts, and may self-heal only allowlisted timers/services.

Revenue acquisition, award watching, execution, money closure, and other business timers remain independent and must not be stopped merely because an autopilot check fails.

## Desired-state manifest
Repository path: `.daube/autopilot/host-desired-state.json`.

Required schema:

```json
{
  "schema": "daube.host-autopilot.v1",
  "enabled": true,
  "target_revision": "40-hex-git-sha",
  "release_id": "string",
  "artifacts": [
    {
      "path": "installers/example.sh",
      "sha256": "64-hex-sha256",
      "mode": "0755"
    }
  ],
  "checks": [
    ["bash", "-n", "installers/example.sh"]
  ],
  "activation": {
    "kind": "installer",
    "entrypoint": "installers/example.sh"
  },
  "health_units": ["daube-runtime-watchdog.timer"],
  "rollback": "required"
}
```

The host must fetch artifact bytes from URLs pinned to `target_revision`, never from a floating branch for activation.

## Safety boundary
Autopilot is allowlist-only. It may:
- read public GitHub repository state;
- write under `~/daube-host-autopilot` and existing D’AUBE runtime directories explicitly named by an approved installer;
- restart/enable only explicitly allowlisted D’AUBE systemd units;
- execute only the manifest-declared installer/checks after local validation;
- restore its own snapshots.

It must never:
- purchase, subscribe, boost, create paid compute, or enable paid API fallback;
- alter payout, bank, tax, identity, KYC, marketplace credentials, SSH authorized keys, sudoers, firewall, billing, or cloud account policy;
- expose secrets in logs or receipts;
- execute arbitrary shell strings from the manifest;
- automatically reboot the host;
- disable Founder controls;
- infer success from process launch alone.

Founder override remains absolute. A local kill switch `~/daube-host-autopilot/DISABLED` stops new deployments while leaving current production running.

## Concurrency
Use a kernel `flock` deployment lock. Watcher and watchdog may run concurrently, but only one stage/activation transaction may run at a time. The transaction is idempotent by `(release_id, target_revision)` and repeated timer runs must not redeploy the same successful revision.

## Verification and rollback
A deployment transaction is:

`DISCOVERED -> STAGED -> VERIFIED -> SNAPSHOTTED -> ACTIVATING -> HEALTH_CHECK -> APPLIED`

Any failure after snapshot becomes:

`FAILED -> ROLLING_BACK -> ROLLED_BACK`

If rollback itself fails, enter `HOLD_FOUNDER_GATE` and stop further deployments. Existing unrelated D’AUBE business timers must remain untouched.

Success requires all of:
- exact target revision recorded;
- every artifact SHA-256 matches manifest;
- all declared checks exit 0;
- activation exits 0;
- every declared health unit is active after activation;
- receipt persisted atomically.

## Evidence
Persist under `~/daube-host-autopilot/state/`:
- `current.json` — last observed desired state;
- `last-applied.json` — exact successfully applied release/revision;
- `transaction.json` — current transaction state;
- `events.jsonl` — timestamped events;
- `receipts/<release_id>.json` — artifact hashes, check results, activation result, health results, rollback evidence.

No secret values are permitted in evidence.

## systemd
Install:
- `daube-host-autopilot.service` + `.timer` — watcher/deployer every ~10 minutes;
- `daube-host-autopilot-watchdog.service` + `.timer` — health/self-heal every ~10 minutes.

Both are persistent across reboot. The deploy service is oneshot and guarded by `flock`; watchdog may only restart these two timers and other explicitly allowlisted D’AUBE timers if they were previously expected active.

## Bootstrap
The first installation is the only step that may require an already-working host control path. After bootstrap, future approved releases are pulled by the host itself.

Bootstrap must not cut over any business runtime automatically unless the desired-state manifest explicitly targets a verified release. Initial state may be `enabled: false`.

## Testing
Offline deterministic tests must cover:
- manifest schema validation;
- exact 40-hex revision enforcement;
- SHA-256 mismatch rejection;
- floating-ref rejection;
- arbitrary-shell rejection;
- duplicate release idempotency;
- kill switch behavior;
- transaction state transitions;
- activation failure rollback;
- health failure rollback;
- rollback failure founder hold;
- unrelated timer preservation;
- secret-like evidence redaction.

## Success criteria
Host Autopilot V1 is production-ready when:
- offline tests pass;
- bootstrap installer passes syntax/compile checks;
- service and watchdog timers are active on the VM;
- a no-op fixture release is discovered, verified, and recorded without changing business services;
- a deliberately failing fixture rolls back successfully;
- exact receipts prove both paths;
- subsequent runtime releases can be applied without an active ChatGPT Remote Desktop Commander session.
