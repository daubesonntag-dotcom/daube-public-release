import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateProjection} from '../scripts/institution/validate-maison-projection.mjs';

const canonical = JSON.parse(fs.readFileSync(new URL('../config/institution/maison-projection.v1.json', import.meta.url), 'utf8'));

test('canonical projection validates', () => assert.equal(validateProjection(structuredClone(canonical)), true));

test('missing MIC contract fails closed', () => {
  const bad = structuredClone(canonical);
  bad.canonicalContracts = bad.canonicalContracts.filter(id => id !== 'MIC-V18');
  assert.throws(() => validateProjection(bad), /missing canonical contract MIC-V18/);
});

test('candidate upstream cannot enable production adoption', () => {
  const bad = {...structuredClone(canonical), productionAdoptionAllowed: true};
  assert.throws(() => validateProjection(bad), /cannot enable production adoption/);
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
