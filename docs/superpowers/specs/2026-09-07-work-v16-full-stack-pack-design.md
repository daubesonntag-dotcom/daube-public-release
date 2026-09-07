# D’AUBE Work V16 — Full Stack Pack Design

Status: APPROVED BY FOUNDER / EXECUTE FULL / EVIDENCE-LED

## Goal

Turn the current V15 homepage into a coherent full-site release pack without repeating the V8–V11 failure mode of ornamental dependency stacking. The pack must improve perceived quality, media delivery, navigation continuity, accessibility, and release verification while preserving evidence-first copy and normal multi-page navigation.

## Scope

### 1. Full-site fidelity

Apply the current D’AUBE visual/navigation doctrine to the core public routes:
- `/`
- `/portfolio/`
- `/profile/`
- `/services/`
- `/pricing/`
- `/contact/`

Rules:
- semantic multi-page HTML remains authoritative;
- no JS router;
- no smooth-scroll owner;
- native View Transitions remain progressive enhancement only;
- one header/navigation interaction model across all routes;
- reduced-motion, touch/coarse-pointer, forced-colors, reduced-transparency and short-viewport behavior remain first-class;
- no new visible claims, metrics, testimonials, certifications, client history or scarcity.

### 2. Truthful responsive media pack

The existing hero master is 1672×941. V16 must improve delivery without pretending missing detail exists.

Generate only non-upscaled derivatives:
- desktop landscape widths: 768, 1200, 1600;
- formats: AVIF and WebP;
- mobile portrait crop: 706×941 AVIF and WebP, using the full source height and a focal crop around the bloom;
- retain the existing 1672×941 PNG only as the final fallback/source reference.

HTML uses `<picture>`, `srcset`, `sizes`, explicit dimensions, eager/high-priority hero loading, and a mobile media query. Lower-priority page media may remain lazy where already appropriate.

### 3. Release quality pack

Add zero-runtime release checks:
- full-site contract test for required routes and shared design assets;
- media contract test that forbids upscale claims and verifies responsive source sets;
- internal-link integrity checker for core HTML routes;
- homepage quality budget stays in force;
- GitHub Actions workflow runs Node contract/link checks on push/PR affecting the work surface.

No production dependency is added merely for linting or animation. External QA tools remain optional dev lanes.

### 4. Host independence

Remote Desktop Commander is a convenience surface, not a production dependency. The pack must continue to build and verify from GitHub even when the Remote Commander agent is offline. Existing host-autopilot/native-chain architecture remains authoritative for host continuity; V16 does not invent a second remote-control daemon.

### 5. Experimental optics boundary

OGL/refraction remains a post-media-gate pilot only. It is not part of the always-on V16 production runtime. If later piloted, it must be one hero canvas, capability-gated, paused offscreen/hidden, reduced-motion disabled, and fail immediately to static media on WebGL context loss.

## Acceptance criteria

- All six core routes load the same brand/navigation continuity layer.
- Inner pages retain their current information architecture and truth boundaries.
- Homepage and inner heroes select responsive AVIF/WebP derivatives where supported and never request an upscaled derivative.
- Mobile receives a dedicated portrait crop instead of relying only on landscape `object-fit`.
- No V8/V9/V10/V11, Lenis, GSAP, Three.js, Barba or Swup runtime returns.
- Contract tests fail before V16 route/media changes and pass after implementation.
- Live production remains HTTP 200 after activation.
- Browser visual sign-off is required after merge; source-level checks are not called visual QA.

## Non-goals

- no full-page WebGL;
- no autoplay audio/video;
- no new pricing or commercial claims;
- no framework migration;
- no fake 2K/4K label;
- no paid provider or paid fallback.
