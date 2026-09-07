# D’AUBE Work V14 — Cinematic Fidelity / Production Quality Stack

Status: ACTIVE RESEARCH / CURATED / PROGRESSIVE ENHANCEMENT ONLY

Purpose: keep pushing visual quality and motion craft while preserving the V12/V13 doctrine: one owner per concern, no ornamental dependency pile-up, no fake 4K claims, and mobile/reduced-motion quality equal to desktop rather than an afterthought.

## What was added to the research sweep

The V14 sweep extends the earlier V12/V13 matrix with creative-coding references, build-time CSS/font/media tooling, visual-regression systems, and field-performance instrumentation.

| Domain | Candidate | Decision | D’AUBE use |
|---|---|---:|---|
| Scroll-linked motion | Native CSS Scroll-Driven Animations | PILOT | Prefer compositor-friendly CSS for one or two local effects after real-device verification. Keep the current bounded rAF fallback. |
| Scroll polyfill reference | flackr/scroll-timeline | LEARN / HOLD | Useful compatibility reference; do not ship the polyfill unless unsupported browsers create a measured gap. |
| Creative OGL gallery pattern | bizarro/infinite-webl-gallery | LEARN / REIMPLEMENT | MIT Codrops/OGL reference for DOM-to-WebGL gallery motion. Borrow the interaction model, not the page design. |
| WebGL image transition reference | akella/webGLImageTransitions | LEARN / PILOT PATTERN | Distortion/warp transition techniques are relevant; respect the resource-specific redistribution terms and do not copy it as a plugin. |
| Shader/gallery orchestration | J0SUKE/gsap-threejs-codrops | LEARN ONLY | Useful for studying reveal-to-detail choreography; current D’AUBE runtime should not add both GSAP and Three.js for this surface. |
| CSS build pipeline | parcel-bundler/lightningcss | ADOPT BUILD-TIME | Minification, prefixing and modern CSS transforms once a formal build step is attached. No runtime cost. |
| Field performance | GoogleChrome/web-vitals | ADOPT DEV / OPTIONAL FIELD | Capture LCP/CLS/INP during QA or privacy-governed telemetry. Do not add analytics transport just to collect numbers. |
| Third-party off-main-thread | QwikDev/partytown | HOLD | Useful only if the public site later acquires heavy third-party analytics/marketing scripts. Current site has no need. |
| Font subset tooling | zachleat/glyphhanger | PILOT BUILD | Candidate if fonts are legally self-hosted. Subset only from authoritative source fonts and preserve licenses. |
| Font engineering | fonttools/fonttools | PILOT BUILD | Stronger low-level option for deterministic subsetting/metadata work. |
| WOFF2 codec | google/woff2 | TRANSITIVE / BUILD | Foundation for self-hosted WOFF2 output; no browser runtime dependency. |
| Codec reference | GoogleChromeLabs/squoosh | DEV / LEARN | Useful for visual codec comparisons and quality tuning; Sharp remains the automated build path. |
| AVIF codec | AOMediaCodec/libavif | TRANSITIVE / BUILD | Prefer through Sharp/libvips rather than wiring directly into the site. |
| WebP codec | webmproject/libwebp | TRANSITIVE / BUILD | Prefer through Sharp/libvips rather than direct runtime use. |
| Image placeholder | evanw/thumbhash | HOLD | Good for below-fold photographic media if the site gains a larger image library. Not useful for the eager hero. |
| Visual regression | garris/BackstopJS | HOLD | Mature option, but Playwright + screenshot assertions already give D’AUBE one browser owner. Avoid duplicate harnesses. |
| Visual regression CI | reg-viz/reg-suit | HOLD / FUTURE | Useful when persistent baseline storage and PR diff review are needed. Not required for the current static release. |
| Browser visual diff | Playwright + Pixelmatch | ADOPT DEV | Remains the preferred compact stack for deterministic viewport baselines and focused pixel diffs. |

## Creative-site references: what to copy and what not to copy

### Good patterns to reimplement

1. **One signature WebGL moment, not a full-site canvas.**
   - The best reusable idea from OGL/Codrops gallery work is the transition model: normal semantic DOM remains authoritative; WebGL is a visual enhancement around selected media.
2. **Reveal-to-detail continuity.**
   - Gallery references that morph a selected image into a detail view are more premium than unrelated hover effects everywhere.
3. **Capability-gated effects.**
   - Static image first; shader only on capable devices; pause when offscreen or hidden; recover to static media on WebGL context loss.
4. **Asset-led quality.**
   - High-end creative repos repeatedly rely on strong source imagery, carefully staged type, and only a few choreographed moments. The library choice is secondary.

### Patterns rejected for D’AUBE homepage

- full-page Three.js/R3F scene merely for atmosphere;
- Lenis + GSAP + Motion/Framer Motion + custom rAF all owning scroll at once;
- permanent custom cursor required for navigation;
- autoplay audio or autoplay heavy first-viewport video;
- loaders that delay usable content just to look cinematic;
- frame-by-frame scroll sequences before asset budget and mobile memory are proven;
- copied Awwwards layouts or third-party branded artwork.

## GitHub issue evidence carried into the release rules

### OGL context loss

`oframe/ogl#74` requests framework-level support for restoring resources after WebGL context loss. That is sufficient reason for D’AUBE to require an explicit `webglcontextlost` fallback before any OGL pilot can ship.

### Motion mobile scroll behavior

Earlier V13 research recorded `motiondivision/motion#2507`, where scroll-linked translateY jumping was reproduced on iPhone 15 Pro and Android. D’AUBE therefore avoids viewport-fragile `vh` scroll geometry and treats mobile browser chrome resizing as a real test case.

### Sharp/AVIF build cost

Earlier research captured Sharp reports where high-resolution AVIF encoding could be CPU/RAM heavy and where encode timing changed sharply at specific dimensions. Therefore AVIF remains build-time only, with bounded concurrency and WebP fallback.

## V14 selected combo

### Runtime

- semantic static HTML;
- V7 base design system;
- V12 Pure Cinema art/motion layer;
- V13 quality gates;
- native View Transitions as progressive enhancement;
- native scroll;
- one bounded hero rAF only on capable devices;
- IntersectionObserver for reveal/lifecycle;
- connection-aware same-origin prefetch;
- quality tier from reduced-motion, coarse pointer, device memory, CPU concurrency and data-saver/network class;
- zero third-party animation libraries in the critical runtime.

### Build-time quality lane

When build infrastructure is attached:

1. **Lightning CSS** for deterministic minify/prefix output.
2. **Sharp** for responsive media variants.
3. **AVIF + WebP + JPEG/PNG fallback** with visual comparison before changing quality settings.
4. Optional **FontTools/Glyphhanger/WOFF2** self-hosted font subset pipeline after font license/source verification.
5. Generate a manifest of asset dimensions, bytes and hashes for release evidence.

### Visual QA lane

- Playwright viewport matrix: 1440 desktop, 1024 tablet, 390/412 mobile, short-landscape viewport;
- reduced-motion and coarse-pointer emulation;
- Playwright screenshot assertions or Pixelmatch for stable surfaces;
- axe-core for automated accessibility;
- Lighthouse CI as a signal, never sole production truth;
- live-browser visual sign-off remains mandatory;
- HTTP availability check after every production activation.

## High-resolution media gate

The current hero source is still 1672×941. No codec or shader can create real missing detail. A genuine large master remains the highest-value visual upgrade.

Required before calling the hero “4K-quality”:

- real source detail at least 2560px wide; ideally 3840×2160 or larger;
- desktop and mobile crops reviewed separately;
- AVIF/WebP output visually compared against the source;
- no visible banding in sky/water gradients;
- transparent/glass bloom edges remain clean;
- final `picture/srcset/sizes` chooses appropriate widths rather than sending 4K to every phone.

## Experimental lane after the media gate is green

**OGL single-hero optical refraction** only:

- one canvas;
- one shader program;
- DPR capped;
- off on low-power/reduced-motion/coarse-pointer/data-saver;
- intersection/visibility pause;
- `webglcontextlost` -> immediately reveal static image and stop requesting frames;
- no dependency on the shader for content, navigation or legibility;
- ship only if screenshot + performance comparison is materially better than the static hero.

## Release principle

“Highest quality” means stronger art direction, stronger assets, more disciplined typography, fewer but better transitions, and stronger QA. It does **not** mean the greatest number of animation libraries.