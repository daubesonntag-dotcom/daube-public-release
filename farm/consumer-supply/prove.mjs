#!/usr/bin/env node
import fs from 'node:fs';

const contractPath = process.argv[2] || 'farm/consumer-supply/contract.json';
const outputPath = process.argv[3] || '/tmp/resource-farm-consumer-supply-receipt.json';
const FARM = 'https://wilqsqndjgckqxbjptxm.supabase.co/functions/v1/daube-resource-farm/v1/farm/inventory';
const LIFECYCLE = 'https://wilqsqndjgckqxbjptxm.supabase.co/functions/v1/daube-resource-farm-lifecycle/v1/farm/lifecycle';

const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const [farm, lifecycle] = await Promise.all([getJson(FARM), getJson(LIFECYCLE)]);
const liveResources = new Set((Array.isArray(farm.resources) ? farm.resources : [])
  .filter((r) => r?.liveEvidence === true)
  .map((r) => String(r.resourceClass)));

const commonControls = {
  farmLive: farm.status === 'LIVE',
  twelveOfTwelve: Number(farm.liveEvidenceCount) === 12 && Number(farm.totalResourceClasses) === 12,
  lifecycleLive: lifecycle.status === 'LIVE',
  selfPlayGuarded: lifecycle.operatingMode === 'SELF_PLAY_GUARDED',
  providerDispatchClosedLoop: lifecycle?.reproduction?.providerExecutionDispatchClosedLoopProven === true || lifecycle?.providerExecutionDispatchClosedLoopProven === true,
  crossProviderActuation: lifecycle?.reproduction?.crossProviderExecutionActuationProven === true || lifecycle?.crossProviderExecutionActuationProven === true,
  noUnattendedPaidSpend: lifecycle?.autonomy?.noUnattendedPaidSpend === true,
  noAutomaticPrivilegeExpansion: lifecycle?.autonomy?.noAutomaticPrivilegeExpansion === true,
  failClosedOnStaleEvidence: lifecycle?.autonomy?.failClosedOnStaleEvidence === true,
};

const consumers = contract.consumers.map((consumer) => {
  const missing = consumer.requiredResourceClasses.filter((name) => !liveResources.has(name));
  const controls = {
    ...commonControls,
    requiredResourcesLive: missing.length === 0,
  };
  const passed = Object.values(controls).filter(Boolean).length;
  const total = Object.keys(controls).length;
  const score = Math.round((passed / total) * 100);
  const green = score >= Number(contract.minimumGreenScore || 95) && missing.length === 0;
  return {
    id: consumer.id,
    claim: consumer.claim,
    status: green ? 'GREEN' : 'BLOCKED',
    score,
    minimumGreenScore: Number(contract.minimumGreenScore || 95),
    requiredResourceClasses: consumer.requiredResourceClasses,
    missingResourceClasses: missing,
    controls,
    physicalRestaurantReadiness: consumer.physicalRestaurantReadiness ?? null,
  };
});

const receipt = {
  schema: 'daube.resource-farm-consumer-supply-receipt.v1',
  status: consumers.every((c) => c.status === 'GREEN') ? 'GREEN' : 'BLOCKED',
  farmStatus: farm.status,
  farmLiveEvidenceCount: farm.liveEvidenceCount,
  farmTotalResourceClasses: farm.totalResourceClasses,
  lifecycleStatus: lifecycle.status,
  operatingMode: lifecycle.operatingMode,
  consumers,
  minimumGreenScore: Number(contract.minimumGreenScore || 95),
  paidSpendAuthorized: false,
  newOAuthRequired: false,
  physicalTruthBoundary: contract.truthBoundary,
  observedAt: new Date().toISOString(),
};

if (receipt.status !== 'GREEN') {
  fs.writeFileSync(outputPath, JSON.stringify(receipt, null, 2) + '\n');
  console.error(JSON.stringify(receipt));
  process.exit(1);
}
fs.writeFileSync(outputPath, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));

async function getJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'cache-control': 'no-store', 'user-agent': 'daube-consumer-supply-proof/1' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`http_${response.status}:${url}`);
  const value = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`invalid_json:${url}`);
  return value;
}
