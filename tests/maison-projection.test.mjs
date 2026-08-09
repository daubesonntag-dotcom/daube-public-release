import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateProjection} from '../scripts/institution/validate-maison-projection.mjs';

const canonical = JSON.parse(fs.readFileSync(new URL('../config/institution/maison-projection.v1.json', import.meta.url), 'utf8'));

test('verified canonical projection validates', () => {
  assert.equal(validateProjection(structuredClone(canonical)), true);
  assert.equal(canonical.upstreamState, 'verified-integrated');
  assert.equal(canonical.productionAdoptionAllowed, false);
});

test('missing MIC contract fails closed', () => {
  const bad = structuredClone(canonical);
  bad.canonicalContracts = bad.canonicalContracts.filter(id => id !== 'MIC-V18');
  assert.throws(() => validateProjection(bad), /missing canonical contract MIC-V18/);
});

test('verified upstream requires canonical evidence refs', () => {
  const bad = structuredClone(canonical);
  bad.canonicalEvidenceRefs = [];
  assert.throws(() => validateProjection(bad), /requires evidence refs/);
});

test('verified canonical upstream cannot directly enable site production adoption', () => {
  const bad = {...structuredClone(canonical), productionAdoptionAllowed: true};
  assert.throws(() => validateProjection(bad), /separate promotion contract/);
});

test('canonical verified does not equal product production verified truth boundary is mandatory', () => {
  const bad = structuredClone(canonical);
  bad.truthBoundary.canonicalUpstreamVerifiedDoesNotEqualProductProductionVerified = false;
  assert.throws(() => validateProjection(bad), /canonical\/product production truth boundary missing/);
});

test('high-risk authority cannot be silently enabled', () => {
  const bad = structuredClone(canonical);
  bad.authorityBoundary.mayChangeCredentials = true;
  assert.throws(() => validateProjection(bad), /must remain false/);
});

test('credential-like metadata fails closed', () => {
  const bad = {...structuredClone(canonical), api_key: 'never'};
  assert.throws(() => validateProjection(bad), /credential-like/);
});
