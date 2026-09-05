from collections import deque


class GraphError(RuntimeError):
    pass


FRONTEND_TERMS = (
    "frontend", "react", "next.js", "nextjs", "dashboard", "website",
    "responsive", "ui", "ux", "css", "tailwind", "browser",
)
RESEARCH_TERMS = (
    "api documentation", "sdk", "compatibility", "docs", "documentation",
    "rag", "knowledge base", "external api",
)
INTEGRATION_TERMS = (
    "webhook", "api integration", "n8n", "make.com", "make automation",
    "zapier", "oauth", "external interface",
)


def _contains(scope: str, terms):
    value = scope.lower()
    return any(term in value for term in terms)


def _node(node_id, executor_class, depends_on, required=True, max_attempts=3):
    return {
        "id": node_id,
        "executor_class": executor_class,
        "required": required,
        "depends_on": list(depends_on),
        "inputs": ["JOB_CONTRACT.json", "ACCEPTANCE_MATRIX.json"],
        "outputs": [],
        "max_attempts": max_attempts,
        "evidence_required": ["node-receipt.json"],
        "status": "PENDING",
    }


def build_graph(contract: dict) -> dict:
    scope = contract.get("locked_scope", "")
    nodes = [_node("planner-1", "planner", [])]
    previous = "planner-1"

    if _contains(scope, RESEARCH_TERMS):
        nodes.append(_node("research-1", "research", [previous], max_attempts=2))
        previous = "research-1"

    nodes.append(_node("implementation-1", "implementation", [previous], max_attempts=3))
    previous = "implementation-1"

    if _contains(scope, INTEGRATION_TERMS):
        nodes.append(_node(
            "integration-validator-1", "integration_validator", [previous], max_attempts=2
        ))
        previous = "integration-validator-1"

    nodes.append(_node("qa-1", "qa", [previous], max_attempts=3))
    previous = "qa-1"

    if _contains(scope, FRONTEND_TERMS):
        nodes.append(_node("ux-visual-1", "ux_visual", [previous], max_attempts=2))
        previous = "ux-visual-1"

    nodes.append(_node("red-team-1", "red_team", [previous], max_attempts=2))
    nodes.append(_node("worth-money-1", "worth_money", ["red-team-1"], max_attempts=1))
    nodes.append(_node("delivery-1", "delivery", ["worth-money-1"], max_attempts=1))

    result = {"version": "v9-daube-execution-mesh", "nodes": nodes}
    topological_order(result)
    return result


def topological_order(graph: dict):
    nodes = graph.get("nodes") or []
    by_id = {node["id"]: node for node in nodes}
    indegree = {node_id: 0 for node_id in by_id}
    outgoing = {node_id: [] for node_id in by_id}

    for node_id, node in by_id.items():
        for dependency in node.get("depends_on", []):
            if dependency not in by_id:
                raise GraphError(f"MISSING_DEPENDENCY:{dependency}")
            indegree[node_id] += 1
            outgoing[dependency].append(node_id)

    queue = deque(sorted(node_id for node_id, degree in indegree.items() if degree == 0))
    order = []
    while queue:
        current = queue.popleft()
        order.append(current)
        for following in sorted(outgoing[current]):
            indegree[following] -= 1
            if indegree[following] == 0:
                queue.append(following)

    if len(order) != len(nodes):
        raise GraphError("CYCLE")
    return order
