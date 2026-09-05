import json
from pathlib import Path


TERMS = (
    "api documentation", "sdk", "compatibility", "docs", "documentation",
    "rag", "knowledge base", "external api",
)


def requires_research(contract: dict):
    scope = contract.get("locked_scope", "").lower()
    return any(term in scope for term in TERMS)


def _authority(source: dict):
    kind = (source.get("kind") or "").lower()
    url = (source.get("url") or "").lower()
    if kind in {"official", "authoritative", "client_supplied"}:
        return "AUTHORITATIVE"
    if any(host in url for host in ("docs.", "developer.", "developers.", "api.")):
        return "AUTHORITATIVE"
    return "COMMUNITY"


def collect_research(workspace: Path, contract: dict):
    required = requires_research(contract)
    if not required:
        return {"classification": "PASS", "required": False, "sources": []}

    workspace = Path(workspace)
    candidates = [
        workspace / "research-sources.json",
        workspace / "client-input" / "research-sources.json",
        workspace / "research" / "sources.json",
    ]
    source_file = next((path for path in candidates if path.exists()), None)
    if source_file is None:
        return {
            "classification": "WAITING_FOR_INPUT",
            "required": True,
            "reason": "MISSING_REQUIRED_RESEARCH_SOURCES",
            "sources": [],
        }

    try:
        raw = json.loads(source_file.read_text(encoding="utf-8"))
    except Exception:
        return {
            "classification": "RETRYABLE_FAIL",
            "required": True,
            "reason": "INVALID_RESEARCH_SOURCE_FILE",
            "sources": [],
        }

    sources = raw if isinstance(raw, list) else raw.get("sources", [])
    normalized = []
    for source in sources:
        if not isinstance(source, dict):
            continue
        identity = source.get("url") or source.get("path") or source.get("title")
        if not identity:
            continue
        normalized.append({
            "identity": identity,
            "authority": _authority(source),
            "kind": source.get("kind") or "unspecified",
        })

    if not normalized:
        return {
            "classification": "WAITING_FOR_INPUT",
            "required": True,
            "reason": "NO_USABLE_RESEARCH_SOURCES",
            "sources": [],
        }
    if not any(item["authority"] == "AUTHORITATIVE" for item in normalized):
        return {
            "classification": "WAITING_FOR_INPUT",
            "required": True,
            "reason": "NO_AUTHORITATIVE_RESEARCH_SOURCE",
            "sources": normalized,
        }
    return {"classification": "PASS", "required": True, "sources": normalized}
