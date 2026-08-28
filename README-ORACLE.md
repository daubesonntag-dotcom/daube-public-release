# D'AUBE Oracle Always Free Deploy Bundle

This branch is a public, credentialless Terraform package for OCI Resource Manager. It contains no OCI API key, private SSH key, tenancy secret, GitHub token, or paid-spend authorization.

[![Deploy to Oracle Cloud](https://oci-resourcemanager-plugin.plugins.oci.oraclecloud.com/latest/deploy-to-oracle-cloud.svg)](https://cloud.oracle.com/resourcemanager/stacks/create?zipUrl=https://github.com/daubesonntag-dotcom/daube-public-release/archive/refs/heads/oracle-free-host-v1.zip)

## What this removes

- No OCI API private key needs to be stored in GitHub.
- No Terraform runtime needs to be installed locally.
- `tenancy_ocid`, `region`, and compartment selection are handled in OCI Resource Manager.
- The stack uses the OCI provider with Resource Manager's own execution identity.

## What Oracle still requires

Oracle account creation/login and any identity/payment verification required by Oracle cannot be delegated to this repository. After signing in, the deploy button preloads this public Terraform ZIP into Resource Manager.

## Zero-spend gate

Apply is blocked until both acknowledgement variables are explicitly enabled:

- `accept_oracle_always_free_capacity_risk=true`
- `confirm_free_volume_headroom=true`

This does not authorize paid fallback. The VM remains provider-backed (`sovereignLocal=false`).

## Runtime truth

A successful stack apply is still only provisioning evidence. D'AUBE marks the cloud-host lane live only after the external `/healthz` runtime canary succeeds.
