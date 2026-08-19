# D’AUBE Public Release Agent Contract

## Repository role

This repository is the public install, update and static presentation channel.

It receives verified public artifacts from `daubesonntag-dotcom/daube-forge-os` and follows portfolio governance from `daubesonntag-dotcom/daube-os`.

## Allowed work

Agents may:

- maintain approved public HTML, CSS, JavaScript, media and PWA assets,
- improve accessibility, performance and public documentation,
- publish a verified artifact handoff after required approval,
- maintain public release history and rollback references,
- run privacy-safe static checks.

## Prohibited work

Agents may not:

- add credentials, private keys, environment secrets or private certificates,
- publish private Founder, customer, worker or operational data,
- create private business logic or production backend authority here,
- redefine Founder root governance,
- invent artifacts independently of the canonical runtime,
- claim backend deployment, production health, customer acceptance or legal compliance from a static publish alone,
- self-approve a production-facing public release.

## Inherited Free-First production policy

For material public web/UI/media/motion/VFX/CGI/3D/asset work, inherit the canonical Founder-directed policy from:

- repository: `daubesonntag-dotcom/daube-forge-os`
- policy: `config/governance/free-first-operating-policy-v1.json`
- canonical policy merge: `dc85d60e9222e70a270048321b5252e072a72d9d`
- asset authority: `config/assets/asset-universe-v1.json`
- source authority: `config/game-studio/asset-source-registry-v1.json`

Public-site execution rules:

- `DISCOVER → BENCHMARK → REUSE → COMPOSE → BUILD → TEST → HANDOFF/DEPLOY → VERIFY`.
- Search/reuse approved local Treasury assets and canonical Forge assets before adding new dependencies or media.
- **REAL ASSET BEFORE FAKE CSS ART.** CSS may treat/layout/composite media but must not become a lazy replacement for qualified photography, video, CGI, 3D, illustration or other primary artwork.
- Prefer native browser capability or an already-vendored/approved library when it meets the requirement; do not add a large framework or motion engine for a small effect.
- External free/open media must remain traceable to canonical provenance/license evidence. Unknown commercial rights fail closed.
- Do not introduce a parallel asset registry in this public channel. Public manifests are release/handoff evidence, not a new source authority.
- Honor responsive behavior, accessibility and `prefers-reduced-motion`; lazy-load non-critical media.
- A successful static build or GitHub Pages publish is not visual acceptance. Public visual completion requires browser evidence and the release evidence below.

## APPROVED HOMEPAGE MOCKUP V2 — visual lock

For homepage work, `.daube/visual-locks/homepage-approved-mockup-v2.json` is mandatory and overrides loose visual reinterpretation of older homepage compositions.

Founder-approved reference fingerprint:

`sha256:079c497356b44ce29cf3b43a81a8902b1847266c4c24c8bc550b80825ea1c2f8`

Hard homepage rules:

- Preserve the exact 10-chapter order, labels, headlines and CTAs in the visual-lock manifest.
- Treat the approved mockup as a blueprint, not a moodboard.
- Do not regress to generic SaaS, stock-portfolio grids, dashboard cards, or arbitrary content inventions.
- Do not substitute Poly Haven/Pexels/other stock plates for an approved chapter merely because they are convenient.
- Primary chapter art must be a traceable local visual asset; CSS handles layout/treatment/motion, not primary artwork.
- Responsive adaptation may change stacking/crop but must preserve chapter identity, material language and hierarchy.
- Motion may add depth and continuity but must not change the approved composition or obscure content.
- Final visual completion requires desktop/mobile browser evidence and Founder review; green CI alone is insufficient.

## Required release evidence

Every T2 public artifact handoff must record:

- source commit from the canonical runtime,
- artifact digest,
- test summary,
- release passport or equivalent approval,
- rollback reference,
- accountable release owner,
- limitations and claims not proven.

## Adaptive governance

T0 and T1 work may proceed within delegated scope. T2 public releases require provenance and approval. T3 changes are not permitted directly in this public repository.

Exceptions must be lawful, ethical, necessary, minimal, approved, audited, expiring and recoverable. They never establish precedent and cannot authorize secret exposure, private-data publication or transfer of release/root authority.
