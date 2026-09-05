import assert from 'node:assert/strict';
import { qualifyOpportunity, contractDecision, externalWriteDecision, countableRevenue, idempotencyKey } from './worker.mjs';

assert.deepEqual(qualifyOpportunity({ fixedValueUsd: 80 }), { admitted: true, reason: 'QUALIFIED' });
assert.deepEqual(qualifyOpportunity({ fixedValueUsd: 20 }), { admitted: false, reason: 'BELOW_MIN_VALUE' });
assert.deepEqual(qualifyOpportunity({ fixedValueUsd: 300, requiresPaidSpend: true }), { admitted: false, reason: 'PAID_SPEND' });
assert.deepEqual(externalWriteDecision({ official: true, authenticated: true, permitsExactAction: true }), { action: 'OFFICIAL_SUBMIT' });
assert.deepEqual(externalWriteDecision({ official: true, authenticated: false, permitsExactAction: true }), { action: 'FOUNDER_PLATFORM_GATE' });
assert.deepEqual(contractDecision({
  totalValueUsd: 299,
  platformNativeFixedPrice: true,
  deliveryHours: 48,
  objectiveAcceptanceCriteria: true,
  platformProvidesFundingProtection: true,
  fundingProtectionVisible: true
}), { action: 'ACCEPT_STANDARD' });
assert.deepEqual(contractDecision({
  totalValueUsd: 299,
  platformNativeFixedPrice: true,
  deliveryHours: 48,
  objectiveAcceptanceCriteria: true,
  requiresOtp: true
}), { action: 'FOUNDER_CONTRACT_GATE' });
assert.equal(countableRevenue({ state: 'AWAIT_SETTLEMENT', authoritativeExternalSettlementEvidence: true }), false);
assert.equal(countableRevenue({ state: 'SETTLED', authoritativeExternalSettlementEvidence: false }), false);
assert.equal(countableRevenue({ state: 'SETTLED', authoritativeExternalSettlementEvidence: true }), true);
assert.equal(idempotencyKey({ source: 'freelancer', externalId: '40684395', action: 'proposal', scopeVersion: '1' }), 'freelancer:40684395:proposal:1');

console.log('revenue-worker policy tests: PASS');
