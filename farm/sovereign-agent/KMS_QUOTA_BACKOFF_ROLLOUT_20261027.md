# D’AUBE Android/Termux KMS V1 quota-backoff rollout

Status: CANDIDATE / source-verified, **NOT installed on the phone**.
Scope: D’AUBE sovereign KMS V1 polling worker ONLY. No migration of customer/private data, identity key, key alias, public website or paid plan.
Source PR: https://github.com/daubesonntag-dotcom/daube-public-release/pull/335

## Proven facts and expected behavior

Supabase Free responded 402 `exceed_edge_functions_invocations_quota` and `exceed_egress_quota`. A 24-hour read-only log sample contained 11,762 poll failures with User-Agent `daube-sovereign-kms-worker/1`. That UA exists in the original Termux KMS V1 source; source-only correlation does **not** establish that a specific physical phone is currently online.

New V1 daemon logic: 402 polling failures slow to a 60 → 120 → 240 → 480 → 960 → 1920 → capped 3600-second base delay, each ±10% bounded jitter. 429 uses 15-second base doubling to 300 seconds. Healthy polls reset the counter. `--once` and crypto routines remain unchanged. This is provider load prevention; it cannot restore a restricted Supabase plan.

Independent connected host test: 5/5 Python focused tests PASS and py_compile PASS; the GitHub source/test blobs were re-fetched and retested against immutable source commit `8ad70ce8e91eb8b937a99d956b0749e37e87bef4`. Android/Termux runtime test is still required.

## Gate: identify the real Termux owner and worker

1. Use only the already founder-authorized Android/Termux device; never ask someone to paste passwords, OTPs, cloud credentials or private keys in chat.
2. Verify the running process is KMS **V1** (not V2/v3 watchdog) and that `~/.local/lib/daube-sovereign-agent/sovereign-kms-worker.py` is its source path. If its file/process ownership is unclear, STOP.
3. Verify a controlled rollback and no duplicated supervisor/wake-lock schedule. Inspect `~/.local/share/daube-sovereign-host/kms/worker.pid` and relevant launcher. Do not print private key material or entire logs into public GitHub.
4. No Android device is currently accessible through the connected D’AUBE Remote Desktop Commander inventory. Do not claim live patch admission until the actual paired device is reachable and identified.

## Immutable read-only candidate fetch on Termux

Run after inspecting the source and confirming all prerequisites. This **only downloads and verifies a temporary file**:

```bash
set -euo pipefail
case "${PREFIX:-}" in *com.termux*) ;; *) echo 'STOP: Termux required'; exit 2;; esac
candidate="$(mktemp)"
trap 'rm -f "$candidate"' EXIT
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  'https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/8ad70ce8e91eb8b937a99d956b0749e37e87bef4/farm/sovereign-agent/sovereign-kms-worker.py' \
  --output "$candidate"
printf '%s  %s\n' 'ed08a0007d329d65691f862972c68a148a86b4f796c8dc886563bb004e16288a' "$candidate" | sha256sum -c -
python -m py_compile "$candidate"
printf 'CANDIDATE_VERIFIED_ONLY: no installed file changed\n'
```

## Controlled operator rollout (separate approved action)

After confirm V1 process PID, installed source SHA and service controls, a designated operator can:
- Back up `~/.local/lib/daube-sovereign-agent/sovereign-kms-worker.py` as a private timestamped file in that same directory. Never copy `~/.local/share/daube-sovereign-host/kms/root-rsa-3072.pem` to an external host.
- Use the existing V1 stop launcher if and only if it governs the verified process. Atomic-install the hash-verified candidate with the original owner/mode, then start using the same verified launcher.
- Check a single new PID, exact installed source SHA256, bounded `retryAfterSeconds` status log (no private payloads), and reduced 402 request rate. Do not call external KMS to force success while provider quota is exhausted.
- A failed local health check must stop the new worker and restore the same backup and original launcher; preserve a private rollback receipt with source digests and times.

## Gate before closing

1. Android device identity and installed file/pid verified.
2. Snapshot and backup digest recorded.
3. Pinned new source digest matches.
4. Real Android daemon 402 backoff + successful recovery tested without exposing key.
5. 24-hour provider traffic comparison and independent QA approval available.
6. No special privileges, spend, payment or access policy are broadened.

Until all above are proven: **SOURCE_VERIFIED / RUNTIME_HOLD**.
