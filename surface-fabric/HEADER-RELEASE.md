# D’AUBE Surface Fabric — Cloudflare Pages Header Admission

Status: **SOURCE READY / DEPLOYMENT HOLD** (2026-10-27). This is the shared *placeholder* Pages project `daube-surface-fabric-git`, NOT the production maison website and NOT Client/Partner Portal.
Existing provider facts: Cloudflare Pages project source `GitLab yninguyen006/daube-forge-os` branch `main`; currently `build_command` downloads only `surface-fabric/index.html` from public GitHub `daubesonntag-dotcom/daube-public-release/main` and writes `dist/index.html`. `destination_dir` is `dist`. This project serves app/docs/api/assets/edge/lab/preview/status/cloud/compute domain aliases, not one isolated domain.

## Why 3 response headers remain missing on app.daubesonntag.com

The current Pages build never downloads a `_headers` file, so Pages does not apply CSP/HSTS/X-Frame-Options to static responses. A narrowly scoped Cloudflare zone Transform Rule added 2026-10-27 successfully hardened `daubesonntag.com` Worker response but **did not affect** `app.daubesonntag.com` Pages static output (real HTTPS readback). Do not call that app route fixed based on zone config.

## Admission after GitLab/Pages source authority verified

Release owner first verifies exact GitHub commit digest and approved `_headers` source, then builds a distinct *preview deployment* on the original Pages project containing **both** `dist/index.html` and `dist/_headers`. Standard Pages `_headers` syntax is documented at https://developers.cloudflare.com/pages/configuration/headers/ .

Candidate future `build_command` after approval (illustrative; not yet applied):

```sh
mkdir -p dist &&
curl -fsSL https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/<APPROVED_COMMIT_SHA>/surface-fabric/index.html -o dist/index.html &&
curl -fsSL https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/<APPROVED_COMMIT_SHA>/surface-fabric/_headers -o dist/_headers
```

Where `<APPROVED_COMMIT_SHA>` must be an immutable full SHA, supplied only after source-head and independent release approval. Existing GitLab build trigger and Cloudflare Pages configuration must be reconciled; modifying `_headers` in GitHub alone does not publish anything, and source HEAD cannot be substituted for GitLab production acceptance.

The candidate deliberately keeps `'unsafe-inline'` **only** for the pre-existing static placeholder which contains inline CSS and inline JS. It should not be promoted to any future production customer application: replace with nonce/hashes and separately review scripts/styles. HSTS is short `max-age=300`, no includeSubDomains. Noindex prevents placeholder becoming SEO authority. This is *not* a replacement for Tenant/Staff auth.

## Readback and rollback

After independent CI and preview pass, verify all alias hosts HTTPS HTTP 200, explicit CSP/HSTS/XFO and noindex, plus actual script rendering, accessibility tree and app functional parity. Run static contract `node --test tests/surface-fabric-headers.test.mjs`. Record deployment ID, file digests and reverse routing impact on all custom aliases. Production promotion needs original Pages release owner approval and rollback to previous provider-proven deployment (observed 2026-10-27: `3510e15e-b736-4d04-931b-ab7553b2ffe7`, recheck before use). Do not change GitLab build command, DNS, Pages production or shared aliases based solely on source PR success.
