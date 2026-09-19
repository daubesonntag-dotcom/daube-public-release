# D’AUBE — Job-Fit Engineering Evidence

This page maps recurring requirements in current AI automation, integration, platform, DevOps and AI-platform engineering roles to **public D’AUBE-owned evidence**.

It is intentionally evidence-bounded:

- **Implemented / verified** means the public repository contains concrete code, workflow, configuration or verification evidence.
- **Adopted / evaluated** means the technology is selected or benchmarked, but is **not** claimed as production hands-on experience.
- D’AUBE does not present internal work as past client work.

## Current fit map

| Requirement seen in JDs | Status | Public evidence |
|---|---|---|
| API / webhook automation | Implemented / verified | `runtime/revenue-worker/`, `installers/install-freelancer-worker*.sh` |
| OAuth / official API auth | Implemented / verified | `runtime/revenue-worker/freelancer_official.py`, `runtime/revenue-worker/submit_target.py`, `gitlab-setup/` |
| Python automation | Implemented / verified | `worker.py`, `runtime/revenue-worker/`, `farm/` |
| JavaScript / Node automation | Implemented / verified | `farm/provider-actuator/github-worker.mjs`, public web/runtime tooling |
| Linux / systemd operations | Implemented / verified | installer/runtime packages and host-oriented automation in `installers/`, `farm/`, `runtime/` |
| Docker / container operations | Implemented / verified | container/runtime tooling and deployment packages throughout the repository |
| Kubernetes | Implemented / verified | `.github/workflows/cloud-incubator-ephemeral-proof.yml`, `.github/workflows/private-cloud-ephemeral-proof.yml` |
| Kubernetes RBAC / isolation | Implemented / verified | `.github/workflows/private-cloud-ephemeral-proof.yml` validates cross-namespace access boundaries |
| Terraform / IaC | Implemented / verified | `main.tf`, `variables.tf`, `cloud-init.yaml.tftpl`, `farm/oracle-free-host/` |
| CI/CD / GitHub Actions | Implemented / verified | `.github/workflows/`, `windows/performance-autopilot/`, `farm/provider-actuator/` |
| Reliability / retries / fail-closed gates | Implemented / verified | provider/revenue workers, release validation and automation gates |
| QA / evidence / handoff discipline | Implemented / verified | verification workflows, evidence receipts, runbooks and public release documentation |
| AI / LLM workflow integration | Implemented / bounded | AI-related orchestration and provider integration are present; claims remain bounded to D’AUBE-owned systems |
| MCP / tool integration | Implemented / bounded | public MCP/devtool repos and provider/agent bridge work |
| Prometheus | Adopted / not claimed production | `warehouse/RESOURCE_WAREHOUSE_V1.json` |
| OpenTelemetry Collector | Adopted / not claimed production | `warehouse/RESOURCE_WAREHOUSE_V1.json` |
| pgvector | Adopted / not claimed production | `warehouse/RESOURCE_WAREHOUSE_V1.json` |
| LangGraph | Pilot / not claimed production | `warehouse/RESOURCE_WAREHOUSE_V1.json` |
| RAG evaluation (Ragas / DeepEval) | Pilot | `warehouse/RESOURCE_WAREHOUSE_V1.json` |

## What D’AUBE can credibly deliver now

### Fast-cash / 0–3 day scopes

- n8n / Make-style workflow debugging and rescue
- REST API and webhook integrations
- OAuth integration troubleshooting
- HubSpot / Supabase workflow wiring
- Linux service recovery and automation
- CI/CD workflow fixes
- Docker / deployment troubleshooting
- QA evidence, runbooks and handoff documentation
- bounded AI workflow integration with explicit validation and failure handling

### Higher-value engineering scopes

- production-oriented workflow architecture
- multi-system integration with retries, state and idempotency
- provider-neutral execution / automation layers
- browser-control and tool-integration infrastructure
- Linux automation and reliability
- Terraform / IaC packages
- Kubernetes validation, RBAC and ephemeral proof environments
- CI/CD and release verification
- cost / security / permission gates around AI-assisted systems

## Current upgrade lane

The next evidence upgrades are deliberately narrow:

1. **Observability proof** — instrument one bounded service with OpenTelemetry and Prometheus-compatible metrics.
2. **Vector/RAG proof** — build one small PostgreSQL + pgvector retrieval flow with deterministic evaluation fixtures.
3. **Agent orchestration proof** — implement one LangGraph or equivalent stateful workflow with checkpoints and explicit human-review boundaries.
4. **Security proof** — document OAuth/secrets/RBAC threat boundaries and negative test cases.
5. **Recruiter surface** — keep every claim linked to code/evidence and separate implemented vs pilot technology.

## Delivery model

D’AUBE operates async-first. Work is structured as:

`written brief → acceptance criteria → bounded implementation → verification evidence → handoff`

Multiple independent workstreams may run in parallel when dependencies permit. Communication can remain written and artifact-based; live meetings are not required for the technical delivery model.

## Truth boundary

This repository demonstrates D’AUBE-owned engineering work. It does **not** claim:

- fabricated client outcomes,
- invented employment history,
- invented years of experience,
- unverified certifications,
- production use of technologies that are only in the adoption/pilot registry.
