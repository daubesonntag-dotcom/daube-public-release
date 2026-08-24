#!/usr/bin/env python3
"""D'AUBE Colab mailbox worker.

Public-safe worker code. Private identifiers are injected by the bootstrap via
environment variables; this file contains no credentials or private mailbox IDs.
"""

import hashlib
import json
import os
import subprocess
import sys
import time
import uuid
from urllib.parse import quote

MODEL_ID = "Qwen/Qwen3-4B-Instruct-2507"
WORKER_REVISION = "DAUBE-COLAB-MAILBOX-WORKER-V3-20260825"
SHEET = "Jobs"
TRANSPORT = "google-drive-sheet-fallback"
AUTHORITY = "forge-workforce-runtime"
EXECUTOR = f"colab_{uuid.uuid4().hex[:12]}"
HEADERS = [
    "job_id", "status", "created_at", "claimed_at", "completed_at",
    "model_id", "prompt", "system_prompt", "max_new_tokens", "temperature",
    "top_p", "executor_id", "result", "receipt_json", "error",
    "prompt_sha256", "result_sha256", "transport", "authority",
]

SPREADSHEET_ID = os.environ.get("DAUBE_COLAB_MAILBOX_SPREADSHEET_ID", "").strip()
SOURCE_URL = os.environ.get("DAUBE_COLAB_WORKER_SOURCE_URL", "").strip()
SOURCE_SHA256 = os.environ.get("DAUBE_COLAB_WORKER_SOURCE_SHA256", "").strip().lower()
SESSION_MINUTES = max(
    5,
    min(180, int(float(os.environ.get("DAUBE_COLAB_SESSION_MINUTES", "90") or "90"))),
)

if not SPREADSHEET_ID:
    raise RuntimeError("DAUBE_COLAB_MAILBOX_SPREADSHEET_ID is required")


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def sha(value):
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()


def num(value, default):
    try:
        return float(str(value).replace(",", "."))
    except Exception:
        return default


def run_cmd(args, timeout=30):
    proc = subprocess.run(
        args,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=timeout,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stdout.strip() or f"command_failed:{proc.returncode}")
    return proc.stdout.strip()


def pip_install(*packages):
    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", "-q", "-U", *packages],
        timeout=900,
    )


def rowjob(values, row):
    values = list(values) + [""] * max(0, len(HEADERS) - len(values))
    return dict(zip(HEADERS, values[: len(HEADERS)])) | {"row": row}


print("=== D'AUBE COLAB PUBLIC WORKER ===")
print("WORKER_REVISION", WORKER_REVISION)

# Claim first: Google auth + mailbox state become observable before GPU/model work.
from google.colab import auth  # type: ignore

auth.authenticate_user()

import google.auth  # type: ignore
from google.auth.transport.requests import AuthorizedSession  # type: ignore

credentials, _ = google.auth.default(
    scopes=["https://www.googleapis.com/auth/spreadsheets"]
)
sheet_http = AuthorizedSession(credentials)
sheet_base = f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}/values"


def sheet_get(a1):
    url = f"{sheet_base}/{quote(a1, safe='')}"
    response = sheet_http.get(url, timeout=20)
    if not response.ok:
        raise RuntimeError(
            f"sheets_get_failed:{response.status_code}:{response.text[:300]}"
        )
    return response.json().get("values", [])


def sheet_update(a1, rows):
    url = f"{sheet_base}/{quote(a1, safe='')}?valueInputOption=RAW"
    response = sheet_http.put(
        url,
        json={"range": a1, "majorDimension": "ROWS", "values": rows},
        timeout=20,
    )
    if not response.ok:
        raise RuntimeError(
            f"sheets_update_failed:{response.status_code}:{response.text[:300]}"
        )
    return response.json()


header_rows = sheet_get(f"{SHEET}!A1:S1")
if not header_rows or header_rows[0][: len(HEADERS)] != HEADERS:
    raise RuntimeError("drive_mailbox_schema_mismatch")
print("COLAB_DRIVE_MAILBOX_READY")


def validate(job):
    if job["status"] != "PENDING":
        raise RuntimeError("not_pending")
    if job["model_id"] != MODEL_ID:
        raise RuntimeError("wrong_model")
    if job["transport"] != TRANSPORT or job["authority"] != AUTHORITY:
        raise RuntimeError("wrong_authority")
    prompt = str(job["prompt"])
    if not prompt.strip():
        raise RuntimeError("empty_prompt")
    if len(prompt) > 32000:
        raise RuntimeError("prompt_too_large")
    system_prompt = str(job["system_prompt"] or "")
    if len(system_prompt) > 8000:
        raise RuntimeError("system_prompt_too_large")
    expected = str(job["prompt_sha256"]).strip().lower()
    if not expected or sha(prompt) != expected:
        raise RuntimeError("prompt_digest_mismatch")


def claim():
    rows = sheet_get(f"{SHEET}!A2:S1000")
    for offset, values in enumerate(rows, start=2):
        if not values:
            continue
        job = rowjob(values, offset)
        if job["status"] != "PENDING":
            continue
        validate(job)
        claimed_at = now()
        sheet_update(
            f"{SHEET}!B{offset}:L{offset}",
            [[
                "CLAIMED",
                job["created_at"],
                claimed_at,
                "",
                job["model_id"],
                job["prompt"],
                job["system_prompt"],
                job["max_new_tokens"],
                job["temperature"],
                job["top_p"],
                EXECUTOR,
            ]],
        )
        verify_rows = sheet_get(f"{SHEET}!A{offset}:S{offset}")
        verify = rowjob(verify_rows[0] if verify_rows else [], offset)
        if verify["status"] != "CLAIMED" or verify["executor_id"] != EXECUTOR:
            raise RuntimeError("drive_mailbox_claim_race")
        print("COLAB_DRIVE_MAILBOX_CLAIMED", verify["job_id"])
        return verify
    return None


def finish(job, status, result="", error="", receipt=None):
    done = now()
    result_hash = sha(result) if result else ""
    sheet_update(
        f"{SHEET}!B{job['row']}:S{job['row']}",
        [[
            status,
            job["created_at"],
            job["claimed_at"],
            done,
            job["model_id"],
            job["prompt"],
            job["system_prompt"],
            job["max_new_tokens"],
            job["temperature"],
            job["top_p"],
            EXECUTOR,
            result,
            json.dumps(receipt or {}, ensure_ascii=False),
            str(error)[:1000],
            job["prompt_sha256"],
            result_hash,
            TRANSPORT,
            AUTHORITY,
        ]],
    )
    print(f"COLAB_DRIVE_MAILBOX_{status}", job["job_id"])


current = claim()
if current is None:
    print("COLAB_DRIVE_MAILBOX_IDLE_NO_PENDING_JOB")
else:
    print("COLAB_DRIVE_MAILBOX_CLAIM_FIRST_PROVEN")

try:
    gpu = run_cmd(
        [
            "nvidia-smi",
            "--query-gpu=name,memory.total,driver_version",
            "--format=csv,noheader",
        ],
        timeout=20,
    )
    print("GPU:", gpu)

    pip_install(
        "transformers>=4.51,<5",
        "accelerate>=1.6,<2",
        "bitsandbytes>=0.45,<1",
        "huggingface_hub>=0.30,<1",
        "sentencepiece",
    )

    import torch  # type: ignore
    from transformers import (  # type: ignore
        AutoModelForCausalLM,
        AutoTokenizer,
        BitsAndBytesConfig,
    )

    if not torch.cuda.is_available():
        raise RuntimeError("cuda_unavailable")

    device = torch.cuda.get_device_name(0)
    vram = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
    print(f"CUDA READY: {device} / {vram:.1f} GiB")

    quant = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_use_double_quant=True,
    )

    print("Loading", MODEL_ID, "in 4-bit...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        device_map="auto",
        quantization_config=quant,
        dtype=torch.float16,
    )
    model.eval()

    def ask(
        prompt,
        system="",
        max_new_tokens=128,
        temperature=0.7,
        top_p=0.9,
    ):
        messages = [
            {
                "role": "system",
                "content": system or "You are a concise, careful D’AUBE assistant.",
            },
            {"role": "user", "content": prompt},
        ]
        inputs = tokenizer.apply_chat_template(
            messages,
            add_generation_prompt=True,
            tokenize=True,
            return_dict=True,
            return_tensors="pt",
        ).to(model.device)
        with torch.inference_mode():
            output = model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                do_sample=temperature > 0,
                temperature=max(temperature, 1e-5),
                top_p=top_p,
                pad_token_id=tokenizer.eos_token_id,
            )
        return tokenizer.decode(
            output[0][inputs["input_ids"].shape[1] :],
            skip_special_tokens=True,
        )

    smoke = ask(
        "Chào bạn. Chỉ trả lời: D’AUBE Qwen3 runtime ready.",
        max_new_tokens=48,
        temperature=0,
    )
    receipt = {
        "status": "COLAB_QWEN3_SMOKE_PROVEN",
        "workerRevision": WORKER_REVISION,
        "workerSourceUrl": SOURCE_URL,
        "workerSourceSha256": SOURCE_SHA256,
        "model": MODEL_ID,
        "device": device,
        "vramGiB": round(vram, 2),
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
        "gpu": gpu,
        "smokeChars": len(smoke),
        "timestamp": now(),
    }
    print(json.dumps(receipt, ensure_ascii=False, indent=2))

except Exception as exc:
    failure_receipt = {
        "status": "COLAB_BOOTSTRAP_FAILED",
        "workerRevision": WORKER_REVISION,
        "workerSourceUrl": SOURCE_URL,
        "workerSourceSha256": SOURCE_SHA256,
        "model": MODEL_ID,
        "executorId": EXECUTOR,
        "timestamp": now(),
    }
    if current is not None:
        finish(
            current,
            "FAILED",
            error=str(exc),
            receipt=failure_receipt,
        )
    raise

deadline = time.monotonic() + SESSION_MINUTES * 60
while time.monotonic() < deadline:
    if current is None:
        current = claim()
        if current is None:
            time.sleep(5)
            continue

    try:
        started = time.monotonic()
        result = ask(
            current["prompt"],
            current["system_prompt"],
            max_new_tokens=max(
                1,
                min(2048, int(num(current["max_new_tokens"], 512))),
            ),
            temperature=max(
                0,
                min(2, num(current["temperature"], 0.7)),
            ),
            top_p=max(
                0.05,
                min(1, num(current["top_p"], 0.9)),
            ),
        )
        task_receipt = receipt | {
            "jobId": current["job_id"],
            "executorId": EXECUTOR,
            "durationMs": int((time.monotonic() - started) * 1000),
            "transport": TRANSPORT,
        }
        finish(
            current,
            "DONE",
            result=result,
            receipt=task_receipt,
        )
    except KeyboardInterrupt:
        print("COLAB_DRIVE_MAILBOX_INTERRUPTED_BY_OPERATOR")
        break
    except Exception as exc:
        finish(
            current,
            "FAILED",
            error=str(exc),
            receipt=receipt
            | {
                "jobId": current["job_id"],
                "executorId": EXECUTOR,
                "transport": TRANSPORT,
            },
        )

    current = None

print("COLAB_DRIVE_MAILBOX_SESSION_ENDED")
