QUESTION_KEYS = (
    ("criteria_satisfied", "Is every locked acceptance criterion satisfied?"),
    ("artifacts_work", "Do deliverable artifacts execute/render/behave as required where testable?"),
    ("mandatory_gates_green", "Have applicable mandatory verification gates passed?"),
    ("edge_cases_addressed", "Are important edge cases and failure modes addressed or disclosed?"),
    ("handoff_accurate", "Is the handoff accurate enough for professional paid delivery?"),
)


def evaluate(evidence: dict):
    questions = []
    for key, question in QUESTION_KEYS:
        passed = evidence.get(key) is True
        refs = list((evidence.get("evidence_refs") or {}).get(key) or [])
        questions.append({
            "key": key,
            "question": question,
            "result": "PASS" if passed else "FAIL",
            "evidence": refs,
        })

    overall = all(item["result"] == "PASS" for item in questions)
    return {
        "version": "v9-daube-execution-mesh",
        "pass": overall,
        "classification": "PASS" if overall else "RETRYABLE_FAIL",
        "questions": questions,
    }
