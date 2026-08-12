# D’AUBE UX/UI Autopilot

## Purpose

Make GitHub a continuous quality operator rather than a passive code store.

The operating loop is:

1. detect a meaningful change,
2. audit the affected public surface,
3. fail fast on accessibility, email-safety or budget regressions,
4. fix on a branch,
5. collect CI evidence,
6. review the visible UX/UI result,
7. merge only when repository governance permits it,
8. retain rollback evidence.

## What is automated now

The `UX & UI Quality Gate` is dependency-free and deliberately lightweight. It scans public HTML, CSS and image assets for:

- HTML5 document structure,
- document language and viewport contracts,
- one primary H1 on public pages,
- missing image alt text,
- unsafe/local URL protocols,
- outgoing-email JavaScript and local assets,
- primary email CTA limits,
- motion without reduced-motion support,
- HTML/CSS/image size budgets,
- unsafe `target=_blank` links.

It writes a machine-readable JSON evidence report and a GitHub Actions summary.

## Cost discipline

Heavy browser/Lighthouse runs are not scheduled continuously. The fast gate runs when relevant files change. Browser-heavy evidence should run on demand or at a targeted release boundary, because automation that burns compute without new information is not an optimization.

## UX/UI direction

`experience-preview/` demonstrates the preferred public interaction model:

- user value before infrastructure terminology,
- strong editorial hierarchy,
- fewer and clearer actions,
- mobile-first responsive layout,
- visible focus/skip navigation,
- reduced-motion compatibility,
- technical provenance kept as evidence rather than front-page copy.

## Autonomy boundary

GitHub can inspect, build, repair, audit, test, create branches/PRs and prepare upgrades within repository permissions. It must not invent secrets, bypass protected governance, spend money, or claim external production state without evidence.

The goal is broad autonomy with narrow irreversible authority.
