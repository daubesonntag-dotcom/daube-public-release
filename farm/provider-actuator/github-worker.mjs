#!/usr/bin/env node
import fs from 'node:fs';

const replica = Number(process.argv[2]);
const requestId = String(process.argv[3] || '');
const output = process.argv[4] || `/tmp/github-${replica}.json`;
if (!Number.isInteger(replica) || replica < 1 || replica > 8) fail('replica_invalid');
if (!/^[a-z0-9-]{8,80}$/.test(requestId)) fail('request_id_invalid');

const workUnits = 250_000;
const seed = 1000 + replica;
let x = (2166136261 ^ seed) >>> 0;
const started = process.hrtime.bigint();
for (let i = 0; i < workUnits; i += 1) {
  x = (x ^ ((i + seed) >>> 0)) >>> 0;
  x = Math.imul(x, 16777619) >>> 0;
}
const elapsedMs = Math.max(0.001, Number(process.hrtime.bigint() - started) / 1e6);
const receipt = {
  schema: 'daube.resource-farm-provider-execution.v1',
  requestId,
  providerFamily: 'github-public-runner',
  backend: 'github-actions-ubuntu-24.04',
  replica,
  workUnits,
  workUnitsPerSecond: Number((workUnits / (elapsedMs / 1000)).toFixed(2)),
  checksum: x.toString(16).padStart(8, '0'),
  success: true,
  observedAt: new Date().toISOString(),
  paidSpendAuthorized: false,
  privateAssetsUsed: false,
};
fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));

function fail(code) { console.error(code); process.exit(64); }
