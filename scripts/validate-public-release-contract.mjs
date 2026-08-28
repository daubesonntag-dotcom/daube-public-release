import fs from 'node:fs';
import path from 'node:path';

const contract = JSON.parse(fs.readFileSync(process.argv[2] || 'governance/repository-contract.json', 'utf8'));
const errors = [];
const recoveryPath = 'release/payment-domain-recovery-v1.json';
const recovery = fs.existsSync(recoveryPath) ? JSON.parse(fs.readFileSync(recoveryPath, 'utf8')) : null;
const recoveryActive = Boolean(
  recovery?.schema === 'daube.payment-domain-recovery.v1' &&
  recovery?.status === 'ACTIVE_RECOVERY' &&
  recovery?.recoveryAuthority?.repository === 'daubesonntag-dotcom/daube-public-release' &&
  recovery?.recoveryAuthority?.publisher === 'github-pages' &&
  recovery?.recoveryAuthority?.temporary === true &&
  typeof recovery?.exitCondition === 'string' && recovery.exitCondition.trim()
);

const expected = {
  repository: 'daubesonntag-dotcom/daube-site',
  portfolioRepositoryId: 'public-release-channel',
  role: 'public-install-update-and-presentation-channel',
  lifecycle: 'active',
  sourceRuntime: 'daubesonntag-dotcom/daube-forge-os',
  auditOwner: 'Founder / Public Release Steward'
};
for (const [field, value] of Object.entries(expected)) {
  if (contract[field] !== value) errors.push(`${field} must equal ${value}`);
}

for (const field of ['canonicalFor', 'mustNotOwn', 'dependsOn', 'acceptsFrom', 'publishesTo', 'permittedChangeTiers', 'requiredReleaseEvidence']) {
  if (!Array.isArray(contract[field]) || contract[field].some((value) => typeof value !== 'string' || value.trim() === '')) errors.push(`${field} must be an array of non-empty strings`);
}

if (contract.publicNoSecrets !== true) errors.push('publicNoSecrets must remain true');
if (contract.releaseAuthority !== false) errors.push('public channel cannot self-authorize releases');
if (contract.productionAuthority !== false) errors.push('public channel cannot own commerce/runtime production authority');
if (!contract.dependsOn?.includes('canonical-runtime')) errors.push('public channel must depend on canonical-runtime');
if (!contract.acceptsFrom?.includes('canonical-runtime')) errors.push('public channel may accept release artifacts only from canonical-runtime');
if (contract.permittedChangeTiers?.includes('T3')) errors.push('T3 changes are not permitted in the public repository');
if (contract.mustNotOwn?.some((domain) => contract.canonicalFor?.includes(domain))) errors.push('canonicalFor and mustNotOwn overlap');
if (contract.exceptionRule !== 'exceptions-expire-and-never-create-precedent') errors.push('exceptions must expire and never create precedent');

for (const field of ['sourceCommit', 'artifactDigest', 'testSummary', 'releasePassport', 'rollbackReference']) {
  if (!contract.requiredReleaseEvidence?.includes(field)) errors.push(`requiredReleaseEvidence must include ${field}`);
}

const prohibitedNames = [/^\.env(?:\.|$)/i, /(?:^|\/)id_rsa$/i, /\.(?:pem|key|p12|pfx)$/i, /service-account.*\.json$/i];
const privateKeyHeader = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
const tokenPatterns = [/\bghp_[A-Za-z0-9]{30,}\b/, /\bgithub_pat_[A-Za-z0-9_]{30,}\b/, /\bAKIA[0-9A-Z]{16}\b/, /\bsk-[A-Za-z0-9_-]{24,}\b/, /\bpdl_(?:live|sdbx)_apikey_[A-Za-z0-9_-]{12,}\b/];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules'].includes(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    const normalized = fullPath.replaceAll('\\', '/');
    if (entry.isDirectory()) { walk(fullPath); continue; }
    if (prohibitedNames.some((pattern) => pattern.test(normalized))) errors.push(`prohibited public credential file: ${normalized}`);
    if (normalized === 'scripts/validate-public-release-contract.mjs') continue;
    const stat = fs.statSync(fullPath);
    if (stat.size > 1_000_000) continue;
    const content = fs.readFileSync(fullPath, 'utf8');
    if (content.includes(privateKeyHeader)) errors.push(`private key material detected in ${normalized}`);
    for (const pattern of tokenPatterns) if (pattern.test(content)) errors.push(`high-confidence secret pattern detected in ${normalized}`);
  }
}
walk('.');

const index = fs.readFileSync('index.html', 'utf8');
const manifest = fs.readFileSync('manifest.webmanifest', 'utf8');
const serviceWorker = fs.readFileSync('sw.js', 'utf8');
const robots = fs.readFileSync('robots.txt', 'utf8');

if (!index.includes('<link rel="canonical" href="https://daubesonntag.com/">')) errors.push('public static root must canonicalize to https://daubesonntag.com/');
for (const syntheticFounderMarker of ['D’AUBE Founder OS', 'Founder Operating System', 'System health', 'Agents online', 'GRAND STEWARD ONLINE']) {
  if (index.includes(syntheticFounderMarker)) errors.push(`synthetic/private Founder preview marker must not return: ${syntheticFounderMarker}`);
}
if (/Founder OS/i.test(manifest)) errors.push('public manifest must not advertise a Founder OS install');
if (/founder-os/i.test(serviceWorker)) errors.push('public service-worker cache must not retain Founder OS identity');

if (recoveryActive) {
  if (!index.includes('index,follow')) errors.push('active payment recovery root must be indexable for provider review');
  if (!index.includes('/pay/')) errors.push('active payment recovery root must link to /pay/');
  if (!fs.existsSync('pay/index.html')) errors.push('active payment recovery requires pay/index.html');
  else {
    const pay = fs.readFileSync('pay/index.html', 'utf8');
    for (const marker of ['Workflow Kit — Single', 'US$15', 'US$39', 'US$95', '../terms/', '../privacy/', '../refund/', '../contact/', 'Paddle']) {
      if (!pay.includes(marker)) errors.push(`payment review surface missing required marker: ${marker}`);
    }
  }
  if (/^\s*Disallow:\s*\/\s*$/mi.test(robots)) errors.push('active payment recovery robots.txt must not disallow the whole site');
  if (!/^\s*Allow:\s*\/\s*$/mi.test(robots)) errors.push('active payment recovery robots.txt must explicitly allow public review routes');
} else {
  if (!index.includes('noindex,nofollow,noarchive,nosnippet')) errors.push('public release channel root must remain noindex/nofollow');
  if (!index.includes('Public release channel')) errors.push('static root must identify itself as the public release channel');
  if (!/^User-agent: \*\s+Disallow: \/$/m.test(robots)) errors.push('robots.txt must disallow indexing of the public release channel');
}

if (errors.length) {
  for (const error of [...new Set(errors)]) console.error(`ERROR: ${error}`);
  process.exit(1);
}
console.log(recoveryActive
  ? 'Public release repository contract valid in bounded ACTIVE_RECOVERY mode; payment-review and no-secrets invariants passed.'
  : 'Public release repository contract valid; canonical/noindex/private-boundary and no-secrets invariants passed.');
