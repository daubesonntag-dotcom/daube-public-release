#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const REQUEST_PATH = process.argv[2] || 'farm/provider-actuator/request.json';
const RECEIPT_PATH = process.argv[3] || 'farm/provider-actuator/latest-receipt.json';
const OUT_PATH = process.argv[4] || '/tmp/provider-actuator-plan.json';
const ECOLOGY_PATH = process.argv[5] || null;
const EVOLUTION_PATH = process.argv[6] || null;
const UNIT = 250_000;

const request = JSON.parse(fs.readFileSync(REQUEST_PATH, 'utf8'));
if (request.schema !== 'daube.resource-farm-provider-actuator-request.v1') fail('request_schema_invalid');
if (request.paidSpendAuthorized !== false) fail('paid_spend_forbidden');
if (request.privateAssetsUsed !== false) fail('private_assets_forbidden');
if (request.mode !== 'zero-spend-cross-provider') fail('mode_invalid');
if (!/^[a-z0-9-]{8,80}$/.test(String(request.requestId || ''))) fail('request_id_invalid');

if (!ECOLOGY_PATH || !fs.existsSync(ECOLOGY_PATH)) fail('ecology_gate_required');
let ecology = null;
try { ecology = JSON.parse(fs.readFileSync(ECOLOGY_PATH, 'utf8')); } catch { fail('ecology_gate_invalid_json'); }
const ecologySystems = Array.isArray(ecology?.systems) ? ecology.systems : [];
const ecologyGreen = Boolean(
  ecology?.schema === 'daube.resource-farm-ecology-runtime.v1' &&
  ecology?.status === 'GREEN' &&
  Number(ecology?.score) >= 95 &&
  ecology?.control?.actuatorAdmitted === true &&
  ecology?.guardrails?.paidSpendAuthorized === false &&
  ecology?.guardrails?.automaticPrivilegeExpansion === false &&
  ecology?.guardrails?.newOAuthRequired === false &&
  ecologySystems.length === 10 &&
  ecologySystems.every((system) => system?.status === 'GREEN' && Number(system?.score) >= 95)
);
if (!ecologyGreen) fail('ecology_gate_blocked');

if (!EVOLUTION_PATH || !fs.existsSync(EVOLUTION_PATH)) fail('evolution_gate_required');
let evolution = null;
try { evolution = JSON.parse(fs.readFileSync(EVOLUTION_PATH, 'utf8')); } catch { fail('evolution_gate_invalid_json'); }
const evolutionSystems = Array.isArray(evolution?.systems) ? evolution.systems : [];
const evolutionGreen = Boolean(
  evolution?.schema === 'daube.resource-farm-evolution-runtime.v1' &&
  evolution?.status === 'GREEN' &&
  Number(evolution?.score) >= 95 &&
  evolution?.minimumGreenScore === 95 &&
  evolution?.control?.actuatorAdmitted === true &&
  evolution?.control?.evolutionGateRequiredForDispatch === true &&
  evolution?.details?.constitution?.dispatchAllowed === true &&
  evolution?.guardrails?.paidSpendAuthorized === false &&
  evolution?.guardrails?.automaticPrivilegeExpansion === false &&
  evolution?.guardrails?.newOAuthRequired === false &&
  evolutionSystems.length === 10 &&
  evolutionSystems.every((system) => system?.status === 'GREEN' && Number(system?.score) >= 95)
);
if (!evolutionGreen) fail('evolution_gate_blocked');

const requestedBacklog = bounded(request.backlogWorkUnits, UNIT, UNIT * 12, UNIT);
const ecologyRecommended = bounded(ecology?.control?.recommendedWorkUnits, UNIT, UNIT * 12, requestedBacklog);
const evolutionRecommended = bounded(evolution?.control?.recommendedWorkUnits, UNIT, UNIT * 12, requestedBacklog);
const backlog = Math.min(requestedBacklog, ecologyRecommended, evolutionRecommended);
const minGitHub = bounded(request.minGitHubReplicas, 1, 8, 2);
const maxGitHub = bounded(request.maxGitHubReplicas, minGitHub, 8, 8);
const maxSupabase = bounded(request.maxSupabaseReplicas, 1, 4, 4);
const requiredFamilies = bounded(request.requireProviderFamilies, 2, 2, 2);
const requiredUnits = Math.ceil(backlog / UNIT);

let previous = null;
if (fs.existsSync(RECEIPT_PATH)) {
  try { previous = JSON.parse(fs.readFileSync(RECEIPT_PATH, 'utf8')); } catch { previous = null; }
}
const previousHealthy = Boolean(
  previous &&
  previous.schema === 'daube.resource-farm-provider-actuator-receipt.v1' &&
  previous.status === 'ADMITTED' &&
  previous.providerFamilyCount >= 2 &&
  previous.paidSpendAuthorized === false &&
  previous.privateAssetsUsed === false
);

let githubReplicas = clamp(Math.ceil(requiredUnits * 0.67), minGitHub, maxGitHub);
let supabaseReplicas = clamp(requiredUnits - githubReplicas, 1, maxSupabase);
if (previous && !previousHealthy) {
  githubReplicas = clamp(githubReplicas + 1, minGitHub, maxGitHub);
  supabaseReplicas = clamp(supabaseReplicas + 1, 1, maxSupabase);
}
while (githubReplicas + supabaseReplicas < requiredUnits && githubReplicas < maxGitHub) githubReplicas += 1;
while (githubReplicas + supabaseReplicas < requiredUnits && supabaseReplicas < maxSupabase) supabaseReplicas += 1;

const capacityUnits = githubReplicas + supabaseReplicas;
const plan = {
  schema: 'daube.resource-farm-provider-actuator-plan.v3',
  requestId: request.requestId,
  mode: request.mode,
  requestedWorkUnits: backlog,
  originalRequestedWorkUnits: requestedBacklog,
  workUnitsPerReplica: UNIT,
  requiredReplicaUnits: requiredUnits,
  providerFamilies: [
    { providerFamily: 'github-public-runner', replicas: githubReplicas },
    { providerFamily: 'supabase-edge', replicas: supabaseReplicas },
  ],
  providerFamilyCount: requiredFamilies,
  githubReplicas,
  supabaseReplicas,
  capacityReplicaUnits: capacityUnits,
  capacityWorkUnits: capacityUnits * UNIT,
  capacityMet: capacityUnits >= requiredUnits,
  ecologyGate: {
    required: true, admitted: true, status: ecology.status, score: Number(ecology.score),
    systemCount: ecologySystems.length, recommendedWorkUnits: ecologyRecommended, observedAt: ecology.observedAt ?? null,
  },
  evolutionGate: {
    required: true, admitted: true, status: evolution.status, score: Number(evolution.score),
    systemCount: evolutionSystems.length, recommendedWorkUnits: evolutionRecommended, observedAt: evolution.observedAt ?? null,
    constitutionDispatchAllowed: evolution.details.constitution.dispatchAllowed === true,
  },
  feedback: {
    previousReceiptSeen: Boolean(previous), previousHealthy,
    previousRequestId: previous?.requestId ?? null,
    previousTotalEvidenceWorkUnits: previous?.totalEvidenceWorkUnits ?? null,
  },
  policy: {
    zeroSpendOnly: true, noPaidSpillover: true, publicInputsOnly: true,
    privateAssetsUsed: false, paidSpendAuthorized: false,
    maxGitHubReplicas: maxGitHub, maxSupabaseReplicas: maxSupabase,
    minimumEcologyScore: 95, ecologyFailClosed: true,
    minimumEvolutionScore: 95, evolutionFailClosed: true,
  },
};

if (!plan.capacityMet) fail('bounded_capacity_unmet');
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(plan, null, 2) + '\n');
process.stdout.write(JSON.stringify(plan) + '\n');

function bounded(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return clamp(Math.trunc(n), min, max);
}
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function fail(code) { console.error(code); process.exit(64); }
