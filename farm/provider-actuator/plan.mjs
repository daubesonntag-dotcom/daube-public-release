#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const REQUEST_PATH = process.argv[2] || 'farm/provider-actuator/request.json';
const RECEIPT_PATH = process.argv[3] || 'farm/provider-actuator/latest-receipt.json';
const OUT_PATH = process.argv[4] || '/tmp/provider-actuator-plan.json';
const UNIT = 250_000;

const request = JSON.parse(fs.readFileSync(REQUEST_PATH, 'utf8'));
if (request.schema !== 'daube.resource-farm-provider-actuator-request.v1') fail('request_schema_invalid');
if (request.paidSpendAuthorized !== false) fail('paid_spend_forbidden');
if (request.privateAssetsUsed !== false) fail('private_assets_forbidden');
if (request.mode !== 'zero-spend-cross-provider') fail('mode_invalid');
if (!/^[a-z0-9-]{8,80}$/.test(String(request.requestId || ''))) fail('request_id_invalid');

const backlog = bounded(request.backlogWorkUnits, UNIT, UNIT * 12, UNIT);
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

// If prior execution was not healthy, add one bounded safety replica in each family.
// If it was healthy, current demand is allowed to downscale naturally.
if (previous && !previousHealthy) {
  githubReplicas = clamp(githubReplicas + 1, minGitHub, maxGitHub);
  supabaseReplicas = clamp(supabaseReplicas + 1, 1, maxSupabase);
}

// Keep adding bounded capacity until the requested work can be evidenced.
while (githubReplicas + supabaseReplicas < requiredUnits && githubReplicas < maxGitHub) githubReplicas += 1;
while (githubReplicas + supabaseReplicas < requiredUnits && supabaseReplicas < maxSupabase) supabaseReplicas += 1;

const capacityUnits = githubReplicas + supabaseReplicas;
const plan = {
  schema: 'daube.resource-farm-provider-actuator-plan.v1',
  requestId: request.requestId,
  mode: request.mode,
  requestedWorkUnits: backlog,
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
  feedback: {
    previousReceiptSeen: Boolean(previous),
    previousHealthy,
    previousRequestId: previous?.requestId ?? null,
    previousTotalEvidenceWorkUnits: previous?.totalEvidenceWorkUnits ?? null,
  },
  policy: {
    zeroSpendOnly: true,
    noPaidSpillover: true,
    publicInputsOnly: true,
    privateAssetsUsed: false,
    paidSpendAuthorized: false,
    maxGitHubReplicas: maxGitHub,
    maxSupabaseReplicas: maxSupabase,
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
