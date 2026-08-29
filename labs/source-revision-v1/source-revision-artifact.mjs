import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = 'daube.web.source-revision.v1';
const REPOSITORY = 'daubesonntag-dotcom/daube-web';
const SHA_RE = /^[a-f0-9]{40}$/;

function normalizeSha(value, label) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!SHA_RE.test(normalized)) throw new Error(`${label} must be a 40-character lowercase Git SHA`);
  return normalized;
}

export function readGitHead(cwd = process.cwd(), runner = spawnSync) {
  const result = runner('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git rev-parse HEAD failed: ${String(result.stderr || result.stdout || '').trim()}`);
  return normalizeSha(result.stdout, 'git HEAD');
}

export function buildSourceRevisionRecord(options = {}) {
  const gitHead = normalizeSha(options.gitHead ?? readGitHead(options.cwd, options.runner), 'git HEAD');
  const rawExpected = options.expectedSha ?? options.env?.DAUBE_RELEASE_SHA ?? process.env.DAUBE_RELEASE_SHA ?? '';
  const expectedSha = rawExpected ? normalizeSha(rawExpected, 'DAUBE_RELEASE_SHA') : null;
  if (expectedSha && expectedSha !== gitHead) throw new Error(`DAUBE_RELEASE_SHA mismatch: expected ${expectedSha}, checkout is ${gitHead}`);
  return {
    schema: SCHEMA,
    repository: REPOSITORY,
    sourceRevision: gitHead,
    admissionExpectedRevision: expectedSha,
    exactShaBound: Boolean(expectedSha),
    runtimeClass: 'STATIC_WEB_ASSET',
    publicEvidenceOnly: true,
    generatedAt: options.now ?? new Date().toISOString()
  };
}

export function writeSourceRevisionArtifact(options = {}) {
  const outDir = path.resolve(options.cwd ?? process.cwd(), options.outDir ?? 'dist');
  const record = buildSourceRevisionRecord(options);
  const outputPath = path.join(outDir, '__daube', 'revision.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return { record, outputPath };
}

export function verifySourceRevisionArtifact(options = {}) {
  const outDir = path.resolve(options.cwd ?? process.cwd(), options.outDir ?? 'dist');
  const outputPath = path.join(outDir, '__daube', 'revision.json');
  if (!fs.existsSync(outputPath)) throw new Error(`source revision artifact missing: ${outputPath}`);
  const record = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  if (record.schema !== SCHEMA) throw new Error(`unexpected source revision schema: ${record.schema}`);
  if (record.repository !== REPOSITORY) throw new Error(`unexpected source revision repository: ${record.repository}`);
  normalizeSha(record.sourceRevision, 'artifact sourceRevision');
  if (record.publicEvidenceOnly !== true) throw new Error('source revision artifact must remain public-evidence-only');
  const rawExpected = options.expectedSha ?? options.env?.DAUBE_RELEASE_SHA ?? process.env.DAUBE_RELEASE_SHA ?? '';
  if (rawExpected) {
    const expectedSha = normalizeSha(rawExpected, 'DAUBE_RELEASE_SHA');
    if (record.sourceRevision !== expectedSha) throw new Error(`artifact sourceRevision mismatch: expected ${expectedSha}, got ${record.sourceRevision}`);
    if (record.admissionExpectedRevision !== expectedSha || record.exactShaBound !== true) throw new Error('artifact is not bound to the admitted exact SHA');
  }
  return { record, outputPath };
}
