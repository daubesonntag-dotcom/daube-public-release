#!/usr/bin/env python3
from __future__ import annotations
import base64, hashlib, json, os, platform, re, shutil, socket, subprocess, tempfile, time, urllib.error, urllib.request
from pathlib import Path

HOME = Path(os.environ.get("DAUBE_SOVEREIGN_HOME", str(Path.home() / ".local/share/daube-sovereign-host")))
KEY = HOME / "host-ed25519.pem"; PUB = HOME / "host-ed25519.pub.pem"; LATEST = HOME / "latest-direct-proof.json"
INTAKE_URL = os.environ.get("DAUBE_SOVEREIGN_INTAKE_URL", "https://wilqsqndjgckqxbjptxm.supabase.co/functions/v1/daube-sovereign-host-direct-intake").rstrip("/")
MAX_HTTP_SECONDS = 5

def run(*args: str, input_bytes: bytes | None = None) -> bytes: return subprocess.check_output(args, input=input_bytes, timeout=10)
def require_runtime() -> None:
    if platform.system().lower() != "linux": raise SystemExit("D'AUBE sovereign-local proof requires a Linux runtime.")
    if shutil.which("openssl") is None: raise SystemExit("OpenSSL with Ed25519 support is required.")
    HOME.mkdir(parents=True, exist_ok=True); os.chmod(HOME, 0o700)
def ensure_identity() -> tuple[str, str]:
    if not KEY.exists(): run("openssl", "genpkey", "-algorithm", "ED25519", "-out", str(KEY)); os.chmod(KEY, 0o600)
    run("openssl", "pkey", "-in", str(KEY), "-pubout", "-out", str(PUB)); public_pem = PUB.read_text(encoding="utf-8")
    return public_pem, hashlib.sha256(public_pem.encode()).hexdigest()
def read_first(paths: list[str]) -> list[str]:
    values=[]
    for name in paths:
        try:
            value=Path(name).read_text(encoding="utf-8",errors="ignore").replace("\x00","").strip()
            if value: values.append(value)
        except OSError: pass
    return values
def metadata_probe(url: str, headers: dict[str,str] | None=None) -> bool:
    try:
        req=urllib.request.Request(url,headers=headers or {},method="GET")
        with urllib.request.urlopen(req,timeout=0.45) as response: return 200 <= response.status < 300
    except Exception: return False
def cloud_heuristic() -> dict[str,object]:
    signals=read_first(["/sys/class/dmi/id/sys_vendor","/sys/class/dmi/id/product_name","/sys/class/dmi/id/board_vendor","/proc/device-tree/model"]); joined=" | ".join(signals).lower()
    patterns=[("amazon-ec2",r"amazon ec2|amazon"),("google-compute",r"google compute engine"),("microsoft-azure",r"microsoft corporation.*virtual|virtual machine.*microsoft|azure"),("oracle-cloud",r"oraclecloud|oracle cloud"),("digitalocean",r"digitalocean"),("hetzner",r"hetzner"),("vultr",r"vultr"),("linode",r"linode|akamai connected cloud")]
    provider=next((name for name,pattern in patterns if re.search(pattern,joined)),None)
    if provider is None and metadata_probe("http://169.254.169.254/opc/v2/instance/",{"Authorization":"Bearer Oracle"}): provider="oracle-cloud"
    if provider is None and metadata_probe("http://169.254.169.254/latest/meta-data/instance-id"): provider="amazon-ec2"
    if provider is None and metadata_probe("http://metadata.google.internal/computeMetadata/v1/instance/id",{"Metadata-Flavor":"Google"}): provider="google-compute"
    if provider is None and metadata_probe("http://169.254.169.254/metadata/instance?api-version=2021-02-01",{"Metadata":"true"}): provider="microsoft-azure"
    return {"detected":provider is not None,"providerHint":provider,"signalDigest":hashlib.sha256(joined.encode()).hexdigest()}
def memory_mib() -> int:
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemTotal:"): return int(line.split()[1])//1024
    except OSError: pass
    return 0
def uptime_seconds() -> int:
    try: return int(float(Path("/proc/uptime").read_text().split()[0]))
    except Exception: return 0
def disk_free_mib() -> int: return int(shutil.disk_usage("/").free//(1024*1024))
def cpu_canary() -> dict[str,object]:
    work_units=100000; digest=hashlib.sha256(); start=time.perf_counter()
    for i in range(work_units): digest.update(f"daube-sovereign-{i}".encode())
    return {"passed":True,"workUnits":work_units,"elapsedMs":max(1,int((time.perf_counter()-start)*1000)),"sha256":digest.hexdigest()}
def storage_canary() -> dict[str,object]:
    payload=hashlib.sha256(b"daube-sovereign-storage-seed").digest()*32768; expected=hashlib.sha256(payload).hexdigest()
    with tempfile.NamedTemporaryFile(prefix="daube-sovereign-",dir=str(HOME),delete=False) as h: path=Path(h.name); h.write(payload); h.flush(); os.fsync(h.fileno())
    try: observed=hashlib.sha256(path.read_bytes()).hexdigest()
    finally: path.unlink(missing_ok=True)
    return {"passed":observed==expected,"bytes":len(payload),"sha256":observed}
def network_canary() -> dict[str,object]:
    req=urllib.request.Request(INTAKE_URL,headers={"Accept":"application/json","User-Agent":"daube-sovereign-agent/1"}); start=time.perf_counter()
    try:
        with urllib.request.urlopen(req,timeout=MAX_HTTP_SECONDS) as response:
            body=json.loads(response.read(65536).decode()); return {"passed":response.status==200 and body.get("live") is True,"httpStatus":response.status,"latencyMs":int((time.perf_counter()-start)*1000)}
    except Exception as exc: return {"passed":False,"httpStatus":None,"latencyMs":int((time.perf_counter()-start)*1000),"errorClass":type(exc).__name__}
def canonical_json(value: object) -> bytes: return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()
def sign(payload: dict[str,object]) -> str: return base64.b64encode(run("openssl","pkeyutl","-sign","-rawin","-inkey",str(KEY),input_bytes=canonical_json(payload))).decode("ascii")
def build_submission(public_pem: str, fingerprint: str) -> dict[str,object]:
    observed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()); cloud=cloud_heuristic(); cpu=cpu_canary(); storage=storage_canary(); network=network_canary(); canary={"success":bool(cpu["passed"] and storage["passed"] and network["passed"]),"observedAt":observed_at,"cpu":cpu,"storage":storage,"network":network,"privateAssetsUsed":False,"paidSpendAuthorized":False}; host_id=f"sovereign-{fingerprint[:20]}"
    attestation={"schema":"daube.sovereign-direct-proof.v1","hostId":host_id,"observedAt":observed_at,"platform":"linux","arch":platform.machine(),"kernelRelease":platform.release(),"ownerControlClaim":True,"sensitiveDataIncluded":False,"privateAssetsUsed":False,"paidSpendAuthorized":False,"capacity":{"cpuLogical":os.cpu_count() or 0,"memoryMiB":memory_mib(),"diskFreeMiB":disk_free_mib(),"uptimeSeconds":uptime_seconds()},"cloudHeuristic":cloud,"identity":{"publicKeySha256":fingerprint,"hostnameSha256":hashlib.sha256(socket.gethostname().encode()).hexdigest()},"canary":canary}
    return {"schema":"daube.sovereign-direct-submission.v1","attestation":attestation,"publicKeyPem":public_pem,"signatureBase64":sign(attestation)}
def submit(payload: dict[str,object]) -> tuple[int,dict[str,object]]:
    req=urllib.request.Request(INTAKE_URL,data=json.dumps(payload,separators=(",",":"),ensure_ascii=False).encode(),headers={"Content-Type":"application/json","Accept":"application/json","User-Agent":"daube-sovereign-agent/1"},method="POST")
    try:
        with urllib.request.urlopen(req,timeout=MAX_HTTP_SECONDS) as response: return response.status,json.loads(response.read(131072).decode())
    except urllib.error.HTTPError as error:
        try: body=json.loads(error.read(131072).decode())
        except Exception: body={"ok":False,"code":f"http_{error.code}"}
        return error.code,body
def main() -> int:
    require_runtime(); public_pem,fingerprint=ensure_identity(); submission=build_submission(public_pem,fingerprint); LATEST.write_text(json.dumps(submission,indent=2,ensure_ascii=False)+"\n",encoding="utf-8"); os.chmod(LATEST,0o600); status,response=submit(submission)
    summary={"schema":"daube.sovereign-direct-agent-result.v1","httpStatus":status,"status":response.get("status","UNKNOWN"),"code":response.get("code"),"hostId":submission["attestation"]["hostId"],"publicKeySha256":fingerprint,"cloudDetected":submission["attestation"]["cloudHeuristic"]["detected"],"canaryPass":submission["attestation"]["canary"]["success"],"nextGate":response.get("nextGate")}; print(json.dumps(summary,indent=2,ensure_ascii=False))
    if status in (200,201) and response.get("status")=="VERIFIED": return 0
    if status==409 and response.get("code") in ("host_key_not_registered","host_key_not_active"): print("PAIRING_REQUIRED: approve only this public-key fingerprint after confirming this is a directly controlled physical/local host."); return 3
    return 2
if __name__=="__main__": raise SystemExit(main())
