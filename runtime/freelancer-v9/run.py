import argparse
import fcntl
import json
from pathlib import Path

import controller


VERSION = "v9-daube-execution-mesh"
HOME = Path.home()
BASE = HOME / "daube-revenue-worker"
OPS = BASE / "full-loop"
JOBS = OPS / "jobs"


def _read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def eligible_jobs(jobs_dir: Path):
    jobs_dir = Path(jobs_dir)
    if not jobs_dir.exists():
        return []
    selected = []
    for job_dir in sorted(path for path in jobs_dir.iterdir() if path.is_dir()):
        task = _read_json(job_dir / "EXECUTOR_JOB.json")
        if not task or task.get("state") != "READY_FOR_EXECUTOR":
            continue
        state = _read_json(job_dir / "v9-state.json") or {}
        if state.get("state") == "DELIVERY_READY":
            continue
        selected.append(job_dir)
    return selected


def process_job(job_dir: Path):
    lock_path = Path(job_dir) / ".v9-executor.lock"
    lock_path.touch(exist_ok=True)
    with lock_path.open("r+") as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"state": "SKIPPED_LOCKED"}
        return controller.run_job(job_dir)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args(argv)
    if args.verify:
        print(f"VERSION={VERSION} IMPORTS=OK")
        return 0

    JOBS.mkdir(parents=True, exist_ok=True)
    jobs = eligible_jobs(JOBS)
    print(f"VERSION={VERSION} ELIGIBLE_JOBS={len(jobs)}")
    for job_dir in jobs:
        try:
            result = process_job(job_dir)
            print(f"JOB={job_dir.name} STATE={result.get('state')}")
        except Exception as exc:
            print(
                f"JOB={job_dir.name} STATE=RETRYABLE_FAIL "
                f"ERROR={type(exc).__name__}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
