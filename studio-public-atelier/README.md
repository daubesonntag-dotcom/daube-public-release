# D’AUBE Studio — Public Atelier

Public-safe distribution surface for the D’AUBE Studio Living Atelier.

## Restoration candidate, not a release

This branch repairs the existing `studio-public-atelier` module. It is not deployed or approved for publication. The last recorded AppDeploy application, `d-aube-studio-public-atelier-7s9b5a`, reported `deleted` on 2026-11-09. The Studio hostname still redirected to that unavailable application when checked. No replacement host is selected by this change.

`release-channel.json` and `release-passport.v1.json` are preserved historical v1.1.0 records. Their deployment claims and executable digest do **not** describe this candidate. Do not deploy this directory wholesale or promote its stable pointer without fresh verification. The separate [candidate record](./restoration-candidate.v1.json) identifies the changed executable payload and explicitly blocks release.

## Repairs

- Reviewing prototype QC creates no evidence. All eight gates remain NOT VERIFIED, the score stays 0/8, and Ship remains locked, including after edits and undo/redo.
- The update notification no longer calls an unverified update verified.
- A fresh service-worker cache identity prevents the previous cached JavaScript from being reused after a successful upgrade.
- Offline caching is limited to the exact public entry and five static assets. Private/API paths, arbitrary resources, query variants, foreign origins, non-GET requests and release metadata are not intercepted.
- Entry navigation is network-first with a bounded offline fallback. Cache failures do not replace successful network responses. Install pre-caching remains atomic.

The QC truth boundary follows the existing Studio Runtime [PR27](https://github.com/daubesonntag-dotcom/daube-studio-runtime/pull/27). This public-shell repair does not duplicate that private/runtime implementation or merge its draft PR.

## Verification

From this directory:

```sh
node --test tests/*.test.mjs
node --check app.js
node --check bootstrap.js
node --check sw.js
```

The tests execute actual application/bootstrap/service-worker code in isolated Node VM contexts with minimal DOM and CacheStorage adapters. They verify state, rendered output and fetch/cache decisions, not rendered browser layout, accessibility, installation or offline behavior in a real browser. The original code reproduces a false 6/8 score for empty, catalog-approved and arbitrary scenes after a real QC handler invocation.

## Public/private boundary

The public shell is self-contained and browser-local. It retains project state only in browser storage. AI controls are route simulations only; no AI execution, credentials, production mutation, private runtime topology or release authority is exposed. No dependencies, service, database, domain or provider resource is added by this patch.

## Required publication sequence

1. Reconcile the exact reviewed source with the canonical Studio/Forge owner and record a new handoff for this payload. The old Forge handoff remains historical, not approval for these bytes.
2. Verify a supported existing hosting destination. Do not restore an empty/deleted provider snapshot or invent a replacement target.
3. Align the actual release version, cache identity and UI label. Regenerate stable-channel metadata, payload digest, release passport and rollback evidence from the approved source. Describe release metadata as network-only; an offline copy does not prove current release state.
4. Exercise the real browser at desktop and mobile sizes, including QC, add/edit/undo/redo, AI simulation boundary, storage failure, update activation and offline fallback. Record what was actually tested.
5. Verify deployed HTML, JavaScript and assets by fresh readback before changing the Studio redirect. Preserve unrelated routes and access controls.

Source rollback reference: public-release commit `c0bf0131c78caaa70f2ef730ea12d55f8d05047d`. This source rollback would reintroduce the known false-QC behavior and is not an approved live recovery. Historical AppDeploy version metadata is not proof that a provider restore is available.
