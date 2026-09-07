# D’AUBE First Light Rose Garden — V11 CGI stack

Production runtime
- Three.js 0.180.0: 2.5D relief plane, physical glass dome, lighting, particles/petals.
- Theatre.js core 0.7.0: authored 6.5s opening timeline; Apache-2.0. Studio intentionally not shipped.
- postprocessing 6.39.4: high-tier Bloom + subtle Chromatic Aberration + Vignette; Zlib.
- Motion 13.2.0: DOM choreography; MIT.
- Lenis 1.3.26: desktop/fine-pointer only; MIT.
- Web Audio + CSS/native fallback: core interaction remains usable if optional CDN/WebGL fails.

Rendering design
- Rose image is rendered as a segmented plane with a generated depth map.
- Vertex displacement gives subtle 2.5D relief; fragment displacement adds animated micro-distortion.
- A real Three.js MeshPhysicalMaterial dome uses transmission/thickness/IOR over the rendered rose plate.
- Authored Theatre timeline drives camera push, dome lift/fade, rose relief scale, distortion pulse, bloom, chromatic split, 3D petal burst, copy reveal and light sweep.

Adaptive policy
- low: static cinematic image + CSS glass + DOM petals; no WebGL.
- medium: Three relief + physical glass + particles + Theatre; direct renderer.
- high: medium + postprocessing + higher geometry/particle counts + pointer parallax.

Fail-closed quality gates
- No fixed blocking overlay; opening is part of page flow.
- The rose fallback remains visible until the WebGL scene reports ready.
- Dynamic imports are fail-soft; Theatre failure falls back to native authored interpolation.
- Reduced-motion and Save-Data force low tier.
- Lenis is disabled on coarse-pointer/mobile.
