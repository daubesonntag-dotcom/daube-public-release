import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function fail(message) {
  throw new Error(message);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function digestSource(source) {
  const copy = structuredClone(source);
  delete copy.provenance.receiptDigest;
  const canonical = JSON.stringify(canonicalize(copy));
  return `sha256:${crypto.createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

const productId = process.env.PPE_PRODUCT_ID;
const exporterId = process.env.PPE_EXPORTER_ID;
const repository = process.env.PPE_REPOSITORY;
const subjectRevision = process.env.PPE_SUBJECT_REVISION;
const receiptSpecPath = process.env.PPE_RECEIPTS_FILE;
const outputPath = process.env.PPE_OUTPUT_FILE || 'dist/ppe-v3/export.json';

if (!productId || !exporterId || !repository || !subjectRevision || !receiptSpecPath) fail('missing PPE exporter environment');
if (subjectRevision.length < 7) fail('subject revision is too short');

const specs = JSON.parse(fs.readFileSync(receiptSpecPath, 'utf8'));
if (!Array.isArray(specs) || specs.length === 0) fail('receipt spec must be a non-empty array');

const exportedAt = new Date().toISOString();
const receipts = specs.map((spec, index) => {
  if (!spec.sourceId || !spec.evidenceClass || !spec.sourceKind || !spec.outcome || !spec.producer || !spec.limitations) fail(`invalid receipt spec at index ${index}`);
  if (!Array.isArray(spec.immutableRefs) || spec.immutableRefs.length === 0) fail(`immutable refs missing at index ${index}`);
  if (!spec.immutableRefs.every((ref) => typeof ref === 'string' && (ref.includes(subjectRevision) || /^sha256:[a-f0-9]{64}$/.test(ref)))) fail(`receipt ${spec.sourceId} lacks exact-revision or content-hash binding`);
  const source = {
    sourceId: spec.sourceId,
    productId,
    evidenceClass: spec.evidenceClass,
    subjectRevision,
    observedAt: exportedAt,
    sourceKind: spec.sourceKind,
    outcome: spec.outcome,
    immutableRefs: [...new Set(spec.immutableRefs)],
    provenance: {
      repository,
      producer: spec.producer,
      producerRevision: subjectRevision,
      receiptDigest: ''
    },
    limitations: spec.limitations
  };
  source.provenance.receiptDigest = digestSource(source);
  return source;
});

const shortRevision = subjectRevision.replace(/[^A-Fa-f0-9]/g, '').slice(0, 12).toUpperCase();
const exportId = `PPE-EXPORT-${productId.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}-${shortRevision}`;
const envelope = {
  schemaVersion: '3.0.0',
  exportId,
  exporterId,
  productId,
  repository,
  subjectRevision,
  exportedAt,
  receipts
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ exportId, subjectRevision, receiptCount: receipts.length, productionPromotionAuthorized: false }, null, 2));
