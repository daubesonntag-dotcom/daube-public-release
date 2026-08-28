#!/usr/bin/env node
import fs from 'node:fs';

const replicas = Number(process.argv[2]);
const generation = Number(process.argv[3] || 10);
const output = process.argv[4] || '/tmp/supabase-bundle.json';
if (!Number.isInteger(replicas) || replicas < 1 || replicas > 4) fail('replicas_invalid');
if (!Number.isInteger(generation) || generation < 4 || generation > 10000) fail('generation_invalid');

const endpoint = `https://wilqsqndjgckqxbjptxm.supabase.co/functions/v1/daube-resource-farm-pollen-edge/v1/farm/pollen?generation=${generation}`;
const receipts = await Promise.all(Array.from({ length: replicas }, (_, index) => invoke(index + 1)));
fs.writeFileSync(output, JSON.stringify(receipts, null, 2) + '\n');
console.log(JSON.stringify({ providerFamily: 'supabase-edge', replicas, generation, receipts }));

async function invoke(replica) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        headers: { accept: 'application/json', 'cache-control': 'no-store', 'user-agent': 'daube-provider-actuator/2' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`http_${response.status}`);
      const value = await response.json();
      validate(value);
      return { ...value, actuatorReplica: replica, actuatorAttempt: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError ?? new Error('supabase_dispatch_failed');
}

function validate(value) {
  if (!value || typeof value !== 'object') fail('receipt_invalid');
  if (value.schema !== 'daube.resource-farm-pollen-receipt.v2') fail('receipt_schema_invalid');
  if (value.generation !== generation) fail('receipt_generation_invalid');
  if (value.providerFamily !== 'supabase-edge') fail('provider_family_invalid');
  if (value.success !== true) fail('provider_execution_failed');
  if (value.paidSpendAuthorized !== false) fail('paid_spend_forbidden');
  if (value.privateAssetsUsed !== false) fail('private_assets_forbidden');
  if (Number(value.workUnits) < 250_000) fail('work_units_insufficient');
  if (!(Number(value.workUnitsPerSecond) > 0)) fail('throughput_invalid');
}
function fail(code) { throw new Error(code); }
