from pathlib import Path


TERMS = (
    "frontend", "react", "next.js", "nextjs", "dashboard", "website",
    "responsive", "ui", "ux", "css", "tailwind", "browser",
)


def requires_visual_lane(contract: dict):
    scope = contract.get("locked_scope", "").lower()
    return any(term in scope for term in TERMS)


def inspect_visual(workspace: Path, contract: dict, tools: dict):
    required = requires_visual_lane(contract)
    if not required:
        return {"classification": "PASS", "required": False, "evidence": []}

    runner = tools.get("browser_evidence")
    if runner is None:
        return {
            "classification": "RETRYABLE_FAIL",
            "required": True,
            "reason": "VISUAL_TOOL_UNAVAILABLE",
            "evidence": [],
        }
    try:
        result = runner(Path(workspace), contract)
    except Exception as exc:
        return {
            "classification": "RETRYABLE_FAIL",
            "required": True,
            "reason": f"VISUAL_TOOL_ERROR:{type(exc).__name__}",
            "evidence": [],
        }
    if not isinstance(result, dict):
        return {
            "classification": "RETRYABLE_FAIL",
            "required": True,
            "reason": "INVALID_VISUAL_EVIDENCE",
            "evidence": [],
        }

    checks = result.get("checks") or {}
    required_checks = (
        "render_success", "interaction_sanity", "responsive_sanity",
        "accessibility_sanity", "console_clean",
    )
    if not all(checks.get(name) is True for name in required_checks):
        return {
            "classification": "RETRYABLE_FAIL",
            "required": True,
            "reason": "VISUAL_CHECK_FAILED",
            "evidence": result.get("evidence") or [],
            "checks": checks,
        }
    return {
        "classification": "PASS",
        "required": True,
        "evidence": result.get("evidence") or [],
        "checks": checks,
    }
