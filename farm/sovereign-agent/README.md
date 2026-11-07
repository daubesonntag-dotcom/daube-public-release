# D'AUBE Direct Sovereign Agent V1

This agent turns directly controlled Linux hardware into the `sovereign-local` evidence lane without requiring a GitHub self-hosted runner, PAT, runner registration token, cloud credential, or inbound network port.

## Trust model

- The host generates an Ed25519 private key locally. The private key never needs to leave the host.
- The agent submits only signed capability evidence over outbound HTTPS.
- D'AUBE production accepts proof only when the public-key fingerprint has an active founder-control binding.
- Third-party cloud signals fail closed. OCI/AWS/GCP/Azure metadata and common DMI/vendor signatures are checked before submission.
- Proof is bounded to CPU, storage and outbound-network canaries. There is no arbitrary remote shell or generic command-execution channel.
- `paidSpendAuthorized=false` and `privateAssetsUsed=false` are part of the signed proof contract.

## Supported production path

Use a directly controlled Linux machine with Python 3, OpenSSL and systemd. x64 and ARM Linux are both suitable for the agent itself.

Download `install.sh`, inspect it, then run it as root. The installer fetches the agent from an immutable Git commit, compiles it before installation, creates an unprivileged `daube-sovereign` system account and installs a 30-minute systemd proof timer.

The first proof normally returns `PAIRING_REQUIRED` and prints a `publicKeySha256` fingerprint. Approve only that fingerprint after physically/logically confirming the exact machine is directly controlled by D'AUBE/founder. Once the binding is active, the next proof is admitted automatically and Resource Farm can promote `sovereign-local` without another code deployment.

## Android / Termux CI fallback

`install-termux.sh` installs the sovereign proof agent only. CI execution is a separate least-authority layer.

Run `install-sovereign-ci-toolchain-termux.sh` on an already founder-controlled Termux host. The CI bootstrap installs Git, Node.js 22+, npm, Python, `zstd`, tar, curl and Termux `rage` (the age-v1-compatible implementation used for source transport). It generates a separate X25519 transport identity locally, keeps that identity mode `0600`, and signs the public age recipient plus its SHA-256 fingerprint into the existing Ed25519 host proof. The signing key and source-decryption key remain separate key purposes.

The local machine-readable receipt is written at:

`~/.local/share/daube-sovereign-host/ci/toolchain-receipt.json`

The bootstrap also installs `sovereign-ci-worker.py`. This is not a remote shell and does not run `npm test` or arbitrary package scripts. It accepts only the fixed `sovereign-node-package-smoke-v1` profile, only immutable D'AUBE target revisions explicitly admitted by the broker, and executes only canonical `node --test tests/...test.mjs` argv. The worker validates the encrypted capsule digest, archive paths, source manifest digest and target revision before execution; it keeps runtime HOME/TMP outside the source tree, emits only stdout/stderr digests, verifies source immutability after the tests, and scrubs the ephemeral workspace before signed completion.

When Termux JobScheduler is available, signed CI readiness is refreshed every 30 minutes and the bounded CI worker polls every 15 minutes. A worker poll is attempted immediately only after the fresh signed toolchain proof is accepted. If the broker, toolchain proof or transport recipient is not admitted, execution remains fail-closed.

The receipt deliberately proves **toolchain and transport readiness only**. It does not certify a private-source handoff or a Quick Green run. GitHub/cloud bearer credentials are not required on the host, inbound ports are not required, paid spend remains unauthorized, and CI execution cannot authorize merge or production publication.

The canonical source-handoff/execution contracts remain owned by `daube-ci-platform`; this public installer is only the founder-controlled Android execution substrate.

## Non-systemd Linux

The Python agent can be run manually or by another local scheduler. This is useful for lab environments, containers or experimental Linux-on-ARM setups, but production admission still depends on direct-control verification, anti-cloud checks and fresh repeated evidence.

## Truth boundary

Publishing or installing this agent does not itself prove a sovereign host exists. Until an actual directly controlled machine generates a fresh signed proof and its fingerprint is approved, Resource Farm must remain fail-closed. Likewise, publishing the CI toolchain and worker is `IMPLEMENTED`, not `RUNTIME_VERIFIED`; sovereign CI fallback becomes verified only after a fresh Android/Termux proof reports `ciToolchain.ready=true` with the bound age/X25519 recipient and a signed exact-source CI execution receipt exists for the immutable target revision.
