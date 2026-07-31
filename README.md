# D’AUBE SONNTAG Public Release Channel

Public install, update and static presentation boundary for the D’AUBE ecosystem.

## Repository authority

This repository publishes intentionally public static artifacts only. It does **not** own private runtime logic, credentials, production infrastructure, Founder root governance, or the canonical customer website.

- Canonical customer presence: `https://daubesonntag.com/`
- Canonical runtime and release-candidate source: `daubesonntag-dotcom/daube-forge-os`
- Canonical governance and portfolio registry: `daubesonntag-dotcom/daube-os`
- Local repository contract: [`governance/repository-contract.json`](governance/repository-contract.json)
- Release provenance requirements: [`governance/PUBLIC_RELEASE_PROVENANCE.md`](governance/PUBLIC_RELEASE_PROVENANCE.md)

The static root is intentionally `noindex` and points human visitors back to the canonical maison. Founder/staff workspaces, synthetic operating dashboards, private metrics and privileged controls must not be published from this repository.

Every production-facing artifact update must retain its source commit, artifact digest, test summary, release approval/passport and rollback reference. A static publish proves distribution only; it does not prove backend deployment, production health, customer acceptance or broad legal compliance.
