# D’AUBE Work V13 — High-Quality Experience Stack

Status: ACTIVE / EVIDENCE-LED / ZERO-ORNAMENTAL-DEPENDENCY

Purpose: pursue the highest visual quality without repeating the V8–V11 failure mode of stacking animation libraries, fixed HUDs, full-page WebGL, and redundant scroll owners.

## Production doctrine

1. Native browser primitives first.
2. One owner per concern: one scroll loop, one page-transition mechanism, one image pipeline, one visual-regression harness.
3. Third-party libraries are adopted only when they solve a measured gap better than a small local implementation.
4. Mobile and reduced-motion are first-class release targets, not fallbacks added at the end.
5. Image quality comes from a real high-resolution source + responsive delivery, not fake upscale claims.
6. No library is shipped merely because it is popular or looks “cinematic” in a demo.

## Candidate matrix

| Domain | Candidate | Decision | D’AUBE use |
|---|---|---:|---|
| Page transitions | Native View Transitions API | ADOPT | Root crossfade now; named transitions only after inner routes share the same lifecycle. |
| Navigation lifecycle | swup/swup | HOLD | Mature option if native transitions later need cache/lifecycle hooks. Do not add yet. |
| Alternative navigation | barbajs/barba | HOLD/REJECT NOW | Capable, but overlaps with native transitions and adds lifecycle ownership we do not currently need. |
| Smooth scrolling | darkroomengineering/lenis | HOLD | Excellent when genuinely needed; current native scroll is safer and simpler on mobile. |
| UI animation | motiondivision/motion | HOLD | Strong orchestration library; current scope is small enough for WAAPI/CSS. Add only if timelines become materially complex. |
| Scroll animation | CSS Scroll-Driven Animations + rAF fallback | PILOT | Prefer compositor-friendly CSS where support/behavior is verified; keep one JS rAF fallback for hero depth. |
| Lightweight shader | oframe/ogl | PILOT | Best current fit for one desktop-only refraction/caustics effect. Static fallback mandatory. |
| DOM-to-WebGL media | martinlaxenaire/curtainsjs | HOLD | Better fit than OGL for many DOM-backed media planes, but overkill for one hero. |
| Functional WebGL | regl-project/regl | HOLD | Elegant functional WebGL abstraction, but not justified for a single D’AUBE shader. |
| Full 3D engine | mrdoob/three.js | REJECT NOW | Too much surface area and mobile variability for the current homepage. |
| Animation authoring | theatre-js/theatre | HOLD | Great for authored cinematic timelines; not appropriate for the current restrained marketing surface. |
| Image processing | lovell/sharp | ADOPT BUILD-TIME | Generate real width variants + AVIF/WebP/JPEG from a sufficiently large master. |
| Vite image pipeline | JonasKruckenberg/imagetools | HOLD | Excellent if this static release migrates to Vite. Current plain HTML does not need it. |
| Responsive image rules | ascorbic/unpic-img | REIMPLEMENT | Use its principles for srcset/sizes/layout stability without adding a component framework. |
| Dynamic image proxy | imgproxy/imgproxy | HOLD | Strong if D’AUBE later runs an image service. Overkill for GitHub Pages/static deployment today. |
| Browser/WASM codecs | jamsinclair/jSquash | HOLD | Useful for client/browser codec workflows; build-time Sharp remains simpler here. |
| Prefetch | GoogleChromeLabs/quicklink | REIMPLEMENT | We already use same-origin, in-view, connection-aware prefetch semantics without shipping the dependency. |
| E2E browser QA | microsoft/playwright | ADOPT DEV | Desktop/mobile screenshots, interaction checks, reduced-motion and touch-device paths. |
| Accessibility engine | dequelabs/axe-core | ADOPT DEV | Automated accessibility checks; manual keyboard/contrast QA still required. |
| Accessibility CLI | pa11y/pa11y | PILOT DEV | Useful secondary CLI gate; avoid redundant CI if axe + Playwright already cover the surface. |
| Performance budgets | GoogleChrome/lighthouse-ci | ADOPT DEV WITH CAUTION | Good budgets and regressions, but treat CI/browser startup failures as tooling failures, not product failures. |
| Pixel regression | mapbox/pixelmatch | ADOPT DEV | Small deterministic image diff primitive for screenshot baselines. |

## GitHub issue/discussion evidence

### Motion / mobile

- `motiondivision/motion#2507`: scroll-linked translateY jumping was reproduced on iPhone 15 Pro and Android; viewport resizing / vh-based geometry was suspected. This reinforces avoiding viewport-fragile scroll transforms on mobile.
- `motiondivision/motion#1048`: a historical infinite-animation case left a requestAnimationFrame loop running after component removal. D’AUBE therefore treats animation lifecycle cleanup as a release requirement.
- `motiondivision/motion#441`: historical Firefox lag reports are another reason not to introduce a large animation runtime for effects that CSS/WAAPI can already handle.

Decision: Motion is a strong library, but D’AUBE does not need it in production yet.

### Lenis / GSAP / mobile

Existing V12 research already captured Lenis discussions reporting mobile FPS loss in combinations with GSAP/R3F, ticker-order style recalculation, and cases where image painting — not the scroll library — was the real bottleneck.

Decision: optimize media and keep native scroll before adding smooth-scroll infrastructure.

### Sharp / AVIF

- `lovell/sharp#4277`: an AVIF encode path showed a sharp runtime discontinuity around a particular resize width in a reported case.
- `lovell/sharp#2597`: high-resolution AVIF conversion was reported as CPU/RAM intensive compared with WebP.
- `lovell/sharp#4257`: encoding is not always abortable merely by user-land timeout logic.

Decision: generate AVIF at build time only, cap concurrency, keep WebP/JPEG fallbacks, and never encode on a live request path for this static site.

### Lighthouse CI

- `GoogleChrome/lighthouse-ci#766`: a GitHub Actions run could fail with `NO_FCP` even though the same setup worked locally. This is a useful reminder that headless runner failures can be infrastructure/tooling failures.

Decision: Lighthouse is a quality signal, not sole production truth. Pair it with live-browser QA and HTTP checks.

## D’AUBE selected production combo

### Runtime, always-on

- Semantic static HTML
- V7 design-system base
- V12 Pure Cinema visual system
- Native scrolling
- One bounded requestAnimationFrame owner for hero depth on capable devices
- IntersectionObserver for reveals
- Native View Transitions progressive enhancement
- Same-origin, connection-aware prefetch
- `prefers-reduced-motion` and touch/coarse-pointer gates
- No permanent third-party animation runtime

### Media pipeline

When a genuine high-resolution hero master is available:

1. Source master: minimum 2560px wide, ideal 3840×2160 or larger.
2. Sharp build-time variants: 768 / 1200 / 1600 / 1920 / 2560 / 3840 where source detail permits.
3. AVIF + WebP + JPEG/PNG fallback.
4. `<picture>` + `srcset` + `sizes`.
5. Explicit width/height or aspect-ratio to lock layout.
6. Hero remains eager/high-priority; lower media stays lazy.
7. AVIF jobs run with bounded concurrency because encoding can be materially expensive.

### Optional cinematic lane

OGL desktop-only shader pilot:

- one canvas only;
- one hero only;
- no full-page canvas;
- off on reduced-motion, coarse pointer, low-power/device-memory gate;
- pause when hero is offscreen or tab is hidden;
- context-loss/static-image fallback;
- release only if visual QA clearly beats the static version without damaging mobile performance.

### QA combo

- Playwright: desktop + mobile + reduced-motion + touch flows
- axe-core: accessibility automation
- Pixelmatch: visual-regression diff
- Lighthouse CI: performance/accessibility/SEO budget signal
- live HTTP check: production truth for availability
- browser screenshot review remains required for visual sign-off

## Explicit rejects for the current homepage

- Lenis + GSAP + R3F bundle
- Barba/Swup plus Native View Transitions at the same time
- Motion plus another global scroll runtime
- Three.js for a single decorative hero effect
- full-page WebGL
- autoplay heavy video on first viewport
- runtime AVIF conversion
- low-resolution source presented as “native 4K”
- fixed cinematic HUDs, scene counters, fake director chrome

## Next execution order

P0 — ship now:
- lifecycle/performance guards for the existing V12 runtime;
- touch/reduced-transparency/high-contrast refinements;
- content-visibility/containment for below-fold sections where safe;
- keep the current design visually restrained.

P1 — when a true high-res master is obtained:
- Sharp responsive media pipeline;
- picture/srcset conversion;
- browser/mobile visual regression baseline.

P2 — experimental only after P1 is green:
- OGL refraction/caustics prototype behind device-quality gates;
- compare against static hero with screenshots and performance traces;
- ship only if it is visibly superior and remains smooth.
