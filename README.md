# D-AUBE Nexus Public App

Public install, update and static presentation channel for the D-AUBE Nexus ecosystem.

## Repository authority

This repository publishes intentionally public static artifacts only. It does not own private runtime logic, credentials, production infrastructure or Founder root governance.

- Canonical runtime and release-candidate source: `daubesonntag-dotcom/daube-forge-os`
- Canonical governance and portfolio registry: `daubesonntag-dotcom/daube-os`
- Local repository contract: [`governance/repository-contract.json`](governance/repository-contract.json)
- Release provenance requirements: [`governance/PUBLIC_RELEASE_PROVENANCE.md`](governance/PUBLIC_RELEASE_PROVENANCE.md)

Every production-facing artifact update must retain its source commit, artifact digest, test summary, release approval/passport and rollback reference. A static publish proves distribution only; it does not prove backend deployment or production health.
