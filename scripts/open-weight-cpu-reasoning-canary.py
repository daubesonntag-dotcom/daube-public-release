import hashlib
import json
import os
import platform
import re
import time
from pathlib import Path

import torch
import transformers
from huggingface_hub import model_info
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL_ID = "Qwen/Qwen3-0.6B"
MODEL_REVISION = "c1899de289a04d12100db370d81485cdf75e47ca"
EXPECTED_ANSWER = "323"
PROMPT = "Compute 17 * 19. Reply with only the integer answer and no explanation."
EVIDENCE_PATH = Path("evidence/open-weight-cpu-reasoning-canary.json")


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def main() -> None:
    if os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN"):
        raise SystemExit("implicit_or_explicit_hf_token_not_allowed_for_public_canary")

    started = time.time()
    info = model_info(MODEL_ID, revision=MODEL_REVISION, token=False)
    if info.sha != MODEL_REVISION:
        raise SystemExit(f"model_revision_mismatch:{info.sha}")

    tokenizer = AutoTokenizer.from_pretrained(
        MODEL_ID,
        revision=MODEL_REVISION,
        token=False,
        trust_remote_code=False,
    )
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        revision=MODEL_REVISION,
        token=False,
        trust_remote_code=False,
        torch_dtype=torch.float32,
    )
    model.eval()
    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))

    messages = [{"role": "user", "content": PROMPT}]
    rendered = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
        enable_thinking=False,
    )
    inputs = tokenizer(rendered, return_tensors="pt")

    with torch.inference_mode():
        output_ids = model.generate(
            **inputs,
            max_new_tokens=16,
            do_sample=False,
            pad_token_id=tokenizer.eos_token_id,
        )

    generated = output_ids[0][inputs["input_ids"].shape[-1]:]
    text = tokenizer.decode(generated, skip_special_tokens=True).strip()
    numbers = re.findall(r"-?\d+", text)
    reasoning_check = EXPECTED_ANSWER in numbers

    commit_hash = getattr(model.config, "_commit_hash", None)
    if commit_hash and commit_hash != MODEL_REVISION:
        raise SystemExit(f"loaded_model_revision_mismatch:{commit_hash}")

    receipt = {
        "schema": "daube.open-weight-cpu-reasoning-canary.v1",
        "status": "OPEN_WEIGHT_CPU_INFERENCE_COMPLETED" if reasoning_check else "OPEN_WEIGHT_CPU_INFERENCE_INCORRECT",
        "provider_class": "github-public-runner",
        "runtime_class": "ephemeral-cpu-open-weight",
        "model": {
            "id": MODEL_ID,
            "revision": MODEL_REVISION,
            "license": "apache-2.0",
            "architecture": "qwen3",
            "parameters": 751632384,
        },
        "engine": {
            "library": "transformers",
            "transformers_version": transformers.__version__,
            "torch_version": torch.__version__,
            "python_version": platform.python_version(),
            "device": "cpu",
        },
        "verification": {
            "hub_revision_readback": info.sha,
            "loaded_model_revision": commit_hash,
            "prompt_sha256": sha256_text(PROMPT),
            "output_sha256": sha256_text(text),
            "output_present": bool(text),
            "simple_reasoning_check": reasoning_check,
            "expected_answer": EXPECTED_ANSWER,
        },
        "security_and_cost": {
            "authentication_used": False,
            "private_assets_used": False,
            "paid_spend_authorized": False,
            "implicit_token_disabled": True,
            "trust_remote_code": False,
        },
        "elapsed_seconds": round(time.time() - started, 3),
    }

    EVIDENCE_PATH.parent.mkdir(parents=True, exist_ok=True)
    EVIDENCE_PATH.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(receipt, sort_keys=True))

    if not text:
        raise SystemExit("open_weight_canary_returned_no_output")
    if not reasoning_check:
        raise SystemExit(f"open_weight_canary_reasoning_check_failed:{text[:160]}")


if __name__ == "__main__":
    main()
