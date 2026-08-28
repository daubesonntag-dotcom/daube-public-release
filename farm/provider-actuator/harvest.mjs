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

const total = all.reduce((sum, r) => sum + Number(r.workUnits || 0), 0);
const families = [...new Set(all.map((r) => r.providerFamily))].sort();
const admitted = families.length === 2 && total >= requested;
const feedbackSeen = Boolean(plan?.feedback?.previousReceiptSeen);

const receipt = {
  schema: 'daube.resource-farm-provider-actuator-receipt.v1',
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
  feedback: plan.feedback ?? {},
  feedbackClosedLoopObserved: admitted && feedbackSeen,
  providerExecutionDispatchClosedLoopProven: admitted && feedbackSeen,
  crossProviderExecutionActuationProven: admitted,
  providerCapacityProvisioningClosedLoopProven: false,
  paidSpendAuthorized: false,
  privateAssetsUsed: false,
  truthBoundary: 'Execution dispatch is proven across admitted ephemeral providers. Arbitrary third-party VM/GPU/VPS account or capacity provisioning is not claimed.',
  observedAt: new Date().toISOString(),
};

if (!admitted) fail('harvest_not_admitted');
fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function fail(code) { console.error(code); process.exit(65); }
