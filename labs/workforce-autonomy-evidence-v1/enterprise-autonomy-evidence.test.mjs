import assert from "node:assert/strict";
import test from "node:test";
import { assertVerifiedAutonomousOperation, evaluateEnterpriseAutonomyEvidence } from "./enterprise-autonomy-evidence.mjs";

function succeeded(id, cycleKey, overrides = {}) {
  return {
    taskRunId: id,
    cycleKey,
    status: "succeeded",
    verificationResult: "PASS",
    evidenceRefs: [`public-safe://audit/${id}`],
    retryCount: 0,
    authorityLevel: "A1",
    ...overrides
  };
}

function greenFixture() {
  const records = Array.from({ length: 19 }, (_, index) => succeeded(`wft_${index}`, index < 10 ? "cycle-01" : "cycle-02"));
  records.push({
    taskRunId: "wft_reserved",
    cycleKey: "cycle-02",
    status: "review-required",
    verificationResult: "PASS",
    evidenceRefs: ["public-safe://audit/wft_reserved"],
    authorityLevel: "A3",
    founderInterventionRequired: true,
    escalationReason: "material_external_authority_required",
    retryCount: 0
  });
  return records;
}

test("repeatable evidence reaches GREEN only at explicit thresholds", () => {
  const report = evaluateEnterpriseAutonomyEvidence(greenFixture());
  assert.equal(report.verifiedAutonomousOperation, true);
  assert.equal(report.status, "GREEN");
  assert.equal(report.metrics.observedJobs, 20);
  assert.equal(report.metrics.distinctCycles, 2);
  assert.equal(report.metrics.autonomousCompletionRate, 0.95);
  assert.equal(report.metrics.founderInterventionRate, 0.05);
  assert.deepEqual(report.blockers, []);
});

test("empty and one-cycle evidence fail closed", () => {
  const empty = evaluateEnterpriseAutonomyEvidence([]);
  assert.equal(empty.verifiedAutonomousOperation, false);
  assert.ok(empty.blockers.includes("INSUFFICIENT_OBSERVED_JOBS"));
  assert.ok(empty.blockers.includes("INSUFFICIENT_REPEATABILITY_CYCLES"));

  const oneCycle = evaluateEnterpriseAutonomyEvidence(Array.from({ length: 20 }, (_, index) => succeeded(`single_${index}`, "cycle-01")));
  assert.equal(oneCycle.verifiedAutonomousOperation, false);
  assert.ok(oneCycle.blockers.includes("INSUFFICIENT_REPEATABILITY_CYCLES"));
});

test("unverified success and unknown states cannot be laundered GREEN", () => {
  const unverified = greenFixture();
  unverified[0] = { ...unverified[0], verificationResult: "UNKNOWN", evidenceRefs: [] };
  let report = evaluateEnterpriseAutonomyEvidence(unverified);
  assert.equal(report.verifiedAutonomousOperation, false);
  assert.ok(report.blockers.includes("SUCCESS_WITHOUT_VERIFICATION_EVIDENCE"));

  const unknown = greenFixture();
  unknown[0] = { ...unknown[0], status: "maybe-done" };
  report = evaluateEnterpriseAutonomyEvidence(unknown);
  assert.equal(report.verifiedAutonomousOperation, false);
  assert.ok(report.blockers.includes("UNKNOWN_OR_INVALID_JOB_STATE"));
});

test("retry success needs recovery evidence", () => {
  const records = greenFixture();
  records[0] = succeeded("retry_1", "cycle-01", { retryCount: 1 });
  let report = evaluateEnterpriseAutonomyEvidence(records);
  assert.equal(report.verifiedAutonomousOperation, false);
  assert.ok(report.blockers.includes("RETRY_SUCCESS_WITHOUT_RECOVERY_EVIDENCE"));

  records[0] = succeeded("retry_1", "cycle-01", { retryCount: 1, recoveryAction: "bounded_retry" });
  report = evaluateEnterpriseAutonomyEvidence(records);
  assert.equal(report.verifiedAutonomousOperation, true);
  assert.equal(report.metrics.recoveryRate, 1);
});

test("Founder intervention above threshold blocks autonomous verification", () => {
  const records = greenFixture();
  records[0] = { ...records[0], status: "review-required", authorityLevel: "A3", founderInterventionRequired: true, escalationReason: "founder_reserved" };
  const report = evaluateEnterpriseAutonomyEvidence(records);
  assert.equal(report.metrics.founderInterventionRate, 0.1);
  assert.equal(report.verifiedAutonomousOperation, false);
  assert.ok(report.blockers.includes("FOUNDER_INTERVENTION_RATE_ABOVE_THRESHOLD"));
});

test("assertion mode carries HOLD evidence", () => {
  assert.throws(() => assertVerifiedAutonomousOperation([]), error => {
    assert.equal(error.report.status, "HOLD");
    assert.match(error.message, /VERIFIED_AUTONOMOUS_OPERATION_HOLD/);
    return true;
  });
});
