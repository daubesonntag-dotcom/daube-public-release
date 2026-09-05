import fs from 'node:fs/promises';

const policy = JSON.parse(await fs.readFile(new URL('./policy.json', import.meta.url), 'utf8'));
const stateContract = JSON.parse(await fs.readFile(new URL('./state-machine.json', import.meta.url), 'utf8'));

export function qualifyOpportunity(opportunity) {
  const value = Number(opportunity?.fixedValueUsd ?? 0);
  if (!Number.isFinite(value) || value < policy.minValueUsd) {
    return { admitted: false, reason: 'BELOW_MIN_VALUE' };
  }
  if (opportunity?.requiresPaidSpend) return { admitted: false, reason: 'PAID_SPEND' };
  if (opportunity?.requiresIdentityMisrepresentation) return { admitted: false, reason: 'IDENTITY_MISREPRESENTATION' };
  if (opportunity?.requiresOffPlatformPayment) return { admitted: false, reason: 'OFF_PLATFORM_PAYMENT' };
  if (opportunity?.unboundedScope) return { admitted: false, reason: 'UNBOUNDED_SCOPE' };
  if (opportunity?.regulatedHighLiability) return { admitted: false, reason: 'HIGH_LIABILITY' };
  return { admitted: true, reason: 'QUALIFIED' };
}

export function contractDecision(contract) {
  const value = Number(contract?.totalValueUsd ?? 0);
  const gated = [
    contract?.requiresKyc,
    contract?.requiresOtp,
    contract?.requiresCaptcha,
    contract?.nonStandardLegal,
    contract?.taxChange,
    contract?.payoutChange,
    contract?.requiresPaidSpend,
    contract?.unusualLiability,
    contract?.credentialSharing,
    contract?.identityMisrepresentation,
    contract?.offPlatformPayment,
  ].some(Boolean);
  if (gated) return { action: 'FOUNDER_CONTRACT_GATE' };
  if (!contract?.platformNativeFixedPrice) return { action: 'FOUNDER_CONTRACT_GATE' };
  if (!(value >= policy.minValueUsd && value <= policy.maxStandardContractUsd)) return { action: 'FOUNDER_CONTRACT_GATE' };
  if (Number(contract?.deliveryHours ?? Infinity) > policy.maxDeliveryHours && !contract?.explicitlyPhased) return { action: 'FOUNDER_CONTRACT_GATE' };
  if (!contract?.objectiveAcceptanceCriteria) return { action: 'FOUNDER_CONTRACT_GATE' };
  if (contract?.platformProvidesFundingProtection && !contract?.fundingProtectionVisible) return { action: 'FOUNDER_CONTRACT_GATE' };
  return { action: 'ACCEPT_STANDARD' };
}

export function externalWriteDecision(adapter) {
  if (!adapter?.official || !adapter?.authenticated || !adapter?.permitsExactAction) {
    return { action: 'FOUNDER_PLATFORM_GATE' };
  }
  return { action: 'OFFICIAL_SUBMIT' };
}

export function countableRevenue(event) {
  return event?.state === stateContract.revenueCountState && event?.authoritativeExternalSettlementEvidence === true;
}

export function idempotencyKey({ source, externalId, action, scopeVersion = '1' }) {
  if (!source || !externalId || !action) throw new Error('source, externalId and action are required');
  return `${source}:${externalId}:${action}:${scopeVersion}`;
}
