#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

PUBLIC_SHA="69e53a8465036730b084675fbbc554a5125b8e66"
BASE="https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/${PUBLIC_SHA}/warehouse"
TMP="$(mktemp -d /tmp/daube-resource-warehouse-public.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

command -v curl >/dev/null 2>&1 || { echo 'curl missing' >&2; exit 20; }
command -v node >/dev/null 2>&1 || { echo 'node missing' >&2; exit 20; }
command -v sha256sum >/dev/null 2>&1 || { echo 'sha256sum missing' >&2; exit 20; }

curl -fsSL --proto '=https' --tlsv1.2 "$BASE/RESOURCE_WAREHOUSE_V1.json" -o "$TMP/RESOURCE_WAREHOUSE_V1.json"
curl -fsSL --proto '=https' --tlsv1.2 "$BASE/RESOURCE_WAREHOUSE_CREATIVE_COMPUTE_V1.json" -o "$TMP/RESOURCE_WAREHOUSE_CREATIVE_COMPUTE_V1.json"

export DAUBE_W1="$TMP/RESOURCE_WAREHOUSE_V1.json"
export DAUBE_W2="$TMP/RESOURCE_WAREHOUSE_CREATIVE_COMPUTE_V1.json"
node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
for (const file of [process.env.DAUBE_W1, process.env.DAUBE_W2]) {
  const w = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (w.schema !== 'daube.resource-warehouse.v1') throw new Error('schema mismatch: ' + file);
  if (!Array.isArray(w.resources) || w.resources.length < 1) throw new Error('empty resources: ' + file);
  if (w.policy?.costCeilingUsdDefault !== 0) throw new Error('cost ceiling violation: ' + file);
  const ids = new Set();
  for (const r of w.resources) {
    if (!r || typeof r.id !== 'string' || !r.id.trim()) throw new Error('resource id missing');
    if (ids.has(r.id)) throw new Error('duplicate resource id: ' + r.id);
    ids.add(r.id);
    if (typeof r.upstream !== 'string' || !r.upstream.startsWith('https://github.com/')) throw new Error('untrusted upstream: ' + r.id);
    if (typeof r.license !== 'string' || !r.license.trim()) throw new Error('license field missing: ' + r.id);
  }
  console.log(path.basename(file) + ': resources=' + w.resources.length);
}
NODE

H1="$(sha256sum "$DAUBE_W1" | awk '{print $1}')"
H2="$(sha256sum "$DAUBE_W2" | awk '{print $1}')"
printf '{"schema":"daube.resource-warehouse-public-manifest-receipt.v2","status":"MANIFESTS_VERIFIED","publicReleaseSha":"%s","warehouseSha256":"%s","creativeComputeSha256":"%s","costCeilingUsd":0,"privateRepoCredentialRequired":false,"sourceEngineTestsVerified":false}\n' "$PUBLIC_SHA" "$H1" "$H2"
echo 'RESOURCE_WAREHOUSE_PUBLIC_MANIFEST_RUNTIME=PASS'
