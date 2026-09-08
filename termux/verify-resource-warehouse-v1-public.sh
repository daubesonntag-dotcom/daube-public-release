#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail
umask 077
HOST_ALIAS="${DAUBE_HOST_ALIAS:-daube-host-01}"
PUBLIC_SHA="69e53a8465036730b084675fbbc554a5125b8e66"
BASE="https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/${PUBLIC_SHA}/warehouse"
ssh -o BatchMode=yes -o ConnectTimeout=12 "$HOST_ALIAS" "PUBLIC_SHA='$PUBLIC_SHA' BASE='$BASE' bash -s" <<'REMOTE'
set -Eeuo pipefail
TMP="$(mktemp -d /tmp/daube-resource-warehouse-public.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL --proto '=https' --tlsv1.2 "$BASE/RESOURCE_WAREHOUSE_V1.json" -o "$TMP/RESOURCE_WAREHOUSE_V1.json"
curl -fsSL --proto '=https' --tlsv1.2 "$BASE/RESOURCE_WAREHOUSE_CREATIVE_COMPUTE_V1.json" -o "$TMP/RESOURCE_WAREHOUSE_CREATIVE_COMPUTE_V1.json"
node --input-type=module <<NODE
import fs from 'node:fs';
for (const path of ['$TMP/RESOURCE_WAREHOUSE_V1.json','$TMP/RESOURCE_WAREHOUSE_CREATIVE_COMPUTE_V1.json']) {
  const w=JSON.parse(fs.readFileSync(path,'utf8'));
  if (w.schema !== 'daube.resource-warehouse.v1') throw new Error('schema mismatch: '+path);
  if (!Array.isArray(w.resources) || w.resources.length < 1) throw new Error('empty resources: '+path);
  if (w.policy?.costCeilingUsdDefault !== 0) throw new Error('cost ceiling violation: '+path);
  console.log(`${path.split('/').pop()}: resources=${w.resources.length}`);
}
NODE
H1="$(sha256sum "$TMP/RESOURCE_WAREHOUSE_V1.json" | awk '{print $1}')"
H2="$(sha256sum "$TMP/RESOURCE_WAREHOUSE_CREATIVE_COMPUTE_V1.json" | awk '{print $1}')"
printf '{"schema":"daube.resource-warehouse-public-receipt.v1","status":"VERIFIED","publicReleaseSha":"%s","warehouseSha256":"%s","creativeComputeSha256":"%s","costCeilingUsd":0,"privateRepoCredentialRequired":false}\n' "$PUBLIC_SHA" "$H1" "$H2"
echo 'RESOURCE_WAREHOUSE_PUBLIC_RUNTIME=PASS'
REMOTE
