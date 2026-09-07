# D’AUBE Work V16 Full Stack Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the V15 homepage quality system across the six core public routes, add truthful responsive hero media, and add release contracts that keep the stack lean and verifiable.

**Architecture:** Preserve the existing static multi-page site. Production runtime stays native: V7 base + existing V12/V13/V15 homepage layers, V7/V5 inner system for inner routes, and progressive native View Transitions. V16 adds no animation framework; it strengthens shared route markup, responsive media delivery, and zero-runtime release verification.

**Tech Stack:** Semantic HTML, CSS, vanilla JavaScript, Node.js built-ins for contract checks, AVIF/WebP pre-generated media, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-07-work-v16-full-stack-pack-design.md`

## Global Constraints

- No framework migration.
- No Lenis, GSAP, Three.js, Barba, Swup, full-page WebGL, autoplay audio/video, paid provider, or paid fallback.
- No fake 2K/4K claim: source master is 1672×941.
- Core routes: `/`, `/portfolio/`, `/profile/`, `/services/`, `/pricing/`, `/contact/`.
- Normal MPA navigation must work when View Transitions are unsupported.
- Reduced motion and touch/coarse-pointer behavior are release requirements.

---

### Task 1: Full-site contract first

**Files:**
- Create: `tests/work-v16-full-stack-contract.test.mjs`

**Interfaces:**
- Consumes: six core route HTML files.
- Produces: a single Node contract that fails until V16 shared route/media markers exist.

- [x] Write assertions requiring every route to reference `work-v15-navigation.css`, include explicit hero image dimensions, and expose shared brand/navigation semantics.
- [x] Assert homepage keeps exactly one external runtime JS and forbids V8–V11/Lenis/GSAP/Three/Barba/Swup tokens.
- [x] Assert each route contains AVIF/WebP `<picture>` source declarations and mobile crop media rules.
- [x] Run on isolated-branch GitHub Actions and verify RED before implementation (`Work V16 TDD` run 34140206443, conclusion `failure`).

### Task 2: Generate truthful responsive hero media

**Files:**
- Create: `assets/media/hero/daube-bloom-768.avif`
- Create: `assets/media/hero/daube-bloom-1200.avif`
- Create: `assets/media/hero/daube-bloom-1600.avif`
- Create: `assets/media/hero/daube-bloom-768.webp`
- Create: `assets/media/hero/daube-bloom-1200.webp`
- Create: `assets/media/hero/daube-bloom-1600.webp`
- Create: `assets/media/hero/daube-bloom-mobile-706x941.avif`
- Create: `assets/media/hero/daube-bloom-mobile-706x941.webp`
- Create: `assets/media/hero/manifest.json`

**Interfaces:**
- Consumes: existing 1672×941 approved bloom master.
- Produces: non-upscaled responsive variants and manifest with source/derivative dimensions.

- [ ] Generate landscape derivatives at 768/1200/1600 widths preserving aspect ratio.
- [ ] Generate the maximum truthful portrait crop at 706×941 centered on the bloom without upscaling.
- [ ] Encode AVIF and WebP with high visual quality; record bytes, dimensions and SHA-256 in manifest.
- [ ] Verify every derivative width/height stays within source dimensions and manifest records `upscaled:false`.

### Task 3: Activate responsive media and V15 continuity across routes

**Files:**
- Modify: `index.html`
- Modify: `portfolio/index.html`
- Modify: `profile/index.html`
- Modify: `services/index.html`
- Modify: `pricing/index.html`
- Modify: `contact/index.html`

**Interfaces:**
- Consumes: media files from Task 2 and `assets/work-v15-navigation.css`.
- Produces: consistent route heroes and progressive cross-document continuity.

- [ ] Replace hero `<img>` on all six routes with `<picture>` containing mobile AVIF/WebP, desktop AVIF/WebP srcsets, and original PNG fallback.
- [ ] Keep explicit `width="1672" height="941"`, eager/high-priority loading on first hero, and useful alt text.
- [ ] Add `work-v15-navigation.css` to all inner routes and preserve `work-v5-inner.css`.
- [ ] Ensure brand link has `aria-label`, primary/footer navigation has labels, and current route retains `aria-current`.
- [ ] Run the V16 contract and require GREEN.

### Task 4: Add zero-runtime route/link/media verification

**Files:**
- Create: `scripts/check-work-v16-links.mjs`
- Create: `tests/work-v16-media-contract.test.mjs`

**Interfaces:**
- Consumes: static HTML files and hero media manifest.
- Produces: deterministic local/CI release failures for broken internal routes or dishonest media metadata.

- [ ] Write internal-link checker that parses local `href="/..."` targets from the six route files and verifies file/directory targets exist; allow mailto/hash/external URLs.
- [ ] Write media test asserting manifest source is 1672×941, all derivatives are non-upscaled, mobile crop is 706×941, and required AVIF/WebP files exist in manifest.
- [ ] Run both checks and require GREEN.

### Task 5: Add V16 GitHub quality workflow

**Files:**
- Create: `.github/workflows/work-v16-quality-pack.yml`

**Interfaces:**
- Consumes: Node tests/scripts from Tasks 1 and 4 plus existing `scripts/work-quality-budget.mjs`.
- Produces: PR/push quality gate with no production runtime dependency.

- [ ] Trigger on pull requests and pushes affecting the six routes, relevant assets, tests/scripts, or workflow itself.
- [ ] Use Node 22 and run `node scripts/work-quality-budget.mjs`, V16 contract, V16 media contract, and internal-link checker.
- [ ] Upload no secrets and perform no deployment/mutation.

### Task 6: Browser/live verification and activation

**Files:**
- No new production files unless QA finds a concrete defect.

**Interfaces:**
- Consumes: completed branch.
- Produces: merge decision and live evidence.

- [ ] Open PR from isolated V16 branch to `main`.
- [ ] Review diff for copy/truth-boundary regressions.
- [ ] Merge after source-level gates are green or manually verified if GitHub runner startup is unavailable.
- [ ] Confirm live HTTP 200 and production serves V16 hero media markup.
- [ ] Use live browser to inspect desktop first viewport, Work, Services, Process/In Motion, CTA, and at least one inner route; capture screenshot evidence where available.
- [ ] Do not call visual PASS if rendered browser evidence is unavailable.
