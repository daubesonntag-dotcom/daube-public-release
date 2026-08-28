# D’AUBE Oracle Always Free — Public Deploy Projection

This branch is a generated, non-secret deployment projection of the canonical private D’AUBE Compute Mesh infrastructure.

Canonical source revision: `daubesonntag-dotcom/daube-compute-mesh@8c917c95d69fae0a6bd897010e85214daa693281`.

## Deploy

[![Deploy to Oracle Cloud](https://oci-resourcemanager-plugin.plugins.oci.oraclecloud.com/latest/deploy-to-oracle-cloud.svg)](https://cloud.oracle.com/resourcemanager/stacks/create?zipUrl=https://github.com/daubesonntag-dotcom/daube-public-release/archive/refs/heads/oci-free-host-v1.zip)

The Resource Manager stack is constrained to `VM.Standard.A1.Flex`, at most 2 OCPUs / 12 GiB RAM, and the configured Always Free storage envelope. Paid fallback is not authorized.

The stack accepts only an SSH **public** key. Never enter a private SSH key, API key, bearer token, HMAC secret, password, payment credential, or other confidential value into this public Git branch.

`tls_hostname = "auto"` avoids a DNS/OAuth dependency for bootstrap admission by deriving a temporary `sslip.io` hostname from the VM public IP and requesting a public Let’s Encrypt certificate. A branded D’AUBE hostname can replace it later.

This projection does not itself prove an OCI tenancy is eligible, capacity exists, or the VM is live. Runtime truth still requires a successful Resource Manager apply and fresh health/signed worker evidence.
