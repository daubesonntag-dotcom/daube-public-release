class PlannerError(RuntimeError):
    pass


VERIFICATION_CLASSES = {
    "qa", "integration_validator", "ux_visual", "red_team", "worth_money"
}


def _criterion_needs_visual(text: str):
    value = text.lower()
    return any(term in value for term in (
        "render", "layout", "responsive", "visual", "ui", "interaction", "browser"
    ))


def _criterion_needs_integration(text: str):
    value = text.lower()
    return any(term in value for term in (
        "webhook", "api", "integration", "n8n", "make.com", "oauth"
    ))


def build_acceptance_matrix(contract: dict, graph: dict) -> dict:
    nodes = graph.get("nodes") or []
    classes = {}
    for node in nodes:
        classes.setdefault(node["executor_class"], []).append(node["id"])

    rows = []
    for index, criterion in enumerate(contract.get("acceptance_criteria") or [], start=1):
        candidates = []
        if _criterion_needs_integration(criterion):
            candidates += classes.get("integration_validator", [])
        if _criterion_needs_visual(criterion):
            candidates += classes.get("ux_visual", [])
        candidates += classes.get("qa", [])
        candidates += classes.get("red_team", [])
        candidates += classes.get("worth_money", [])

        seen = set()
        verification = [
            node_id for node_id in candidates
            if not (node_id in seen or seen.add(node_id))
        ]
        if not verification:
            raise PlannerError("UNMAPPED_ACCEPTANCE_CRITERION")

        rows.append({
            "criterion_id": f"AC-{index:03d}",
            "criterion": criterion,
            "execution_nodes": classes.get("implementation", []),
            "verification_nodes": verification,
            "status": "PENDING",
        })

    if not rows:
        raise PlannerError("UNMAPPED_ACCEPTANCE_CRITERION")
    return {"version": "v9-daube-execution-mesh", "criteria": rows}
