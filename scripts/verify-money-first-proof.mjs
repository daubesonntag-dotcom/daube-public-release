#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const index = JSON.parse(fs.readFileSync(path.join(root, 'config/money-first-proof-index.v1.json'), 'utf8'));
const schema = JSON.parse(fs.readFileSync(path.join(root, 'config/public-proof-record.schema.v1.json'), 'utf8'));
const rights = JSON.parse(fs.readFileSync(path.join(root, 'config/rights-attribution-summary.v1.json'), 'utf8'));
const page = fs.readFileSync(path.join(root, 'proof/index.html'), 'utf8');
const sprint = fs.readFileSync(path.join(root, 'assets/automation-sprint-v2.js'), 'utf8');

const failures = [];
const requiredClasses = ['DEMO', 'IMPLEMENTED', 'DEPLOYED_HEALTHY', 'CUSTOMER_DELIVERY', 'REVENUE_VERIFIED'];
const indexClasses = new Set(index.proof_classes?.map(entry => entry.id));
const schemaClasses = new Set(schema.proof_classes || []);
for (const proofClass of requiredClasses) {
  if (!indexClasses.has(proofClass)) failures.push(`index_missing_class:${proofClass}`);
  if (!schemaClasses.has(proofClass)) failures.push(`schema_missing_class:${proofClass}`);
  if (!page.includes(proofClass.replace('_', ' · ')) && !page.includes(proofClass)) failures.push(`page_missing_class:${proofClass}`);
}
for (const field of ['claim_id','proof_class','capability_or_offer_id','evidence_summary','evidence_date','scope_or_environment','limitations','rights_and_disclosure_basis']) {
  if (!index.required_public_fields?.includes(field)) failures.push(`index_missing_field:${field}`);
  if (!schema.required?.includes(field)) failures.push(`schema_missing_field:${field}`);
}
if (!String(schema.truth_boundary || '').includes('cannot promote')) failures.push('schema_truth_boundary_missing');
if (!String(rights.truth_boundary || '').includes('not a certification')) failures.push('rights_truth_boundary_missing');
if (!page.includes('No CUSTOMER_DELIVERY or REVENUE_VERIFIED claim is published')) failures.push('public_empty_higher_proof_boundary_missing');
if (!page.includes('Demo ≠ implemented ≠ deployed ≠ delivered ≠ settled revenue')) failures.push('public_truth_summary_missing');
if (!sprint.includes("result.orderCreated !== false") || !sprint.includes("result.paymentCreated !== false") || !sprint.includes("result.revenueCountable !== false")) failures.push('sprint_lead_truth_gate_missing');
if (!sprint.includes('leadRef') || sprint.includes('result.accepted !== true') || sprint.includes('result.leadId')) failures.push('sprint_edge_v2_contract_stale');
if (!sprint.includes('money_offer_qualification_submitted')) failures.push('sprint_conversion_event_missing');

export function validatePublicProofRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { ok: false, errors: ['record_not_object'] };
  for (const field of schema.required) if (typeof record[field] !== 'string' || !record[field].trim()) errors.push(`required:${field}`);
  if (!schemaClasses.has(record.proof_class)) errors.push('proof_class_invalid');
  const evidenceText = `${record.evidence_summary || ''} ${record.limitations || ''}`.toLowerCase();
  if (record.proof_class === 'DEPLOYED_HEALTHY' && !record.runtime_readback_ref) errors.push('runtime_readback_required');
  if (record.proof_class === 'CUSTOMER_DELIVERY' && !record.commercial_basis_ref) errors.push('commercial_basis_required');
  if (record.proof_class === 'REVENUE_VERIFIED') {
    if (!record.settlement_evidence_ref) errors.push('settlement_evidence_required');
    if (/canary|test payment|related.?party|founder.?test/.test(evidenceText)) errors.push('non_customer_evidence_forbidden');
  }
  return { ok: errors.length === 0, errors };
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}

const negativeRevenue = validatePublicProofRecord({
  claim_id: 'TEST', proof_class: 'REVENUE_VERIFIED', capability_or_offer_id: 'TEST', evidence_summary: 'founder test canary', evidence_date: '2026-08-29', scope_or_environment: 'test', limitations: 'related-party', rights_and_disclosure_basis: 'test-only', settlement_evidence_ref: 'test'
});
if (negativeRevenue.ok || !negativeRevenue.errors.includes('non_customer_evidence_forbidden')) {
  console.error(JSON.stringify({ ok: false, failures: ['negative_revenue_canary_not_rejected'] }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, packet: 'MF-006', proofClasses: requiredClasses, publicSurface: 'proof/index.html', automationSprintEdgeV2Aligned: true }, null, 2));
