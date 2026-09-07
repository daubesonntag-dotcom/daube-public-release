# First Light Visual QC

Deterministic frame audit for the V12 authored rose timeline.

- Browser: Playwright Chromium, fixed viewport/device scale.
- Frames: 0, 0.5, 1.5, 2.8, 4.2, 5.7, 7.2 seconds.
- Viewports: 1440×1000 desktop and 390×844 mobile.
- Runtime checks: console/page errors + axe-core WCAG 2 A/AA serious/critical violations.
- Visual diff: pixelmatch threshold 0.10, fail when >0.25% of pixels differ from a committed baseline.
- Scene contract: `window.__DAUBE_QA__.seek(seconds)` freezes the authored Theatre/Three state before capture.

Baselines live in `qa/baselines/`. If absent, CI captures evidence and uploads it without silently inventing a baseline.