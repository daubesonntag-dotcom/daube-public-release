# D’AUBE Oracle Always Free — Public Deploy Projection

This branch is a generated, non-secret deployment projection of the canonical private D’AUBE Compute Mesh infrastructure.

Canonical source revision: `daubesonntag-dotcom/daube-compute-mesh@10bd1629d4d0ad9456f75448b19b0ae9a788b8ff`.

## Deploy

[![Deploy to Oracle Cloud](https://oci-resourcemanager-plugin.plugins.oci.oraclecloud.com/latest/deploy-to-oracle-cloud.svg)](https://cloud.oracle.com/resourcemanager/stacks/create?zipUrl=https://github.com/daubesonntag-dotcom/daube-public-release/archive/refs/heads/oci-free-host-v1.zip)

The Resource Manager stack is constrained to `VM.Standard.A1.Flex`, at most 2 OCPUs / 12 GiB RAM, and the configured Always Free storage envelope. Paid fallback is not authorized.

The stack accepts only an SSH **public** key. Never enter a private SSH key, API key, bearer token, HMAC secret, password, payment credential, or other confidential value into this public Git branch.

`tls_hostname = "auto"` avoids a DNS/OAuth dependency by deriving a temporary `sslip.io` hostname from the VM public IP and requesting a public Let’s Encrypt certificate. A branded D’AUBE hostname can replace it later.

Start `availability_domain_index` at `0`. If Oracle reports `Out of host capacity`, retry with `1`, then `2` only when those Availability Domains exist. Changing this index only changes placement; it never authorizes a paid shape or paid fallback.

## Autonomous Oracle A1 proof

This projection now includes a no-new-OAuth runtime proof lane. After boot and HTTPS readiness the host:

1. reads Oracle IMDSv2 for its instance OCID, exact shape, canonical region and Availability Domain;
2. derives the callback public IP from its public-CA `daube-<ip>.sslip.io` identity;
3. signs a fresh nonce-bound attestation with an Ed25519 key generated locally on the VM;
4. publishes only its HTTPS base URL to D’AUBE's proof intake;
5. is challenged back over HTTPS;
6. is admitted only when health/capabilities, Ed25519 signature, A1 shape/ARM runtime, freshness and Oracle's official region-tagged `OCI` public CIDR evidence all pass.

The full instance OCID is not stored in the evidence database; the control plane stores its SHA-256 plus a short suffix for audit correlation. The host private Ed25519 key never leaves the VM.

Sanitized truth state:

`https://wilqsqndjgckqxbjptxm.supabase.co/functions/v1/daube-oracle-a1-state`

The state remains `UNPROVEN` until a real A1 callback passes. A Terraform stack, source commit, or deploy button by itself is never promoted to `ORACLE_A1_LIVE`.

`ORACLE_A1_LIVE` proves the bounded persistent Linux/A1 runtime evidence required by D’AUBE. It does **not** automatically authorize generic VPS/compute-capacity resale; commercial resale remains a separate terms/cost/legal gate.
