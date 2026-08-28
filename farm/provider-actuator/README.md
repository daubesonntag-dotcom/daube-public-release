# D’AUBE Resource Farm — Provider Actuator V1

Status: **evidence-gated, zero-spend execution actuator**.

This lane closes a specific blocker without pretending D’AUBE can create arbitrary cloud infrastructure without provider authority.

## What it actuates

The controller converts a bounded public workload request into real execution across two already-admitted provider families:

1. `github-public-runner` — dynamic GitHub Actions matrix replicas.
2. `supabase-edge` — bounded calls to the public deterministic Resource Farm Edge canary.

Flow:

`request -> planner -> dynamic provider allocation -> GitHub execution + Supabase Edge execution -> harvest -> immutable artifact + latest receipt -> next planner feedback`

The next planning cycle reads `latest-receipt.json`. A healthy prior cycle permits demand-driven downscale; an unhealthy prior cycle adds bounded safety capacity. This is the closed feedback path.

## Hard policy gates

- `paidSpendAuthorized` must be `false`.
- `privateAssetsUsed` must be `false`.
- No OAuth or provider credential is required by this lane.
- No paid spillover is allowed.
- GitHub replicas are capped at 8.
- Supabase Edge replicas are capped at 4.
- At least two provider families must be evidenced.
- Provider receipts must report success and zero paid/private usage.
- Capacity must cover the requested bounded work before admission.

## Truth boundary

`providerExecutionDispatchClosedLoopProven=true` means D’AUBE has proven automatic planning, bounded allocation, execution, verification, and feedback across admitted execution providers.

It **does not** mean D’AUBE can create, resize, or destroy arbitrary third-party VMs, accounts, billing resources, GPUs, or VPS instances. That separate property is reported as `providerCapacityProvisioningClosedLoopProven=false` until a real policy-authorized provider provisioning actuator exists.

## Request schema

See `request.json`. The workflow is triggered by an audited push of that file. This avoids a new OAuth connection and preserves a Git commit trail for every requested actuation generation.
