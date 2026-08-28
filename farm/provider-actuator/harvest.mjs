#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const evidenceDir = process.argv[2] || '/tmp/evidence';
const output = process.argv[3] || '/tmp/provider-actuator-receipt.json';
const expectedGitHub = Number(process.argv[4]);
const expectedSupabase = Number(process.argv[5]);
const requested = Number(process.argv[6]);

if (!Number.isInteger(expectedGitHub) || expectedGitHub < 1 || expectedGitHub > 8) fail('expected_github_invalid');
if (!Number.isInteger(expectedSupabase) || expectedSupabase < 1 || expectedSupabase > 4) fail('expected_supabase_invalid');
if (!Number.isInteger(requested) || requested < 250_000) fail('requested_work_invalid');

const plan = readJson(path.join(evidenceDir, 'plan.json'));
const ecology = readJson(path.join(evidenceDir, 'ecology.json'));
const evolution = readJson(path.join(evidenceDir, 'evolution.json'));
const github = fs.readdirSync(evidenceDir)
  .filter((name) => /^github-\d+\.json$/.test(name))
  .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0))
  .map((name) => readJson(path.join(evidenceDir, name)));
const supabase = readJson(path.join(evidenceDir, 'supabase-bundle.json'));

if (github.length !== expectedGitHub) fail('github_replica_count_mismatch');
if (!Array.isArray(supabase) || supabase.length !== expectedSupabase) fail('supabase_replica_count_mismatch');
if (!github.every((r) => r.providerFamily === 'github-public-runner' && r.success === true)) fail('github_receipt_invalid');
if (!supabase.every((r) => r.providerFamily === 'supabase-edge' && r.success === true)) fail('supabase_receipt_invalid');

const all = [...github, ...supabase];
if (!all.every((r) => r.paidSpendAuthorized === false)) fail('paid_spend_forbidden');
if (!all.every((r) => r.privateAssetsUsed === false)) fail('private_assets_forbidden');

const ecologySystems = Array.isArray(ecology?.systems) ? ecology.systems : [];
const ecologyAdmitted = Boolean(
  plan?.ecologyGate?.admitted === true &&
  ecology?.schema === 'daube.resource-farm-ecology-runtime.v1' &&
  ecology?.status === 'GREEN' && Number(ecology?.score) >= 95 &&
  ecology?.control?.actuatorAdmitted === true &&
  ecology?.guardrails?.paidSpendAuthorized === false &&
  ecology?.guardrails?.automaticPrivilegeExpansion === false &&
  ecology?.guardrails?.newOAuthRequired === false &&
  ecologySystems.length === 10 &&
  ecologySystems.every((system) => system?.status === 'GREEN' && Number(system?.score) >= 95)
);
if (!ecologyAdmitted) fail('ecology_admission_missing_or_blocked');

const evolutionSystems = Array.isArray(evolution?.systems) ? evolution.systems : [];
const evolutionAdmitted = Boolean(
  plan?.evolutionGate?.admitted === true &&
  evolution?.schema === 'daube.resource-farm-evolution-runtime.v1' &&
  evolution?.status === 'GREEN' && Number(evolution?.score) >= 95 &&
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
if (!evolutionAdmitted) fail('evolution_admission_missing_or_blocked');

const total = all.reduce((sum, r) => sum + Number(r.workUnits || 0), 0);
const families = [...new Set(all.map((r) => r.providerFamily))].sort();
const admitted = ecologyAdmitted && evolutionAdmitted && families.length === 2 && total >= requested;
const feedbackSeen = Boolean(plan?.feedback?.previousReceiptSeen);

const receipt = {
  schema: 'daube.resource-farm-provider-actuator-receipt.v2',
  status: admitted ? 'ADMITTED' : 'REJECTED',
  requestId: plan.requestId,
  requestedWorkUnits: requested,
  totalEvidenceWorkUnits: total,
  providerFamilies: families,
  providerFamilyCount: families.length,
  actualReplicas: {
    'github-public-runner': github.length,
    'supabase-edge': supabase.length,
  },
  plan: {
    githubReplicas: plan.githubReplicas,
    supabaseReplicas: plan.supabaseReplicas,
    capacityWorkUnits: plan.capacityWorkUnits,
  },
  ecologyAdmission: {
    enforced: true, admitted: ecologyAdmitted, status: ecology.status, score: Number(ecology.score), minimumScore: 95,
    systemCount: ecologySystems.length,
    allSystemsGreen: ecologySystems.every((system) => system?.status === 'GREEN' && Number(system?.score) >= 95),
    paidSpendAuthorized: ecology.guardrails.paidSpendAuthorized,
    automaticPrivilegeExpansion: ecology.guardrails.automaticPrivilegeExpansion,
    newOAuthRequired: ecology.guardrails.newOAuthRequired,
    observedAt: ecology.observedAt ?? null,
  },
  evolutionAdmission: {
    enforced: true, admitted: evolutionAdmitted, status: evolution.status, score: Number(evolution.score), minimumScore: 95,
    systemCount: evolutionSystems.length,
    allSystemsGreen: evolutionSystems.every((system) => system?.status === 'GREEN' && Number(system?.score) >= 95),
    constitutionDispatchAllowed: evolution.details.constitution.dispatchAllowed === true,
    paidSpendAuthorized: evolution.guardrails.paidSpendAuthorized,
    automaticPrivilegeExpansion: evolution.guardrails.automaticPrivilegeExpansion,
    newOAuthRequired: evolution.guardrails.newOAuthRequired,
    observedAt: evolution.observedAt ?? null,
  },
  feedback: plan.feedback ?? {},
  feedbackClosedLoopObserved: admitted && feedbackSeen,
  providerExecutionDispatchClosedLoopProven: admitted && feedbackSeen,
  crossProviderExecutionActuationProven: admitted,
  providerCapacityProvisioningClosedLoopProven: false,
  paidSpendAuthorized: false,
  privateAssetsUsed: false,
  truthBoundary: 'Execution dispatch is proven across admitted ephemeral providers and requires both Ecology GREEN >=95 and Evolution GREEN >=95. Arbitrary third-party VM/GPU/VPS account or capacity provisioning, physical readiness and real revenue are not claimed.',
  observedAt: new Date().toISOString(),
};

if (!admitted) fail('harvest_not_admitted');
fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function fail(code) { console.error(code); process.exit(65); }
