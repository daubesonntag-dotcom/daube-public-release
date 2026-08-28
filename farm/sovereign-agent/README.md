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

## Non-systemd Linux

The Python agent can be run manually or by another local scheduler. This is useful for lab environments, containers or experimental Linux-on-ARM setups, but production admission still depends on direct-control verification, anti-cloud checks and fresh repeated evidence.

## Truth boundary

Publishing or installing this agent does not itself prove a sovereign host exists. Until an actual directly controlled machine generates a fresh signed proof and its fingerprint is approved, Resource Farm must remain `11/12` and `sovereign-local=UNPROVEN`.
