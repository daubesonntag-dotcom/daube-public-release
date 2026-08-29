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

HANDOFF_PATH = Path("handoff/open-weight-reasoning-canary-v1.json")
EVIDENCE_PATH = Path("evidence/open-weight-cpu-reasoning-canary.json")
EXPECTED_FORGE_SHA = "7e454bbb3f7eedb03a4330f44bc821ae924221d0"
EXPECTED_HANDOFF_DIGEST = "cf537efc054919a7597d7de275cf47b8352358e2ff78b135f09b664e61fb5b36"
EXPECTED_ENVELOPE_DIGEST = "e85f826549943961f162cc928b50254ddaee1599446b89ac150ccb0fd25c25c6"
PUBLIC_REPOSITORY = "daubesonntag-dotcom/daube-public-release"
FORGE_REPOSITORY = "daubesonntag-dotcom/daube-forge-os"


def stable_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def require_sha(value: str, code: str, length: int) -> str:
    text = str(value or "").strip().lower()
    if not re.fullmatch(rf"[0-9a-f]{{{length}}}", text):
        raise SystemExit(code)
    return text


def load_approved_handoff():
    envelope = json.loads(HANDOFF_PATH.read_text(encoding="utf-8"))
    supplied_envelope_digest = envelope.get("envelopeDigest")
    base = {key: value for key, value in envelope.items() if key != "envelopeDigest"}
    calculated_envelope_digest = sha256_text(stable_json(base))
    if supplied_envelope_digest != calculated_envelope_digest or calculated_envelope_digest != EXPECTED_ENVELOPE_DIGEST:
        raise SystemExit("public_handoff_envelope_integrity_failed")
    if envelope.get("schema") != "daube.public-open-weight-handoff-envelope.v1":
        raise SystemExit("public_handoff_schema_invalid")
    if envelope.get("canonicalForgeRepository") != FORGE_REPOSITORY or envelope.get("canonicalForgeSha") != EXPECTED_FORGE_SHA:
        raise SystemExit("public_handoff_forge_binding_failed")
    if envelope.get("workerReceiptAuthority") != "daube-public-release-worker.v1" or envelope.get("workerReceiptAuthoritative") is not False:
        raise SystemExit("public_handoff_worker_authority_invalid")

    handoff = envelope.get("handoff")
    if not isinstance(handoff, dict):
        raise SystemExit("public_handoff_payload_missing")
    calculated_handoff_digest = sha256_text(stable_json(handoff))
    if envelope.get("handoffDigest") != calculated_handoff_digest or calculated_handoff_digest != EXPECTED_HANDOFF_DIGEST:
        raise SystemExit("public_handoff_digest_mismatch")
    if handoff.get("authority") != "daube-forge-os" or handoff.get("dataClass") != "public":
        raise SystemExit("public_handoff_authority_or_data_class_invalid")
    if handoff.get("spend") != {"maxExternalSpendUsd": 0, "paidSpendAuthorized": False, "paidFallbackForbidden": True}:
        raise SystemExit("public_handoff_spend_boundary_invalid")
    runtime = handoff.get("runtime") or {}
    if runtime.get("deviceClass") != "cpu" or runtime.get("authenticationAllowed") is not False or runtime.get("privateAssetsAllowed") is not False or runtime.get("trustRemoteCode") is not False or runtime.get("implicitTokenAllowed") is not False:
        raise SystemExit("public_handoff_runtime_boundary_invalid")
    return envelope, handoff


def normalize_canary_output(text: str, expected: str):
    stripped = text.strip()
    if stripped == expected:
        return expected
    equation = re.fullmatch(r"17\s*\*\s*19\s*=\s*(-?\d+)", stripped)
    if equation:
        return equation.group(1)
    return None


def main() -> None:
    if os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN"):
        raise SystemExit("explicit_hf_token_not_allowed_for_public_worker")
    if os.environ.get("GITHUB_REPOSITORY") != PUBLIC_REPOSITORY:
        raise SystemExit("public_worker_repository_binding_failed")

    worker_source_sha = require_sha(os.environ.get("DAUBE_WORKER_SOURCE_SHA", ""), "public_worker_source_sha_invalid", 40)
    envelope, handoff = load_approved_handoff()
    model_contract = handoff["model"]
    inference = handoff["inference"]
    model_id = model_contract["id"]
    model_revision = require_sha(model_contract["revision"], "model_revision_invalid", 40)
    prompt = inference["prompt"]
    expected_answer = str(inference["expectedOutput"])

    started = time.time()
    info = model_info(model_id, revision=model_revision, token=False)
    if info.sha != model_revision:
        raise SystemExit(f"model_revision_mismatch:{info.sha}")

    tokenizer = AutoTokenizer.from_pretrained(
        model_id,
        revision=model_revision,
        token=False,
        trust_remote_code=False,
    )
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        revision=model_revision,
        token=False,
        trust_remote_code=False,
        torch_dtype=torch.float32,
    )
    model.eval()
    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))

    rendered = tokenizer.apply_chat_template(
        [{"role": "user", "content": prompt}],
        tokenize=False,
        add_generation_prompt=True,
        enable_thinking=False,
    )
    inputs = tokenizer(rendered, return_tensors="pt")

    with torch.inference_mode():
        output_ids = model.generate(
            **inputs,
            max_new_tokens=int(inference["maxNewTokens"]),
            do_sample=False,
            pad_token_id=tokenizer.eos_token_id,
        )

    generated = output_ids[0][inputs["input_ids"].shape[-1]:]
    raw_text = tokenizer.decode(generated, skip_special_tokens=True).strip()
    normalized_output = normalize_canary_output(raw_text, expected_answer)
    exact_output_match = normalized_output == expected_answer

    commit_hash = getattr(model.config, "_commit_hash", None)
    if commit_hash != model_revision:
        raise SystemExit(f"loaded_model_revision_mismatch:{commit_hash}")

    receipt = {
        "schema": "daube.public-open-weight-worker-receipt.v1",
        "authority": "daube-public-release-worker.v1",
        "nonAuthoritative": True,
        "canonicalForgeRepository": FORGE_REPOSITORY,
        "canonicalForgeSha": EXPECTED_FORGE_SHA,
        "publicReleaseRepository": PUBLIC_REPOSITORY,
        "workerSourceSha": worker_source_sha,
        "handoffDigest": envelope["handoffDigest"],
        "dataClass": "public",
        "status": "OPEN_WEIGHT_CPU_INFERENCE_COMPLETED" if exact_output_match else "OPEN_WEIGHT_CPU_INFERENCE_INCORRECT",
        "providerClass": "github-public-runner",
        "runtimeClass": "ephemeral-cpu-open-weight",
        "model": {
            "id": model_id,
            "revision": model_revision,
            "license": model_contract["license"],
        },
        "engine": {
            "library": "transformers",
            "transformersVersion": transformers.__version__,
            "torchVersion": torch.__version__,
            "pythonVersion": platform.python_version(),
            "device": "cpu",
        },
        "verification": {
            "hubRevisionReadback": info.sha,
            "loadedModelRevision": commit_hash,
            "promptSha256": sha256_text(prompt),
            "rawOutputSha256": sha256_text(raw_text),
            "outputSha256": sha256_text(normalized_output or ""),
            "outputPresent": bool(raw_text),
            "normalizedOutput": normalized_output,
            "exactOutputMatch": exact_output_match,
        },
        "securityAndCost": {
            "authenticationUsed": False,
            "privateAssetsUsed": False,
            "paidSpendAuthorized": False,
            "implicitTokenDisabled": True,
            "trustRemoteCode": False,
        },
        "elapsedSeconds": round(time.time() - started, 3),
    }

    EVIDENCE_PATH.parent.mkdir(parents=True, exist_ok=True)
    EVIDENCE_PATH.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(receipt, sort_keys=True))

    if not raw_text:
        raise SystemExit("open_weight_worker_returned_no_output")
    if not exact_output_match:
        raise SystemExit("open_weight_worker_exact_output_check_failed")


if __name__ == "__main__":
    main()
