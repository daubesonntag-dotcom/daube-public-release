# D’AUBE Work V12 — Experience Stack Matrix

Status: ACTIVE RESEARCH / EVIDENCE-LED

Goal: keep the site cinematic and interactive without repeating the V8–V11 mistake of stacking overlapping animation runtimes. Prefer native browser primitives, build-time optimization, and small progressive enhancements. Only adopt third-party code when license, maintenance, performance, and accessibility are clear.

## Decision rules

- ADOPT: safe to use now.
- REIMPLEMENT: use the idea/pattern, not copied source.
- PILOT: test behind a progressive-enhancement gate before production.
- HOLD: useful later, not justified now.
- REJECT: wrong fit for the current site.

## Stack / combo decisions

| Capability | Candidate | Decision | Why |
|---|---|---:|---|
| Cross-document page transitions | Native View Transitions API | ADOPT | Browser-native, no runtime framework, progressive enhancement, easy reduced-motion fallback. |
| Server-rendered transition lifecycle | swup/swup | HOLD | Mature MIT library with native View Transition support, caching and accessibility. Current site does not yet need another navigation runtime. |
| Same-origin navigation acceleration | Speculation Rules / idle prefetch | ADOPT | Native first. Use the same network-aware idea as Quicklink without adding another dependency. |
| Prefetch reference | GoogleChromeLabs/quicklink | REIMPLEMENT | Apache-2.0, small, respects slow connections and Save-Data. Use as design reference for our native prefetch policy. |
| Smooth scrolling | darkroomengineering/lenis | HOLD | Excellent library, but GitHub discussions show mobile jank/FPS issues when mixed with GSAP/R3F. Native scrolling is currently safer for D’AUBE. |
| Scroll choreography | Native scroll + rAF + CSS transforms | ADOPT | V12 already uses one bounded rAF path. Keep one owner for scroll-driven motion. |
| Heavy animation orchestration | GSAP + ScrollTrigger | HOLD | Powerful, but unnecessary for current interaction scope. Do not add until a scene genuinely needs timeline orchestration. |
| Hero shader/refraction | oframe/ogl | PILOT | Tiny zero-dependency WebGL layer, Unlicense. Better fit than full Three.js for one shader. Desktop only at first, static fallback required. |
| Full 3D scene engine | mrdoob/three.js | REJECT NOW | Too much surface area for the current hero. Known Android/WebGPU performance variance reinforces keeping the production hero lighter. |
| WebGPU hero | native WebGPU / OGPU | HOLD | Interesting future path, but not production default until mobile evidence is strong. |
| Responsive delivery | HTML picture/srcset/sizes | ADOPT | No framework required. Use AVIF + WebP + fallback once a genuine high-resolution master exists. |
| Responsive image component | ascorbic/unpic-img | REIMPLEMENT | MIT and strong responsive-image rules. Current site is static HTML, so reuse the output principles rather than adding a framework component. |
| Build-time image pipeline | lovell/sharp | ADOPT | Apache-2.0; high-performance resize/conversion for AVIF/WebP. Use only from a sufficiently large source; do not pretend low-res upscales are native 4K detail. |
| View-transition QA | css-scroll-driven/view-transition-debugger | DEV QA | Useful for spotting duplicate names, oversized snapshots, jank, and missing reduced-motion behavior. Not shipped to users. |

## GitHub/forum evidence captured

### Lenis / GSAP / mobile

- https://github.com/darkroomengineering/lenis/discussions/431
  - A reported Lenis + GSAP + R3F setup dropped from about 60 FPS idle to about 40 FPS while scrolling on mobile.
  - Maintainers recommended moving off the deprecated package and isolating whether the 3D scene, not Lenis, was the bottleneck.
- https://github.com/darkroomengineering/lenis/discussions/140
  - Community profiling noted duplicate style recalculation when Lenis and GSAP ticker ordering was poor; batching/order improved frame cost.
- https://github.com/darkroomengineering/lenis/discussions/307
  - Image painting, not smooth-scroll code alone, was identified as the dominant cost on an image-heavy page.

Conclusion for D’AUBE: do not add Lenis/GSAP merely for perceived sophistication. Fix asset delivery and keep a single scroll owner first.

### View transitions / navigation

- https://github.com/swup/swup
- https://github.com/swup/docs/blob/main/src/docs/announcements/swup-4.md
- https://github.com/thatbeautifuldream/vanilla-view-transitions

Conclusion for D’AUBE: native cross-document View Transitions are the first-line option. swup remains a fallback if we later need lifecycle hooks, cache management, or complex old/new-page overlap.

### Lightweight WebGL

- https://github.com/oframe/ogl

OGL is a minimal ES-module WebGL library with zero dependencies and a very thin abstraction layer. It is explicitly much smaller in scope than Three.js and is a good candidate for one custom refraction/caustics shader.

Conclusion for D’AUBE: if the hero receives real shader work, pilot OGL on desktop with a static image fallback and device-quality gate. Do not ship a permanent WebGL canvas just because it looks technical.

### Responsive media

- https://github.com/lovell/sharp
- https://github.com/ascorbic/unpic-img

Conclusion for D’AUBE: the next real visual-quality jump is a true large source master + build-time AVIF/WebP variants + correct srcset/sizes. A 1672×941 source should not be represented as genuine 4K detail.

### Navigation prefetch

- https://github.com/GoogleChromeLabs/quicklink

Quicklink’s useful production ideas: only same-origin by default, idle-time work, IntersectionObserver, and avoiding aggressive prefetch on Save-Data/slow connections.

Conclusion for D’AUBE: implement these semantics with native Speculation Rules or a tiny local helper rather than adding a dependency unless browser coverage proves insufficient.

## Production combo selected for V12.x

**Baseline / always:**

- semantic static HTML
- V7 base design system
- V12 Pure Cinema visual layer
- native scroll
- one requestAnimationFrame owner for hero depth
- IntersectionObserver reveal
- prefers-reduced-motion
- responsive CSS / touch-first fallback

**Next low-risk additions:**

1. Native cross-document View Transitions with a simple root crossfade and persistent brand treatment.
2. Same-origin, network-aware prefetch for Maison / Work / Services / Pricing / Contact.
3. High-resolution hero master acquisition or generation.
4. Sharp build pipeline → AVIF + WebP + fallback variants and srcset/sizes.
5. Mobile visual/performance gate before any additional shader work.

**Optional experimental lane:**

- OGL hero refraction / caustics, desktop-only, progressive enhancement.

**Explicitly not in the production combo right now:**

- Lenis + GSAP + R3F stack
- multiple animation libraries owning the same scroll loop
- permanent full-page WebGL
- fake 4K upscaling claims
- ornamental HUD / director labels / floating cinematic chrome

## License notes

- swup: MIT
- unpic-img: MIT
- quicklink: Apache-2.0
- sharp: Apache-2.0
- OGL: Unlicense / public-domain dedication

Before copying any example implementation, verify the exact source file/license and preserve required notices. Prefer reimplementation of generic interaction patterns over copying demo code wholesale.
