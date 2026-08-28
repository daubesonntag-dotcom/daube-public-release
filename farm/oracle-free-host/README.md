# D'AUBE Oracle Always Free Origin

The canonical deployment package lives on the public `oracle-free-host-v1` branch and is validated with Terraform 1.5.7 for OCI Resource Manager.

## Deploy

[![Deploy to Oracle Cloud](https://oci-resourcemanager-plugin.plugins.oci.oraclecloud.com/latest/deploy-to-oracle-cloud.svg)](https://cloud.oracle.com/resourcemanager/stacks/create?zipUrl=https://github.com/daubesonntag-dotcom/daube-public-release/archive/refs/heads/oracle-free-host-v1.zip)

This route requires no OCI API private key in GitHub and no local Terraform installation. OCI Resource Manager supplies its own execution identity and guided OCI inputs.

## Truth and spend gates

- The stack is provider-backed and is never `sovereign-local`.
- No paid fallback is authorized.
- Apply remains blocked until the Always Free capacity/reclamation and remaining volume-headroom acknowledgements are explicitly confirmed.
- Oracle account login plus any identity/payment verification required by Oracle remains an external provider-controlled gate.
- A successful apply is not enough to call the host live; D'AUBE requires a fresh external `/healthz` canary before promotion.

Validated deploy branch revision: `e2cd09399df6315545f40ef85bba741025462e4c`.
Validation workflow run: `33195826341` (`success`).
