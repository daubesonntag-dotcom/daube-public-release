# D’AUBE Compute Commons — Volunteer Host Client V1

This directory is the public, host-side onboarding boundary for **D’AUBE Compute Commons**.

It is intentionally narrow:

- PUBLIC_SAFE workloads only;
- zero paid spend by default;
- pull-only participation;
- no arbitrary remote shell/code;
- no private/unreleased D’AUBE assets;
- host-visible stop/revoke;
- local secrets stay local.

A GitHub comment, pairing token, self-reported GPU receipt, or live heartbeat is **not** production capacity by itself. Native GPU capacity is counted only after measured runtime evidence and the required canary/QC/quorum gates.

## Requirements

- Node.js 20 or newer for `volunteer-host.mjs`.
- For native NVIDIA GPU measurement/canary, use the separately published/approved canonical GPU worker and measured probe path. Do not hand-author a probe and call it measured evidence.

## 1. Create a local identity

```bash
node volunteer-host.mjs init \
  --mode local-gpu \
  --device-class "NVIDIA 8-12 GB" \
  --availability "evenings" \
  --origin "D’AUBE public GitHub"
```

This creates a local state file at:

```text
~/.daube/compute-commons/volunteer.json
```

The file contains your private Ed25519 key, host continuity secret, and later short-lived capability tokens. The client attempts to store it with mode `0600` on Unix-like systems. **Do not post or send this file.**

The command prints a public block. Post only that block to the canonical opt-in issue:

- `https://github.com/daubesonntag-dotcom/daube-public-release/issues/96`

Example shape:

```text
INTERESTED
mode: local-gpu
device_class: NVIDIA 8-12 GB
availability: evenings
origin: D’AUBE public GitHub
host_pubkey_ed25519: <PUBLIC_KEY_ONLY>
```

Never put an API key, token, password, private key, seed phrase, IP address, serial number, private URL, email address, or personal ID in the public comment.

## 2. Pair, attest consent, and upgrade

After the D’AUBE Volunteer Edge bridge has a published, verified HTTPS endpoint, use the numeric GitHub comment ID from your opt-in comment:

```bash
node volunteer-host.mjs pair \
  --comment-id <COMMENT_ID> \
  --bridge-url https://<VERIFIED_DAUBE_BRIDGE>/api/workforce/volunteer-edge-bridge \
  --accept-commons-public-safe \
  --self-attest-one-host
```

The client performs:

```text
public GitHub comment
→ signed Ed25519 challenge
→ restricted public-pending token
→ continuity-bound host attestation
→ explicit worker upgrade
```

The client **never asks for the D’AUBE root pairing secret**.

`--self-attest-one-host` means you attest that this pseudonymous host identity corresponds to one host you control. It does **not** claim cryptographic proof that multiple pseudonymous identities are physically distinct machines.

## 3. Inspect local state safely

```bash
node volunteer-host.mjs show
```

`show` is redacted: it never prints the private key, continuity secret, or capability-token values.

To reprint the safe public block:

```bash
node volunteer-host.mjs interest
```

## 4. Withdraw future participation

```bash
node volunteer-host.mjs revoke \
  --bridge-url https://<VERIFIED_DAUBE_BRIDGE>/api/workforce/volunteer-edge-bridge
```

A successful revoke removes locally stored pending/worker/GPU capability tokens from the state file. The local identity file remains so the host can retain its own provenance unless the host chooses to delete it.

## 5. Optional local-GPU capability registration

If pairing returned a separately scoped Creative Commons GPU token, a host can register **self-reported** capability. Registration is not measurement.

```bash
node volunteer-host.mjs gpu-register \
  --gpu-bridge-url https://<VERIFIED_DAUBE_GPU_BRIDGE>/api/workforce/creative-commons-gpu-bridge \
  --vendor NVIDIA \
  --name "<GPU NAME>" \
  --vram-gib 12 \
  --runtime-revision <64_HEX_RUNTIME_REVISION> \
  --workloads creative-runtime-probe \
  --workflow-digests <64_HEX_ALLOWED_WORKFLOW_DIGEST> \
  --model-profiles probe-v1 \
  --accept-gpu-self-report
```

The server state remains:

```text
PAIRED_CAPABILITY_REGISTERED_NOT_MEASURED
```

until an admitted measured probe succeeds.

## 6. Submit a measured GPU probe

The V1 public client intentionally does **not** let a volunteer type arbitrary timing/checksum numbers and call them a measurement. Provide a probe JSON emitted by the approved local GPU probe implementation:

```bash
node volunteer-host.mjs gpu-probe \
  --gpu-bridge-url https://<VERIFIED_DAUBE_GPU_BRIDGE>/api/workforce/creative-commons-gpu-bridge \
  --probe-file measured-probe.json
```

A server-accepted measured probe may advance the host only to:

```text
PAIRED_RUNTIME_PROBED_NOT_PRODUCTION
```

It still does not prove model inference, canary success, sustained capacity, privacy suitability, or production eligibility.

## What happens after measurement

The canonical runtime may then perform bounded, PUBLIC_SAFE steps:

```text
measured host
→ fixed canary lease
→ host-local execution
→ short-lived artifact transfer
→ integrity verification
→ QC / provenance
→ evidence-supported promotion or hold
```

No arbitrary remote shell is introduced by this client.

## Testing

A contract harness is included:

```bash
node --test volunteer-host.test.mjs
node --check volunteer-host.mjs
```

The current ChatGPT execution container could not fetch `raw.githubusercontent.com` because outbound DNS was blocked, so repository publication alone must not be described as local runtime test evidence. The test harness is provided for the first network-capable host and future release validation.

## Security notes

- Use only a **verified HTTPS bridge URL** published by D’AUBE. The client rejects non-HTTPS bridge URLs.
- The client refuses HTTP redirects so bearer capabilities are not silently forwarded to another origin.
- Capability tokens and continuity secrets are local bearer/ownership material; do not paste them into GitHub, Discord, Telegram, logs, screenshots, or support messages.
- Public volunteer nodes are untrusted for confidentiality. D’AUBE must not send private, unreleased, secret-bearing, personal-data, or commercial-production workloads into the V1 public Commons lane.

## Truth boundary

This public client enables consented onboarding. It does not itself prove:

- a GPU is online;
- physical machines are cryptographically distinct;
- a host is production-ready;
- model licensing is commercially cleared;
- any SLA exists;
- any host payment or stored-value entitlement exists.

Those claims require separate runtime, legal, QC, and settlement evidence.