import importlib.util
from pathlib import Path

p = Path(__file__).parents[1] / "handlers" / "handler.py"
spec = importlib.util.spec_from_file_location("handler", p)
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)


def test_norm_email(): assert h._norm_email(" A@EXAMPLE.COM ") == "a@example.com"
def test_norm_phone(): assert h._norm_phone("+1 (555) 000-0001") == "15550000001"
def test_archive_reason_guard():
    out = h.lead_archive({"base_id":"x","record_id":"r","reason":"bad"}, {})
    assert out["blocked"] == "archive_reason_too_short"
def test_manifest_handlers_exist():
    import json
    manifest = json.loads((Path(__file__).parents[1]/"module.json").read_text())
    for c in manifest["commands"]: assert callable(getattr(h, c["name"], None))
