# Public Release Provenance

## Repository role

`daubesonntag-dotcom/daube-site` is the public install, update and static presentation channel for D’AUBE.

It does not own private runtime logic, Founder root governance, credentials, private data or production infrastructure. Its source runtime is `daubesonntag-dotcom/daube-forge-os`; portfolio governance is maintained in `daubesonntag-dotcom/daube-os`.

## Accepted release package

Every production-facing artifact update must identify:

- exact `sourceCommit` from the canonical runtime,
- `artifactDigest` for the files being published,
- `testSummary` describing what was actually verified,
- `releasePassport` or equivalent approval record,
- `rollbackReference`,
- release owner and timestamp,
- claims that remain unproven.

The handoff record may be stored in a versioned manifest, PR body or retained workflow artifact, but it must be durable and inspectable.

## Public-data boundary

Allowed:

- static HTML, CSS, JavaScript and media intentionally approved for public access,
- PWA manifests and public service-worker assets,
- public release metadata,
- privacy-safe diagnostics,
- customer-facing documentation.

Prohibited:

- API keys, tokens, credentials or private certificates,
- internal environment files,
- private audit logs or incident details,
- private customer, worker or Founder data,
- internal prompts, datasets or proprietary model artifacts not approved for publication,
- root governance material that belongs in the private control plane,
- backend claims or health status that are not verified by runtime evidence.

## Change tiers

- **T0:** public documentation and harmless metadata.
- **T1:** reversible static implementation with local verification.
- **T2:** public release, install/update behavior, service-worker changes or cross-repository artifact publication; requires provenance, approval and rollback.
- **T3:** not permitted directly in this repository. Root, legal, credential, private-data or irreversible changes must be handled in the appropriate private canonical repository.

## Integrity checks

Public release review should verify:

1. repository contract remains valid,
2. no prohibited files or obvious secret patterns are introduced,
3. source commit and artifact digest are recorded,
4. service-worker and cache changes have a rollback strategy,
5. privacy and accessibility claims match the actual artifact,
6. public output does not expose internal topology or credentials,
7. release claims are limited to what the evidence proves.

## Exceptions

An exception must be necessary, lawful, ethical, minimal, approved, monitored, time-bounded and recoverable. It may not authorize secret exposure, private-data publication, unverified artifacts or transfer of release/root authority.

An exception never establishes precedent.
