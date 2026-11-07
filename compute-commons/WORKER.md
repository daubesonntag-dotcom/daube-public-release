# D’AUBE Compute Commons — Fixed Worker V1

This worker turns an already paired D’AUBE Compute Commons host into a **pull-only public-safe CPU worker**.

It is deliberately narrow. V1 executes only:

- kernel: `rgba-premultiply-u8-v1`
- task mode: `public-rgba8-artifact-v1`
- backend: CPU
- input: server-validated public RGBA8 bytes
- output: deterministic premultiplied RGBA8 bytes + SHA-256/FNV evidence

It cannot execute arbitrary scripts, shell commands, plugins, private repositories, authenticated browser sessions, customer data or production mutations.

## Before running

Complete the normal `volunteer-host.mjs init` + `pair` flow first. Pairing is explicit-consent and stores its private identity/tokens locally under `~/.daube/compute-commons/volunteer.json` by default.

Inspect the redacted local state:

```bash
node compute-commons/volunteer-host.mjs show
```

The worker requires a committed host attestation, a worker capability token and a verified HTTPS Volunteer Edge bridge URL.

## Run one bounded cycle

```bash
node compute-commons/volunteer-worker.mjs once
```

One cycle does:

```text
register short-lived capability session
→ pull one fixed task from the admitted artifact stream
→ heartbeat the lease
→ verify task schema/kernel/mode/input digest
→ execute fixed CPU kernel locally
→ verify expected first/last/FNV/SHA-256
→ submit completion receipt
```

If there is no task, it returns `IDLE`; it never invents work.

## Run continuously

```bash
node compute-commons/volunteer-worker.mjs watch
```

The process prints its state locally and can always be stopped with **Ctrl+C**. It repeatedly renews short-lived session evidence; disappearing/offline workers naturally expire from the server-side live cohort.

For a bounded canary:

```bash
node compute-commons/volunteer-worker.mjs watch --max-jobs 3
```

Optional controls:

```text
--state PATH
--bridge-url https://...
--poll-ms 2500
--block-ms 2000
--max-jobs N
```

## Fail-closed behavior

The worker rejects work locally when any of these change unexpectedly:

- task schema;
- kernel ID/version;
- task mode/input mode;
- public-safe/persist/reusable flags;
- input byte length or SHA-256;
- expected first/last values;
- FNV-1a checksum;
- expected output SHA-256.

A deterministic contract failure is reported as non-retryable rather than silently producing an artifact.

## Trust boundary

A live volunteer worker is **community capacity, not release authority**. It may produce useful deterministic public artifacts and runtime evidence. It does not prove that the machine is trusted for private source, that multiple pseudonymous hosts are physically distinct, that a production SLA exists, or that D’AUBE may merge/deploy based on the volunteer result alone.

D’AUBE Core still owns private builds, secrets, exact-head release admission and production decisions.
