# D’AUBE Work V15 — Navigation Fidelity / Release Quality Sweep

Status: ACTIVE RESEARCH + PARTIAL PRODUCTION ACTIVATION

Purpose: raise perceived quality through continuity, stronger release gates and faster first interaction without reintroducing a global animation framework or a second scroll owner.

## New GitHub sweep

| Domain | Candidate | Decision | D’AUBE use |
|---|---|---:|---|
| Cross-document continuity | Native View Transitions API | ADOPT | Shared brand + hero media continuity between same-origin pages. Root crossfade remains restrained and reduced-motion aware. |
| View Transitions incubation | WICG/view-transitions | LEARN | Archived incubation repo remains useful design/history evidence; no dependency is shipped. |
| MPA transition demos | robole/cross-document-view-transitions | LEARN | Reference patterns only. D’AUBE keeps semantic multi-page navigation and lets unsupported browsers navigate normally. |
| Prefetch/prerender | Speculation Rules API | HOLD/PILOT | Promising native path, but current connection-aware IntersectionObserver prefetch is more bounded. Revisit after browser/device QA. |
| HTML validation | html-validate/html-validate | ADOPT DEV | Static semantic validation for duplicate IDs, invalid attributes, landmark/heading mistakes and malformed markup. |
| CSS validation/lint | stylelint/stylelint | ADOPT DEV | Gate accidental invalid CSS and regression-prone patterns before release. |
| Link integrity | lycheeverse/lychee | ADOPT DEV | Validate internal/public links without shipping browser runtime code. |
| Deep web performance | sitespeedio/sitespeed.io | PILOT DEV | Use for periodic deep profiling when Lighthouse/browser QA disagree; too heavy for every fast PR. |
| HTML minification | terser/html-minifier-terser | PILOT BUILD | Safe build-time reduction after verifying it preserves structured data, accessibility attributes and inline scripts. |
| Critical CSS | addyosmani/critical | HOLD | Useful for larger bundles; current V7/V12/V13 split is still small enough that extra critical-CSS ownership may not pay back. |
| Critical CSS alternative | GoogleChromeLabs/critters | REJECT NEW ADOPTION | Repository is archived; keep as historical reference, not a new dependency. |
| CSS transform/minify | parcel-bundler/lightningcss | ADOPT BUILD | Remains preferred CSS optimizer when the static site has a formal build step. |
| Field metrics | GoogleChrome/web-vitals | ADOPT DEV / OPTIONAL FIELD | Use LCP/CLS/INP in QA or privacy-governed telemetry only; no analytics transport is added merely to collect metrics. |
| Third-party isolation | QwikDev/partytown | HOLD | No need until heavy third-party scripts exist. |

## GitHub discussion evidence

- `WICG/view-transitions#2` documents the design work needed for MPA transitions. D’AUBE therefore treats cross-document transitions as progressive enhancement and keeps normal navigation authoritative.
- `WICG/view-transitions#200` discusses COOP/redirect behavior. Same-origin navigation is the release boundary for D’AUBE shared transitions.
- Existing V13/V14 evidence still applies: mobile viewport changes can destabilize scroll-linked transforms; OGL requires explicit context-loss fallback; high-resolution AVIF encoding belongs in build-time lanes, not live requests.

## V15 production activation

Homepage activation includes:

1. `work-v15-navigation.css` as the single owner for native cross-document visual continuity.
2. Shared transition names for the D’AUBE brand and hero media only.
3. Restrained root fade with no JS router and no navigation interception.
4. Reduced-motion removes transition animation entirely.
5. Very short desktop/landscape viewports receive a minimum hero canvas so body copy scrolls instead of being clipped.
6. Hero is explicitly eager/high-priority.
7. Existing same-origin prefetch is scheduled during idle time where supported rather than competing immediately with first render.

## Selected V15 combo

### Production runtime

- semantic MPA HTML;
- V7 design base;
- V12 Pure Cinema art/motion;
- V13/V14 quality gates;
- V15 Native View Transition continuity;
- native scroll;
- one bounded hero rAF only on capable devices;
- IntersectionObserver lifecycle;
- idle, connection-aware prefetch;
- no GSAP/Lenis/Motion/Three.js router bundle.

### Build/release lane

- Lightning CSS;
- HTML Validate;
- Stylelint;
- Lychee;
- Playwright + axe-core + Pixelmatch;
- Lighthouse CI as signal;
- sitespeed.io only for deeper investigations;
- Sharp responsive-media pipeline once a real high-resolution master exists.

## Explicit release rules

- No second router or scroll owner.
- No named View Transition on content that is not unique per page.
- Cross-document effects must degrade to normal navigation with zero content loss.
- Reduced-motion users get no animated page transition.
- Do not call the current 1672×941 hero 4K.
- Do not add critical-CSS machinery until measurements prove CSS delivery is the bottleneck.
- Do not add Partytown until third-party scripts actually exist.

## Next visual milestone

The largest remaining image-quality gain is still a genuine >=2560px master (ideal 3840×2160+), then responsive AVIF/WebP delivery. After that, the one permitted shader experiment remains an OGL hero-only optical refraction pilot with static fallback and explicit context-loss handling.
