# D’AUBE Execution Mesh V9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace V8’s single-runtime execution path with a D’AUBE-led, evidence-gated execution mesh that plans, implements, verifies, red-teams, and packages bounded client work before delivery readiness.

**Architecture:** Add a V9 controller beside V8. The controller derives an immutable job contract and DAG from authoritative V7/V8 evidence, dispatches only necessary lanes through provider-neutral adapters, independently verifies outputs, runs red-team and Worth-the-Money gates, and emits delivery artifacts only when every mandatory criterion is evidenced. V8 remains the rollback target until V9 host verification passes.

**Tech Stack:** Python 3.12 standard library, Codex CLI as the initial implementation adapter, existing Freelancer control-plane files, systemd service/timer, shell installer, `unittest`, existing browser/CLI tools only when locally available and zero-cost.

**Spec:** `docs/superpowers/specs/2026-09-05-daube-execution-mesh-v9-design.md`

## Global Constraints
- D’AUBE is the lead executor; Codex is one implementation provider inside the mesh.
- No Founder spend, Connects purchases, boosts, subscriptions, paid compute, or paid API fallback.
- Standard automatic engagements remain bounded to <=72 hours and one bounded revision cycle.
- No payout, bank, tax, identity, KYC, credential-setting, or off-platform payment changes.
- No executor may communicate with the marketplace, accept contracts, request money, or mark revenue.
- Marketplace delivery and milestone actions remain owned by the separate Money Closure controller.
- No delivery claim without authoritative acceptance evidence, real artifacts, acceptance-criteria traceability, green mandatory QA, red-team pass, and Worth-the-Money pass.
- Missing material client input, ambiguous scope, required spend, repeated technical failure, or regulated/nonstandard requirements fail closed.
- Existing V8 workspaces remain readable; V9 installation must support verified rollback to V8.
- Revenue remains settlement-only and must never be inferred from bids, awards, invoices, milestones, or delivery.

---

## File Structure

The V9 installer will create the following focused host files under `~/daube-revenue-worker/full-loop/v9/` rather than growing one monolithic executor:

- `models.py` — state constants, typed dictionary validation helpers, atomic JSON/event helpers.
- `contract.py` — authoritative input validation and `JOB_CONTRACT.json` generation.
- `graph.py` — execution DAG generation, dependency ordering, lane eligibility, retry accounting.
- `adapters.py` — provider-neutral adapter contract and initial Codex implementation adapter.
- `planner.py` — acceptance-criteria matrix and lane task materialization.
- `qa.py` — deterministic command discovery, QA receipts, artifact inventory, secret exclusions.
- `visual.py` — conditional frontend/browser evidence adapter; fail-closed classification when required evidence cannot be produced.
- `red_team.py` — scope-drift, evidence, secret-leak, regression, and bounded security review.
- `worth_money.py` — evidence-backed five-question Worth-the-Money decision.
- `delivery.py` — manifest, hashes, traceability report, handoff, and client-facing delivery draft only.
- `controller.py` — per-job state machine, lane dispatch, repair loops, locks, and final transition control.
- `test_v9.py` — deterministic offline unit/integration tests using fake adapters and fixtures.
- `run.sh` — narrow V9 entrypoint.

Repository file:
- `installers/install-freelancer-execution-mesh-v9.sh` — writes the modules above, runs tests before activation, installs systemd, switches V8→V9 only after verification, and provides rollback.

---

### Task 1: V9 models, state machine primitives, and authoritative contract

**Files:**
- Create: `installers/install-freelancer-execution-mesh-v9.sh`
- Generated: `full-loop/v9/models.py`
- Generated: `full-loop/v9/contract.py`
- Generated test: `full-loop/v9/test_v9.py`

**Interfaces:**
- Consumes: `jobs/<project_id>/EXECUTOR_JOB.json`, `job.json`, `SCOPE.md`.
- Produces: `JOB_CONTRACT.json`, `v9-state.json`, `events/events.jsonl`.
- `build_job_contract(job_dir: Path) -> dict`
- `validate_contract(contract: dict) -> tuple[bool, str]`
- `transition(job_dir: Path, state: str, *, reason: str|None=None, evidence: list[str]|None=None) -> dict`

- [ ] **Step 1: Write failing tests for authoritative input and <=72h enforcement**

```python
def test_contract_requires_authoritative_acceptance(tmp_path):
    make_v8_job(tmp_path, status="PENDING", guard="STANDARD_AUTHORITY_PASS", hours=24)
    with self.assertRaises(contract.ContractError):
        contract.build_job_contract(tmp_path)


def test_contract_rejects_over_72_hours(tmp_path):
    make_v8_job(tmp_path, status="AWARDED_ACCEPTED", guard="STANDARD_AUTHORITY_PASS", hours=73)
    with self.assertRaises(contract.ContractError):
        contract.build_job_contract(tmp_path)
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:
```bash
PYTHONPATH="$HOME/daube-revenue-worker/full-loop/v9" python3 -m unittest -v test_v9.ContractTests
```
Expected: import/function failures because V9 modules do not exist yet.

- [ ] **Step 3: Implement atomic JSON/event helpers and contract generation**

`JOB_CONTRACT.json` must include exactly these top-level keys:

```python
{
    "version": "v9-daube-execution-mesh",
    "project_id": int,
    "title": str,
    "locked_scope": str,
    "acceptance_criteria": list[str],
    "estimated_hours": int,
    "client_inputs": list[dict],
    "allowed_operations": list[str],
    "forbidden_operations": list[str],
    "required_artifacts": list[str],
    "mandatory_gates": list[str],
    "revision_allowance": 1,
    "authority_evidence": {
        "status": "AWARDED_ACCEPTED",
        "acceptance_guard": "STANDARD_AUTHORITY_PASS"
    }
}
```

If explicit acceptance criteria are absent from authoritative inputs, generate only mechanically inferable criteria from locked scope statements that are objectively testable; otherwise transition to `WAITING_FOR_INPUT` with `AMBIGUOUS_ACCEPTANCE_CRITERIA`. Do not invent product behavior.

- [ ] **Step 4: Run ContractTests and verify GREEN**

Run the command from Step 2. Expected: all ContractTests PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add installers/install-freelancer-execution-mesh-v9.sh
git commit -m "feat: add v9 job contract and state primitives"
```

---

### Task 2: Execution graph generation and acceptance-criteria traceability

**Files:**
- Modify: `installers/install-freelancer-execution-mesh-v9.sh`
- Generated: `full-loop/v9/graph.py`
- Generated: `full-loop/v9/planner.py`
- Generated test: `full-loop/v9/test_v9.py`

**Interfaces:**
- Consumes: `JOB_CONTRACT.json`.
- Produces: `EXECUTION_GRAPH.json`, `ACCEPTANCE_MATRIX.json`, `lane-input/<node_id>.json`.
- `build_graph(contract: dict) -> dict`
- `topological_order(graph: dict) -> list[str]`
- `build_acceptance_matrix(contract: dict, graph: dict) -> dict`

- [ ] **Step 1: Add failing tests for conditional lanes and complete criterion mapping**

```python
def test_frontend_scope_includes_visual_lane(self):
    c = fixture_contract(scope="Build a responsive Next.js dashboard with filters")
    g = graph.build_graph(c)
    self.assertIn("ux_visual", {n["executor_class"] for n in g["nodes"]})


def test_backend_scope_omits_visual_lane(self):
    c = fixture_contract(scope="Fix FastAPI webhook signature verification")
    g = graph.build_graph(c)
    self.assertNotIn("ux_visual", {n["executor_class"] for n in g["nodes"]})


def test_every_acceptance_criterion_maps_to_verification(self):
    c = fixture_contract(criteria=["Dashboard builds", "Filter updates results"])
    g = graph.build_graph(c)
    m = planner.build_acceptance_matrix(c, g)
    self.assertTrue(all(row["verification_nodes"] for row in m["criteria"]))
```

- [ ] **Step 2: Run GraphPlannerTests and verify RED**

```bash
PYTHONPATH="$V9" python3 -m unittest -v test_v9.GraphPlannerTests
```

- [ ] **Step 3: Implement deterministic DAG construction**

Every node must use this schema:

```python
{
    "id": "implementation-1",
    "executor_class": "implementation",
    "required": True,
    "depends_on": ["planner-1"],
    "inputs": ["JOB_CONTRACT.json", "ACCEPTANCE_MATRIX.json"],
    "outputs": ["work/"],
    "max_attempts": 3,
    "evidence_required": ["node-receipt.json"],
    "status": "PENDING"
}
```

Base DAG: `planner -> research? -> implementation -> integration_validator? -> qa -> ux_visual? -> red_team -> worth_money -> delivery`. Include optional lanes only when the locked scope requires them.

- [ ] **Step 4: Implement cycle detection and unmapped-criterion fail-closed behavior**

`topological_order()` must raise `GraphError("CYCLE")` for cycles. `build_acceptance_matrix()` must raise `GraphError("UNMAPPED_ACCEPTANCE_CRITERION")` when any criterion has no verification node.

- [ ] **Step 5: Run GraphPlannerTests and verify GREEN**

- [ ] **Step 6: Commit Task 2**

```bash
git add installers/install-freelancer-execution-mesh-v9.sh
git commit -m "feat: add v9 execution graph and traceability planner"
```

---

### Task 3: Provider-neutral executor fabric and D’AUBE lane receipts

**Files:**
- Modify: `installers/install-freelancer-execution-mesh-v9.sh`
- Generated: `full-loop/v9/adapters.py`
- Generated test: `full-loop/v9/test_v9.py`

**Interfaces:**
- `Adapter.detect() -> dict|None`
- `Adapter.execute(task: dict, workspace: Path, constraints: dict) -> dict`
- `Adapter.collect_evidence(result: dict, workspace: Path) -> dict`
- `Adapter.classify_result(result: dict) -> str`
- Initial adapter: `CodexAdapter` for `implementation` lanes only.

- [ ] **Step 1: Add failing adapter tests**

```python
def test_codex_adapter_never_receives_marketplace_authority(self):
    task = {"id":"implementation-1", "scope":"Fix component"}
    cmd = adapters.CodexAdapter("/usr/bin/codex").build_command(task, Path("/tmp/job/work"), {})
    joined = " ".join(cmd)
    self.assertNotIn("Freelancer", joined)
    self.assertNotIn("milestone", joined.lower())


def test_missing_runtime_fails_closed(self):
    self.assertIsNone(adapters.select_adapter("implementation", which=lambda _: None))
```

- [ ] **Step 2: Run AdapterTests and verify RED**

- [ ] **Step 3: Implement the adapter contract and Codex adapter**

Codex invocation must remain bounded to the per-job workspace, use the existing authenticated CLI only, set no API key, install nothing, purchase nothing, and return a receipt with:

```python
{
    "runtime": "codex",
    "node_id": str,
    "started_at": str,
    "finished_at": str,
    "returncode": int,
    "classification": "PASS|RETRYABLE_FAIL|WAITING_FOR_INPUT|HOLD_FOUNDER_GATE",
    "stdout_excerpt": str,
    "stderr_excerpt": str
}
```

- [ ] **Step 4: Implement D’AUBE-native non-model lanes as Python executors**

Planner, QA, red-team, Worth-the-Money, and delivery composition are D’AUBE-native deterministic executors and must not be delegated to Codex by default. Research and visual lanes may use locally available zero-cost tools, but absence of a required tool must classify explicitly instead of silently passing.

- [ ] **Step 5: Run AdapterTests and verify GREEN**

- [ ] **Step 6: Commit Task 3**

```bash
git add installers/install-freelancer-execution-mesh-v9.sh
git commit -m "feat: add provider-neutral v9 executor fabric"
```

---

### Task 4: Deterministic QA, integration validation, and artifact integrity

**Files:**
- Modify: `installers/install-freelancer-execution-mesh-v9.sh`
- Generated: `full-loop/v9/qa.py`
- Generated test: `full-loop/v9/test_v9.py`

**Interfaces:**
- `discover_checks(workspace: Path, contract: dict) -> list[list[str]]`
- `run_checks(workspace: Path, commands: list[list[str]]) -> dict`
- `inventory_artifacts(workspace: Path) -> list[dict]`
- Produces: `evidence/qa-report.json`, `evidence/artifacts.json`.

- [ ] **Step 1: Add failing tests for real command evidence and secret exclusion**

```python
def test_qa_requires_at_least_one_applicable_command_and_artifact(self):
    report = qa.evaluate([], [])
    self.assertFalse(report["green"])


def test_artifact_inventory_excludes_secrets(tmp_path):
    (tmp_path/"app.py").write_text("print('ok')")
    (tmp_path/".env").write_text("SECRET=x")
    paths = [x["path"] for x in qa.inventory_artifacts(tmp_path)]
    self.assertIn("app.py", paths)
    self.assertNotIn(".env", paths)
```

- [ ] **Step 2: Run QATests and verify RED**

- [ ] **Step 3: Implement stack-aware check discovery**

For Node projects, inspect `package.json` and run only scripts that exist among `test`, `lint`, `typecheck`, `build`. For Python projects, use `python3 -m pytest -q` only when tests/config are present. For integration scopes, add deterministic local checks only when test endpoints/fixtures are available; never call destructive production endpoints.

- [ ] **Step 4: Implement evidence receipts and artifact hashing**

Every executed command records `command`, `cwd`, `started_at`, `finished_at`, `exit_code`, `stdout_excerpt`, and `stderr_excerpt`. Artifact inventory records relative path, bytes, and SHA-256 while excluding `.env`, token/secret/credential/private-key patterns, `.pem`, SSH keys, caches, and dependency trees.

- [ ] **Step 5: Run QATests and verify GREEN**

- [ ] **Step 6: Commit Task 4**

```bash
git add installers/install-freelancer-execution-mesh-v9.sh
git commit -m "feat: add deterministic v9 qa and artifact evidence"
```

---

### Task 5: Conditional UX/visual inspection and browser evidence

**Files:**
- Modify: `installers/install-freelancer-execution-mesh-v9.sh`
- Generated: `full-loop/v9/visual.py`
- Generated test: `full-loop/v9/test_v9.py`

**Interfaces:**
- `requires_visual_lane(contract: dict) -> bool`
- `inspect_visual(workspace: Path, contract: dict, tools: dict) -> dict`
- Produces: `evidence/visual-report.json` plus screenshot paths only when a local browser-capable tool is available.

- [ ] **Step 1: Add failing visual policy tests**

```python
def test_frontend_requires_visual_evidence(self):
    self.assertTrue(visual.requires_visual_lane(fixture_contract(scope="Responsive React dashboard")))


def test_required_visual_without_tool_does_not_pass(self):
    r = visual.inspect_visual(Path("/tmp/x"), fixture_contract(scope="Responsive React dashboard"), tools={})
    self.assertEqual(r["classification"], "RETRYABLE_FAIL")
```

- [ ] **Step 2: Run VisualTests and verify RED**

- [ ] **Step 3: Implement conditional browser evidence**

When a locally available zero-cost browser runner exists, capture: render success, console/runtime errors, at least one primary interaction path from the acceptance matrix, responsive sanity at desktop/mobile widths, and basic accessibility failures if the tool exposes them. When no browser runner exists for a mandatory visual lane, return `RETRYABLE_FAIL` rather than green.

- [ ] **Step 4: Ensure visual evidence cannot replace code QA**

Add a test proving `visual-report.json: PASS` does not make a job delivery-ready when `qa-report.json` is red.

- [ ] **Step 5: Run VisualTests and verify GREEN**

- [ ] **Step 6: Commit Task 5**

```bash
git add installers/install-freelancer-execution-mesh-v9.sh
git commit -m "feat: add conditional v9 visual inspection"
```

---

### Task 6: Red-Team reviewer and bounded repair routing

**Files:**
- Modify: `installers/install-freelancer-execution-mesh-v9.sh`
- Generated: `full-loop/v9/red_team.py`
- Generated: `full-loop/v9/controller.py`
- Generated test: `full-loop/v9/test_v9.py`

**Interfaces:**
- `review(job_dir: Path, contract: dict, matrix: dict) -> dict`
- `route_failure(node: dict, receipt: dict, attempts: int) -> str`
- Produces: `evidence/red-team-report.json`, repair events, updated node status.

- [ ] **Step 1: Add failing red-team and retry-limit tests**

```python
def test_red_team_vetoes_secret_leak(self):
    report = red_team.review_fixture(files={"config.txt":"api_key=sk-example"})
    self.assertEqual(report["classification"], "FAIL")


def test_implementation_stops_after_two_repairs(self):
    self.assertEqual(controller.route_failure({"executor_class":"implementation"}, {"classification":"RETRYABLE_FAIL"}, 3), "HOLD_FOUNDER_GATE")
```

- [ ] **Step 2: Run RedTeamRetryTests and verify RED**

- [ ] **Step 3: Implement deterministic red-team checks**

Check: acceptance-matrix completeness, scope drift between contract and changed artifact descriptions, secret-pattern leakage, fabricated completion language unsupported by evidence, missing mandatory evidence, obvious unsafe/destructive commands in delivered scripts, and regressions reported by QA/visual/integration receipts.

- [ ] **Step 4: Implement bounded repair loops**

Policy:
- implementation/QA: initial attempt + maximum 2 repair attempts;
- integration/visual: initial attempt + maximum 1 repair attempt;
- any repaired artifact invalidates affected QA/red-team evidence and forces rerun;
- repeated failure, missing input, required spend, or scope ambiguity transitions to `HOLD_FOUNDER_GATE` or `WAITING_FOR_INPUT` as appropriate.

- [ ] **Step 5: Run RedTeamRetryTests and verify GREEN**

- [ ] **Step 6: Commit Task 6**

```bash
git add installers/install-freelancer-execution-mesh-v9.sh
git commit -m "feat: add v9 red team and bounded repair loops"
```

---

### Task 7: Worth-the-Money gate and delivery composer

**Files:**
- Modify: `installers/install-freelancer-execution-mesh-v9.sh`
- Generated: `full-loop/v9/worth_money.py`
- Generated: `full-loop/v9/delivery.py`
- Generated test: `full-loop/v9/test_v9.py`

**Interfaces:**
- `evaluate_worth(job_dir: Path) -> dict`
- `compose_delivery(job_dir: Path, worth_report: dict) -> dict`
- Produces: `WORTH_THE_MONEY.json`, `delivery/manifest.json`, `delivery/TRACEABILITY.md`, `delivery/HANDOFF.md`, `delivery/client-message.txt`.

- [ ] **Step 1: Add failing Worth-the-Money tests**

```python
def test_worth_money_fails_if_any_mandatory_gate_is_red(self):
    report = worth_money.evaluate_fixture(qa="PASS", visual="PASS", red_team="FAIL", criteria="PASS")
    self.assertEqual(report["decision"], "FAIL")


def test_delivery_requires_worth_money_pass(self, tmp_path):
    with self.assertRaises(delivery.DeliveryBlocked):
        delivery.compose_delivery(tmp_path, {"decision":"FAIL"})
```

- [ ] **Step 2: Run WorthMoneyTests and verify RED**

- [ ] **Step 3: Implement the five evidence-backed questions**

`WORTH_THE_MONEY.json` must contain these keys with `PASS|FAIL` and evidence references:

```python
{
  "acceptance_criteria_satisfied": {"result":"PASS", "evidence":[]},
  "artifacts_behave_as_required": {"result":"PASS", "evidence":[]},
  "mandatory_quality_gates_passed": {"result":"PASS", "evidence":[]},
  "important_edge_cases_addressed": {"result":"PASS", "evidence":[]},
  "professional_handoff_supported": {"result":"PASS", "evidence":[]},
  "decision":"PASS"
}
```

No confidence percentage or model self-rating is permitted.

- [ ] **Step 4: Implement delivery composition**

Delivery manifest must hash artifacts and reference QA, visual/integration when required, red-team, Worth-the-Money, and acceptance-matrix evidence. `client-message.txt` may state only verified behavior and disclosed in-scope limitations; it must not claim payment, production deployment, or client acceptance without external evidence.

- [ ] **Step 5: Run WorthMoneyTests and verify GREEN**

- [ ] **Step 6: Commit Task 7**

```bash
git add installers/install-freelancer-execution-mesh-v9.sh
git commit -m "feat: add worth-the-money and v9 delivery evidence"
```

---

### Task 8: Lead Executor orchestration and crash-safe reconstruction

**Files:**
- Modify: `installers/install-freelancer-execution-mesh-v9.sh`
- Generated: `full-loop/v9/controller.py`
- Generated: `full-loop/v9/run.sh`
- Generated test: `full-loop/v9/test_v9.py`

**Interfaces:**
- `process_job(job_dir: Path, adapter_registry: dict) -> dict`
- `resume_job(job_dir: Path, adapter_registry: dict) -> dict`
- Produces full state progression and per-node receipts.

- [ ] **Step 1: Add failing end-to-end offline mesh tests**

```python
def test_bounded_fixture_reaches_delivery_ready(self):
    d = make_fixture("react_api")
    state = controller.process_job(d, fake_green_registry())
    self.assertEqual(state["state"], "DELIVERY_READY")


def test_missing_input_stops_before_execution(self):
    d = make_fixture("requires_client_repo_without_input")
    state = controller.process_job(d, fake_green_registry())
    self.assertEqual(state["state"], "WAITING_FOR_INPUT")


def test_restart_resumes_without_repeating_passed_nodes(self):
    d = make_fixture("react_api")
    controller.process_job(d, fake_interrupt_after_qa_registry())
    state = controller.resume_job(d, fake_green_registry())
    self.assertEqual(state["state"], "DELIVERY_READY")
    self.assertEqual(count_node_attempts(d, "planner-1"), 1)
```

- [ ] **Step 2: Run ControllerIntegrationTests and verify RED**

- [ ] **Step 3: Implement state progression**

Required progression:

```text
READY_FOR_EXECUTOR
-> PLANNING
-> EXECUTING_MESH
-> QA_REVIEW
-> RED_TEAM_REVIEW
-> WORTH_THE_MONEY_REVIEW
-> DELIVERY_READY
```

Permitted fail-closed exits: `WAITING_FOR_INPUT`, `RETRYABLE_FAIL`, `QA_FAILED`, `HOLD_FOUNDER_GATE`.

- [ ] **Step 4: Implement per-job lock and idempotent node receipts**

A node with a valid `PASS` receipt and unchanged input hash must not rerun after restart. Changed inputs invalidate only the node and downstream descendants. State must be reconstructable from `JOB_CONTRACT.json`, `EXECUTION_GRAPH.json`, node receipts, and events.

- [ ] **Step 5: Run ControllerIntegrationTests and verify GREEN**

- [ ] **Step 6: Commit Task 8**

```bash
git add installers/install-freelancer-execution-mesh-v9.sh
git commit -m "feat: orchestrate crash-safe d'aube execution mesh"
```

---

### Task 9: systemd cutover, V8 rollback, and production-safe installer verification

**Files:**
- Modify: `installers/install-freelancer-execution-mesh-v9.sh`

**Interfaces:**
- Produces/updates: `daube-freelancer-executor.service`, existing executor timer unchanged unless required.
- Installer commands: `install`, `verify`, `rollback` modes.

- [ ] **Step 1: Add installer self-test mode before any service change**

The installer must run:

```bash
bash -n installers/install-freelancer-execution-mesh-v9.sh
PYTHONPATH="$V9" python3 -m unittest -v "$V9/test_v9.py"
python3 -m py_compile "$V9"/*.py
```

and abort before systemd modification on any failure.

- [ ] **Step 2: Add an offline smoke fixture with no marketplace/network writes**

The fixture must traverse a bounded job to `DELIVERY_READY` using fake adapters, and separately prove missing input, QA failure, red-team veto, and Worth-the-Money fail cannot reach delivery.

- [ ] **Step 3: Implement atomic service cutover**

Before cutover, save the current V8 service unit text and executable path under `full-loop/v9/rollback/`. Install V9 `run.sh` as `ExecStart` only after all V9 tests pass. Preserve the existing timer cadence and hardening (`NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=strict`, write access limited to D’AUBE worker/job paths).

- [ ] **Step 4: Implement verified rollback**

`rollback` restores the saved V8 service unit, reloads systemd, starts the executor service once, and verifies the V8 version string. V9 evidence files remain intact.

- [ ] **Step 5: Print a non-secret production verification summary**

Required output:

```text
V9_TESTS=PASS
V9_OFFLINE_FIXTURE=DELIVERY_READY
V9_SERVICE=ACTIVE
EXECUTOR_TIMER=ACTIVE
ROLLBACK_V8=VERIFIED
MARKETPLACE_WRITES=NONE
FOUNDER_SPEND=0
```

Do not print tokens, credentials, environment values, or private client content.

- [ ] **Step 6: Commit Task 9**

```bash
git add installers/install-freelancer-execution-mesh-v9.sh
git commit -m "feat: add verified v9 cutover and v8 rollback"
```

---

### Task 10: Branch verification, security review, and PR handoff

**Files:**
- Review: `installers/install-freelancer-execution-mesh-v9.sh`
- Review: generated V9 module/test content embedded by the installer.
- Review: V9 spec and this plan.

- [ ] **Step 1: Run secret and dangerous-action review on the diff**

Search for hard-coded token/key patterns, `curl|wget` installers, package installation, billing/payment commands, Freelancer marketplace write calls, payout/bank/tax/identity operations, and off-platform messaging. Expected: none in V9 executor code.

- [ ] **Step 2: Run full V9 unit/integration suite and shell syntax check**

Expected: all tests PASS and installer shell syntax PASS before opening the PR.

- [ ] **Step 3: Verify spec coverage manually**

Confirm task/test coverage for: contract, DAG, provider neutrality, D’AUBE planner, research boundary, Codex implementation adapter, QA, visual conditional lane, red-team, Worth-the-Money, delivery composer, retry limits, workspace isolation, commercial guards, observability, migration, rollback, and all success criteria.

- [ ] **Step 4: Verify existing business services are untouched by V9 installer**

The installer must not modify revenue-worker, award-watcher, money-closure, watchdog, Remote Commander, Freelancer token, Codex auth, payout, or account settings.

- [ ] **Step 5: Open PR against `main`**

PR body must state Production Truth explicitly: V9 proves offline mesh behavior and host runtime readiness; it must not claim a real awarded client job was executed until authoritative award evidence exists and a real V9 workspace reaches `DELIVERY_READY`.

- [ ] **Step 6: Stop before merge until PR checks/review evidence is read**

Do not force merge. If CI/review is unavailable because of quota or infrastructure, distinguish that from a code failure and retain fail-closed merge policy unless existing repository governance explicitly allows evidence-equivalent verification.
