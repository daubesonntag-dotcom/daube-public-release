import fs from 'node:fs';

const manifestPath = process.argv[2] || 'governance/public-release-manifest.example.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const errors = [];

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') errors.push(`${field} must be a non-empty string`);
}

function requireStringArray(value, field) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    errors.push(`${field} must be a non-empty array of strings`);
  }
}

requireString(manifest.schemaVersion, 'schemaVersion');
requireString(manifest.releaseId, 'releaseId');
requireString(manifest.source?.repository, 'source.repository');
requireString(manifest.source?.commit, 'source.commit');
requireString(manifest.source?.releaseHandoffId, 'source.releaseHandoffId');
requireString(manifest.artifact?.digestAlgorithm, 'artifact.digestAlgorithm');
requireString(manifest.artifact?.digest, 'artifact.digest');
requireStringArray(manifest.artifact?.publishedPaths, 'artifact.publishedPaths');
requireString(manifest.verification?.testSummary, 'verification.testSummary');
requireString(manifest.verification?.secretScan, 'verification.secretScan');
requireString(manifest.verification?.publicSmokeTest, 'verification.publicSmokeTest');
requireString(manifest.approval?.releasePassport, 'approval.releasePassport');
requireString(manifest.approval?.approvedBy, 'approval.approvedBy');
requireString(manifest.approval?.approvedAt, 'approval.approvedAt');
requireString(manifest.rollback?.rollbackReference, 'rollback.rollbackReference');
requireString(manifest.rollback?.owner, 'rollback.owner');
requireString(manifest.rollback?.procedure, 'rollback.procedure');
requireStringArray(manifest.claims?.proven, 'claims.proven');
requireStringArray(manifest.claims?.notProven, 'claims.notProven');
requireString(manifest.auditReference, 'auditReference');
requireString(manifest.publishedAt, 'publishedAt');

if (manifest.source?.repository !== 'daubesonntag-dotcom/daube-forge-os') {
  errors.push('source.repository must be the canonical runtime repository');
}
if (manifest.artifact?.digestAlgorithm !== 'sha256') errors.push('artifact.digestAlgorithm must be sha256');
if (manifest.claims?.notProven?.length === 0) errors.push('claims.notProven must remain explicit');
if (manifest.exception && typeof manifest.exception !== 'object') errors.push('exception must be null or an object');

if (errors.length > 0) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log(`Public release manifest valid: ${manifest.releaseId}`);
