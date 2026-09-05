import json
from pathlib import Path


TERMS = (
    "webhook", "api integration", "n8n", "make.com", "make automation",
    "zapier", "oauth", "external interface",
)


def requires_integration(contract: dict):
    scope = contract.get("locked_scope", "").lower()
    return any(term in scope for term in TERMS)


def validate_integration(workspace: Path, contract: dict):
    if not requires_integration(contract):
        return {"classification": "PASS", "required": False, "evidence": []}

    workspace = Path(workspace)
    fixture_paths = [
        workspace / "integration-fixture.json",
        workspace / "tests" / "integration-fixture.json",
        workspace / "fixtures" / "integration.json",
    ]
    fixtures = [path for path in fixture_paths if path.exists()]
    if not fixtures:
        return {
            "classification": "WAITING_FOR_INPUT",
            "required": True,
            "reason": "MISSING_INTEGRATION_FIXTURE_OR_TEST_ENDPOINT",
            "evidence": [],
        }

    evidence = []
    for path in fixtures:
        try:
            json.loads(path.read_text(encoding="utf-8"))
            evidence.append(str(path.relative_to(workspace)))
        except Exception:
            return {
                "classification": "RETRYABLE_FAIL",
                "required": True,
                "reason": "INVALID_INTEGRATION_FIXTURE",
                "evidence": [str(path.relative_to(workspace))],
            }
    return {"classification": "PASS", "required": True, "evidence": evidence}
