SECRET_TERMS = (
    ".env", "token", "secret", "credential", "private_key", "id_rsa", "id_ed25519", ".pem"
)


def review(contract: dict, acceptance_matrix: dict, artifacts: list, qa_report: dict):
    findings = []
    for artifact in artifacts or []:
        path = (artifact.get("path") or "").lower()
        if any(term in path for term in SECRET_TERMS):
            findings.append({"code": "SECRET_ARTIFACT", "path": artifact.get("path")})

    criteria = acceptance_matrix.get("criteria") or []
    expected = len(contract.get("acceptance_criteria") or [])
    if len(criteria) != expected:
        findings.append({"code": "ACCEPTANCE_TRACEABILITY_INCOMPLETE"})
    if any(row.get("status") not in {"PASS", "SATISFIED"} for row in criteria):
        findings.append({"code": "ACCEPTANCE_CRITERION_UNSATISFIED"})
    if not qa_report.get("green"):
        findings.append({"code": "QA_NOT_GREEN"})

    return {
        "classification": "PASS" if not findings else "RETRYABLE_FAIL",
        "findings": findings,
        "checked_scope": contract.get("locked_scope", ""),
    }
