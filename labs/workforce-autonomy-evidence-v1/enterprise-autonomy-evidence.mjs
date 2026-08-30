const PASS_RESULTS = new Set(["pass", "passed", "verified", "green", "true"]);
const SUCCESS_STATES = new Set(["succeeded"]);
const ESCALATION_STATES = new Set(["review-required", "blocked"]);
const KNOWN_STATES = new Set(["queued", "running", "retrying", "deferred", "succeeded", "failed", "canceled", "review-required", "blocked", "superseded"]);

const DEFAULT_POLICY = Object.freeze({
  schema: "daube.workforce.enterprise-autonomy-evidence-policy.v1",
  minimumObservedJobs: 10,
  minimumDistinctCycles: 2,
  minimumAutonomousCompletionRate: 0.95,
  maximumFounderInterventionRate: 0.05,
  requireVerifiedSuccessfulJobs: true,
  requireZeroUnknownStates: true,
  requireRecoveryEvidenceWhenRetriesExist: true
});

function normalizedString(value) { return String(value ?? "").trim(); }
function normalizedLower(value) { return normalizedString(value).toLowerCase(); }
function boundedRate(numerator, denominator) { return denominator ? Number((numerator / denominator).toFixed(6)) : 0; }
function finiteInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}
function validEvidenceRef(value) { return typeof value === "string" && value.trim().length > 0; }
function verificationPassed(record) {
  return record.verificationPassed === true || PASS_RESULTS.has(normalizedLower(record.verificationResult));
}
function founderIntervention(record) {
  if (record.founderIntervention === true || record.founderInterventionRequired === true) return true;
  return normalizedLower(record.authorityLevel) === "a3" && normalizedLower(record.status) === "review-required";
}
function retryRecovered(record) {
  const retryCount = finiteInteger(record.retryCount ?? record.attempt, 0);
  return retryCount > 0 && SUCCESS_STATES.has(normalizedLower(record.status)) && Boolean(normalizedString(record.recoveryAction));
}
function normalizedPolicy(overrides = {}) {
  const policy = { ...DEFAULT_POLICY, ...(overrides || {}) };
  for (const key of ["minimumObservedJobs", "minimumDistinctCycles"]) policy[key] = finiteInteger(policy[key], DEFAULT_POLICY[key]);
  for (const key of ["minimumAutonomousCompletionRate", "maximumFounderInterventionRate"]) {
    const value = Number(policy[key]);
    policy[key] = Number.isFinite(value) && value >= 0 && value <= 1 ? value : DEFAULT_POLICY[key];
  }
  return Object.freeze(policy);
}

export function evaluateEnterpriseAutonomyEvidence(records = [], overrides = {}) {
  if (!Array.isArray(records)) throw new TypeError("autonomy evidence records must be an array");
  const policy = normalizedPolicy(overrides);
  const normalized = records.map((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return { index, invalid: true, status: "unknown", id: "" };
    const id = normalizedString(record.jobId ?? record.taskRunId ?? record.id);
    const status = normalizedLower(record.status);
    const retryCount = finiteInteger(record.retryCount ?? record.attempt, 0);
    const cycle = normalizedString(record.cycleKey ?? record.cycleId ?? record.observationCycle);
    const evidenceRefs = Array.isArray(record.evidenceRefs)
      ? record.evidenceRefs.filter(validEvidenceRef)
      : validEvidenceRef(record.evidenceRef) ? [record.evidenceRef.trim()] : [];
    return {
      index,
      invalid: !id || !KNOWN_STATES.has(status),
      id, status, retryCount, cycle,
      verificationPassed: verificationPassed(record),
      evidenceRefs,
      recoveryAction: normalizedString(record.recoveryAction),
      escalationReason: normalizedString(record.escalationReason),
      founderIntervention: founderIntervention(record),
      recovered: retryRecovered(record)
    };
  });

  const observedJobs = normalized.length;
  const invalid = normalized.filter(record => record.invalid);
  const successful = normalized.filter(record => SUCCESS_STATES.has(record.status));
  const verifiedSuccessful = successful.filter(record => record.verificationPassed && record.evidenceRefs.length > 0);
  const retried = normalized.filter(record => record.retryCount > 0);
  const recovered = normalized.filter(record => record.recovered);
  const escalated = normalized.filter(record => ESCALATION_STATES.has(record.status) || record.escalationReason);
  const founderInterventions = normalized.filter(record => record.founderIntervention);
  const distinctCycles = new Set(normalized.map(record => record.cycle).filter(Boolean));
  const successfulButUnverified = successful.filter(record => !record.verificationPassed || record.evidenceRefs.length === 0);
  const retriedWithoutRecoveryEvidence = retried.filter(record => SUCCESS_STATES.has(record.status) && !record.recovered);

  const autonomousCompletionRate = boundedRate(verifiedSuccessful.length, observedJobs);
  const founderInterventionRate = boundedRate(founderInterventions.length, observedJobs);
  const recoveryRate = boundedRate(recovered.length, retried.length);
  const escalationRate = boundedRate(escalated.length, observedJobs);

  const blockers = [];
  if (observedJobs < policy.minimumObservedJobs) blockers.push("INSUFFICIENT_OBSERVED_JOBS");
  if (distinctCycles.size < policy.minimumDistinctCycles) blockers.push("INSUFFICIENT_REPEATABILITY_CYCLES");
  if (policy.requireZeroUnknownStates && invalid.length > 0) blockers.push("UNKNOWN_OR_INVALID_JOB_STATE");
  if (policy.requireVerifiedSuccessfulJobs && successfulButUnverified.length > 0) blockers.push("SUCCESS_WITHOUT_VERIFICATION_EVIDENCE");
  if (policy.requireRecoveryEvidenceWhenRetriesExist && retriedWithoutRecoveryEvidence.length > 0) blockers.push("RETRY_SUCCESS_WITHOUT_RECOVERY_EVIDENCE");
  if (autonomousCompletionRate < policy.minimumAutonomousCompletionRate) blockers.push("AUTONOMOUS_COMPLETION_RATE_BELOW_THRESHOLD");
  if (founderInterventionRate > policy.maximumFounderInterventionRate) blockers.push("FOUNDER_INTERVENTION_RATE_ABOVE_THRESHOLD");

  const verifiedAutonomousOperation = blockers.length === 0;
  return Object.freeze({
    schema: "daube.workforce.enterprise-autonomy-evidence-report.v1",
    policy,
    status: verifiedAutonomousOperation ? "GREEN" : "HOLD",
    verifiedAutonomousOperation,
    metrics: Object.freeze({
      observedJobs, distinctCycles: distinctCycles.size,
      successfulJobs: successful.length, verifiedSuccessfulJobs: verifiedSuccessful.length,
      autonomousCompletionRate, retriedJobs: retried.length, recoveredJobs: recovered.length,
      recoveryRate, escalatedJobs: escalated.length, escalationRate,
      founderInterventions: founderInterventions.length, founderInterventionRate,
      invalidJobs: invalid.length, successfulButUnverifiedJobs: successfulButUnverified.length
    }),
    blockers: Object.freeze([...new Set(blockers)]),
    evidence: Object.freeze({
      invalidJobIds: invalid.map(record => record.id || `record:${record.index}`),
      successfulButUnverifiedJobIds: successfulButUnverified.map(record => record.id),
      retrySuccessWithoutRecoveryEvidenceJobIds: retriedWithoutRecoveryEvidence.map(record => record.id),
      founderInterventionJobIds: founderInterventions.map(record => record.id),
      escalatedJobIds: escalated.map(record => record.id)
    }),
    truthBoundary: Object.freeze({
      evaluatorDoesNotExecuteJobs: true,
      evaluatorDoesNotInventRuntimeEvidence: true,
      greenRequiresObservedEvidence: true,
      greenDoesNotGrantMergeAuthority: true,
      greenDoesNotGrantProductionDeployAuthority: true
    })
  });
}

export function assertVerifiedAutonomousOperation(records = [], overrides = {}) {
  const report = evaluateEnterpriseAutonomyEvidence(records, overrides);
  if (!report.verifiedAutonomousOperation) {
    const error = new Error(`VERIFIED_AUTONOMOUS_OPERATION_HOLD: ${report.blockers.join(",") || "UNKNOWN"}`);
    error.report = report;
    throw error;
  }
  return report;
}

export { DEFAULT_POLICY as ENTERPRISE_AUTONOMY_EVIDENCE_POLICY };
