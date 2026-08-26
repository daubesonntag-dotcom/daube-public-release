#!/usr/bin/env bash
set -euo pipefail
umask 077

# D'AUBE one-job private-repository GPU proof runner.
# This bootstrap is safe to mirror to a PUBLIC_SAFE host because it contains no
# repository credential, source checkout, private asset or production secret.
# A server-minted GitHub encoded JIT configuration is read once from stdin.

RUNNER_VERSION='2.336.0'
RUNNER_SHA256='04cf0be1aff4c3ec3554466c39124ca250e3effd8873bb7e8d68535aa9505d5d'
RUNNER_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
MIN_VRAM_MB="${DAUBE_PRIVATE_GPU_MIN_VRAM_MB:-12000}"
ROOT="${DAUBE_PRIVATE_GPU_RUNNER_ROOT:-/tmp/daube-private-gpu-jit-runner}"
PROOF="${DAUBE_PRIVATE_GPU_PROOF_PATH:-/tmp/daube-private-gpu-host-proof.json}"

log() { printf '[daube-private-gpu-jit] %s\n' "$*" >&2; }
fail() { log "ERROR: $*"; exit 1; }
require() { command -v "$1" >/dev/null 2>&1 || fail "missing executable: $1"; }

[[ "${DAUBE_ZERO_SPEND_MODE:-}" == '1' ]] || fail 'DAUBE_ZERO_SPEND_MODE=1 is required'
[[ "${DAUBE_REMOTE_WORKFLOW_EXECUTION_CONSENT:-}" == '1' ]] || fail 'explicit DAUBE_REMOTE_WORKFLOW_EXECUTION_CONSENT=1 is required'
[[ "${DAUBE_PRIVATE_CHECKOUT_ALLOWED:-0}" == '0' ]] || fail 'first proof forbids private checkout'
[[ "$MIN_VRAM_MB" =~ ^[1-9][0-9]{3,5}$ ]] || fail 'DAUBE_PRIVATE_GPU_MIN_VRAM_MB must be a bounded positive integer'
[[ "$(uname -s)" == 'Linux' ]] || fail 'Linux is required'
case "$(uname -m)" in x86_64|amd64) ;; *) fail 'x86_64 host required for pinned runner archive' ;; esac

for cmd in curl tar sha256sum nvidia-smi python3 mktemp; do require "$cmd"; done

if [[ -t 0 ]]; then
  fail 'encoded JIT config must be piped on stdin; interactive entry is forbidden'
fi
IFS= read -r JIT_CONFIG || fail 'unable to read encoded JIT configuration'
[[ ${#JIT_CONFIG} -ge 20 && ${#JIT_CONFIG} -le 32768 ]] || fail 'encoded JIT configuration length invalid'

# Hardware proof happens BEFORE GitHub runner startup. A host without measured
# CUDA cannot even appear as D'AUBE GPU proof capacity.
DAUBE_PRIVATE_GPU_MIN_VRAM_MB="$MIN_VRAM_MB" DAUBE_PRIVATE_GPU_PROOF_PATH="$PROOF" python3 - <<'PY'
import hashlib, json, os, platform, subprocess
from datetime import datetime, timezone

minimum = int(os.environ['DAUBE_PRIVATE_GPU_MIN_VRAM_MB'])
proof_path = os.environ['DAUBE_PRIVATE_GPU_PROOF_PATH']

def run(args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT, timeout=15).strip()

raw = run([
    'nvidia-smi',
    '--query-gpu=index,name,memory.total,driver_version',
    '--format=csv,noheader,nounits',
])
first = raw.splitlines()[0].split(',')
if len(first) < 4:
    raise SystemExit('nvidia_smi_receipt_invalid')
index = int(first[0].strip())
name = first[1].strip()
vram_mb = int(float(first[2].strip()))
driver = first[3].strip()
if vram_mb < minimum:
    raise SystemExit(f'gpu_vram_below_floor:{vram_mb}<{minimum}')

try:
    import torch
except Exception as exc:
    raise SystemExit(f'pytorch_unavailable:{type(exc).__name__}') from exc
if not torch.cuda.is_available():
    raise SystemExit('torch_cuda_unavailable')
if torch.cuda.device_count() < 1:
    raise SystemExit('torch_cuda_device_missing')

torch.manual_seed(16062003)
device = torch.device('cuda:0')
a = torch.randn((768, 768), device=device, dtype=torch.float32)
b = torch.randn((768, 768), device=device, dtype=torch.float32)
c = a @ b
torch.cuda.synchronize()
source = f"{float(c[0,0].item()):.8f}:{float(c[-1,-1].item()):.8f}:{float(c.mean().item()):.8f}"
matmul_sha = hashlib.sha256(source.encode()).hexdigest()
props = torch.cuda.get_device_properties(device)
receipt = {
    'schema': 'daube.private-gpu-host-proof.v1',
    'state': 'MEASURED_CUDA_HOST_READY_FOR_ONE_JOB_JIT',
    'observedAt': datetime.now(timezone.utc).isoformat(),
    'platform': platform.platform(),
    'gpuIndex': index,
    'gpuName': name,
    'vramMb': vram_mb,
    'driverVersion': driver,
    'torchVersion': torch.__version__,
    'cudaVersion': torch.version.cuda,
    'computeCapability': f'{props.major}.{props.minor}',
    'matmulShape': [768, 768],
    'matmulSha256': matmul_sha,
    'cudaAvailable': True,
    'zeroSpendRequired': True,
    'remoteWorkflowExecutionConsent': True,
    'privateCheckoutAllowed': False,
    'privateProductionSecretsAllowed': False,
    'githubRunnerConnectedObserved': False,
    'githubJobAcceptedObserved': False,
    'productionGpuEligible': False,
    'hardwareSerialStored': False,
    'truthBoundary': 'Measured CUDA host readiness precedes JIT startup. It does not prove GitHub runner connectivity, job acceptance, model runtime, private workload eligibility, or release eligibility.'
}
with open(proof_path, 'w', encoding='utf-8') as handle:
    json.dump(receipt, handle, indent=2, sort_keys=True)
os.chmod(proof_path, 0o600)
print(json.dumps(receipt, separators=(',', ':'), sort_keys=True))
PY

[[ -s "$PROOF" ]] || fail 'measured GPU host proof was not written'

tmp="$(mktemp -d)"
archive="$tmp/actions-runner.tar.gz"
cleanup() {
  unset JIT_CONFIG || true
  rm -rf "$tmp" "$ROOT"
}
trap cleanup EXIT INT TERM

rm -rf "$ROOT"
mkdir -p "$ROOT"
log "downloading pinned GitHub runner v${RUNNER_VERSION} x64"
curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error --output "$archive" "$RUNNER_URL"
printf '%s  %s\n' "$RUNNER_SHA256" "$archive" | sha256sum -c - >/dev/null

tar -xzf "$archive" -C "$ROOT"
[[ -x "$ROOT/run.sh" ]] || fail 'runner archive missing run.sh'

# GitHub's supported JIT startup interface. The JIT blob is necessarily an
# argument to run.sh; start it immediately, erase our shell copy, and retain no
# runner directory after the one-job process exits.
(
  cd "$ROOT"
  ./run.sh --jitconfig "$JIT_CONFIG"
) &
runner_pid=$!
unset JIT_CONFIG
set +e
wait "$runner_pid"
status=$?
set -e

log "one-job JIT runner exited status=${status}; scrub scheduled by EXIT trap"
exit "$status"
