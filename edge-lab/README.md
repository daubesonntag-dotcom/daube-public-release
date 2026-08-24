# D'AUBE Volunteer Browser Evidence

This public lab collects **real, consented browser-hardware evidence** for D'AUBE's zero-spend compute research.

## What it runs

1. A deterministic RGBA premultiply kernel on CPU.
2. The same kernel on WebGPU when the browser/device exposes WebGPU.
3. Optional quantized browser inference using:
   - `@huggingface/transformers@4.2.0`
   - `onnx-community/SmolLM2-135M-Instruct-ONNX-MHA`
   - pinned revision `5b6682c`
   - `q4f16` on WebGPU, `q4` WASM fallback.

## Consent and privacy

- Nothing runs until the local user checks consent and presses **Run**.
- The page asks for no login, password, API key or token.
- It stores no credentials in browser persistence.
- Private D'AUBE assets are never sent to volunteer devices.
- The submitted receipt contains benchmark/device-class metadata, timings, deterministic checksums and bounded model-output evidence.
- Raw receipts are stored privately; the public endpoint exposes aggregate counts only.

## Stop

The local user can press **Stop** at any time. The current browser operation may finish, but the next benchmark stage will not start.

## Cost boundary

D'AUBE authorizes **USD 0 paid overflow** for this volunteer evidence lane.
