import fs from 'node:fs';

const REQUIRED = Array.from({length: 12}, (_, i) => `MIC-V${i + 7}`);
const HIGH_RISK_FALSE = ['mayPromoteProductionWithoutReleaseGate', 'mayPublishUnsupportedClaims', 'mayChangeCredentials', 'maySpend', 'mayDestructivelyPurgeArchive'];
const CREDENTIAL_KEY = /^(api[_-]?key|secret|password|credential|credentials|access[_-]?token|refresh[_-]?token)$/i;

function scan(value, path = '$') {
  if (Array.isArray(value)) return value.forEach((v, i) => scan(v, `${path}[${i}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (CREDENTIAL_KEY.test(key)) throw new Error(`credential-like key rejected at ${path}.${key}`);
    scan(child, `${path}.${key}`);
  }
}

export function validateProjection(projection) {
  scan(projection);
  if (projection.canonicalOwner !== 'daube-forge-os') throw new Error('canonical owner must remain daube-forge-os');
  for (const id of REQUIRED) if (!projection.canonicalContracts?.includes(id)) throw new Error(`missing canonical contract ${id}`);
  if (projection.upstreamState !== 'verified-integrated' && projection.productionAdoptionAllowed !== false) throw new Error('candidate upstream cannot enable production adoption');
  if (!Array.isArray(projection.craftDimensions) || projection.craftDimensions.length < 5) throw new Error('insufficient craft dimensions');
  if (!Array.isArray(projection.requiredEvidence) || projection.requiredEvidence.length < 4) throw new Error('insufficient evidence requirements');
  for (const key of HIGH_RISK_FALSE) if (projection.authorityBoundary?.[key] !== false) throw new Error(`high-risk boundary must remain false: ${key}`);
  if (projection.truthBoundary?.projectionIsNotCanonicalOwnership !== true) throw new Error('projection ownership truth boundary missing');
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const projection = JSON.parse(fs.readFileSync('config/institution/maison-projection.v1.json', 'utf8'));
  validateProjection(projection);
  console.log(JSON.stringify({status: 'ok', projection: projection.id, upstreamState: projection.upstreamState, productionAdoptionAllowed: projection.productionAdoptionAllowed}, null, 2));
}
