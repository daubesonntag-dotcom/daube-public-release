import json, os, re, tempfile
from datetime import datetime, timezone
from pathlib import Path

SECRET_KEY = re.compile(r'(token|secret|password|passwd|cookie|authorization|api[_-]?key)', re.I)
SECRET_VALUE = re.compile(r'(?i)(bearer\s+[A-Za-z0-9._=-]{12,}|(?:gh[pousr]_|cf[a-z]{0,4}_)[A-Za-z0-9_-]{12,}|[A-Za-z0-9_-]{32,})')


def now():
    return datetime.now(timezone.utc).isoformat()


def atomic_json(path: Path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.' + path.name + '.', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(value, f, ensure_ascii=False, indent=2, sort_keys=True)
            f.write('\n')
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)


def load_json(path: Path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except Exception:
        return {} if default is None else default


def scrub(value):
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            out[k] = '[REDACTED]' if SECRET_KEY.search(str(k)) else scrub(v)
        return out
    if isinstance(value, list): return [scrub(v) for v in value]
    if isinstance(value, str): return SECRET_VALUE.sub('[REDACTED]', value)
    return value
