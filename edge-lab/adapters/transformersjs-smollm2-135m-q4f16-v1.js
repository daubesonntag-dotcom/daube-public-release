const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';
const MODEL_ID = 'onnx-community/SmolLM2-135M-Instruct-ONNX-MHA';
const MODEL_REVISION = '5b6682c';

export const metadata = Object.freeze({
  adapterId: 'transformersjs-smollm2-135m-instruct-q4f16-v1',
  runtime: '@huggingface/transformers@4.2.0',
  modelId: MODEL_ID,
  modelRevision: MODEL_REVISION,
  quantization: 'q4f16-webgpu/q4-wasm',
  license: 'apache-2.0',
  externalRuntimeUrl: TRANSFORMERS_URL,
  remoteModelHost: 'huggingface.co'
});

export async function probe({ capability } = {}) {
  const webgpu = capability?.webgpuReady === true && Boolean(navigator.gpu);
  return {
    backend: webgpu ? 'webgpu' : 'wasm',
    dtype: webgpu ? 'q4f16' : 'q4',
    modelDownloadExpected: true,
    externalRuntimeExpected: true
  };
}

export async function load({ capability } = {}) {
  const webgpu = capability?.webgpuReady === true && Boolean(navigator.gpu);
  const backend = webgpu ? 'webgpu' : 'wasm';
  const dtype = webgpu ? 'q4f16' : 'q4';
  const transformers = await import(TRANSFORMERS_URL);
  const options = {
    dtype,
    revision: MODEL_REVISION,
    ...(webgpu ? { device: 'webgpu' } : {})
  };
  const generator = await transformers.pipeline('text-generation', MODEL_ID, options);
  return { generator, backend, dtype };
}

export async function run(handle, input, { iteration = 1 } = {}) {
  if (!handle?.generator) throw new Error('smollm2 adapter handle missing');
  const prompt = String(input || '').slice(0, 1200);
  const output = await handle.generator(prompt, {
    max_new_tokens: 32,
    do_sample: false,
    return_full_text: false
  });
  const first = Array.isArray(output) ? output[0] : output;
  const generatedText = String(first?.generated_text ?? first?.text ?? first ?? '');
  return {
    generatedText,
    backend: handle.backend,
    dtype: handle.dtype,
    iteration,
    outputChars: generatedText.length
  };
}

export async function dispose(handle) {
  try {
    await handle?.generator?.dispose?.();
  } catch {
    // Best-effort browser resource release; tab teardown remains the final fallback.
  }
}
