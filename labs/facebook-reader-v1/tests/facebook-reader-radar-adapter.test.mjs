import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  adaptFacebookReaderEnvelope,
  writeFacebookReaderRadarIntake
} from '../adapter/facebook-reader-radar-adapter.mjs';

function baseEnvelope(overrides = {}) {
  return {
    schema: 'daube.facebook-reader-envelope.v1',
    extractor_version: '0.1.0',
    reader_lane: 'active-tab-extension',
    reader_quality: 'full',
    source_type: 'post',
    source_url: 'https://www.facebook.com/share/19QXjD9LMi/?fbclid=tracking',
    canonical_url: 'https://facebook.com/posts/123?utm_source=feed',
    page_title: 'Example repository post',
    visible_text: ['Private contextual text should not survive into the Radar intake. Explicit project URL: https://github.com/ExampleOrg/Useful-Tool'],
    outbound_links: [
      { url: 'https://github.com/ExampleOrg/Useful-Tool?utm_source=facebook', label: 'GitHub' },
      { url: 'https://docs.example.org/guide?utm_source=facebook', label: 'Docs' },
      { url: 'https://private.example.org/view?access_token=do-not-persist', label: 'Sensitive link' }
    ],
    github_repos: ['ExampleOrg/Useful-Tool', 'other/example'],
    media: [],
    captured_at: '2026-08-29T09:30:00.000Z',
    provenance: { original_url: 'https://www.facebook.com/share/19QXjD9LMi/', authenticated_tab_selected_by_user: true },
    ...overrides
  };
}

test('converts social evidence into verification-only candidates', () => {
  const intake = adaptFacebookReaderEnvelope(baseEnvelope(), { now: '2026-08-29T09:31:00.000Z' });
  assert.equal(intake.source.normalized_url, 'https://facebook.com/share/19QXjD9LMi');
  assert.equal(intake.source.canonical_candidate_url, 'https://facebook.com/posts/123');
  assert.equal(intake.summary.github_candidate_count, 2);
  assert.equal(intake.summary.related_source_count, 1);
  assert.ok(intake.candidates.every(candidate => candidate.state === 'QUEUED_VERIFICATION'));
  assert.ok(intake.candidates.every(candidate => candidate.score === null && candidate.adoption_decision === null));
  assert.equal(intake.gates.direct_adoption_from_social_evidence_forbidden, true);
});

test('deduplicates candidate identity across evidence channels', () => {
  const intake = adaptFacebookReaderEnvelope(baseEnvelope());
  assert.deepEqual(intake.candidates.map(candidate => candidate.repo.toLowerCase()), ['exampleorg/useful-tool', 'other/example']);
  const useful = intake.candidates[0];
  assert.deepEqual(useful.discovered_by, ['envelope.github_repos', 'outbound-github-link', 'visible-text-github-url']);
});

test('drops sensitive URLs and strips tracking from public discovery links', () => {
  const intake = adaptFacebookReaderEnvelope(baseEnvelope());
  assert.deepEqual(intake.related_sources, [{ url: 'https://docs.example.org/guide', state: 'DISCOVERY_ONLY', canonical_verification_required: true }]);
  assert.doesNotMatch(JSON.stringify(intake), /do-not-persist|access_token/i);
});

test('rejects sensitive source queries and drops sensitive canonical candidates', () => {
  assert.throws(
    () => adaptFacebookReaderEnvelope(baseEnvelope({ source_url: 'https://facebook.com/posts/123?access_token=do-not-persist' })),
    /sensitive query parameters/
  );
  const intake = adaptFacebookReaderEnvelope(baseEnvelope({ canonical_url: 'https://facebook.com/posts/456?session_id=do-not-persist' }));
  assert.equal(intake.source.canonical_candidate_url, null);
  assert.doesNotMatch(JSON.stringify(intake), /do-not-persist|session_id/i);
});

test('trims sentence punctuation from visible-text GitHub repository URLs', () => {
  const intake = adaptFacebookReaderEnvelope(baseEnvelope({
    github_repos: [],
    outbound_links: [],
    visible_text: ['Useful project: https://github.com/acme/widget. Next sentence.']
  }));
  assert.deepEqual(intake.candidates.map(candidate => candidate.repo), ['acme/widget']);
  assert.deepEqual(intake.candidates[0].source_urls, ['https://github.com/acme/widget']);
});

test('fingerprints private visible text without persisting the body', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daube-facebook-radar-public-'));
  const marker = 'PRIVATE_FACEBOOK_BODY_SHOULD_NOT_BE_PERSISTED';
  const result = writeFacebookReaderRadarIntake(baseEnvelope({ visible_text: [`${marker} https://github.com/example/private-safe-name`] }), { outDir: root });
  const written = fs.readFileSync(result.outputPath, 'utf8');
  assert.doesNotMatch(written, new RegExp(marker));
  assert.match(written, /example\/private-safe-name/);
  assert.match(written, /evidence_fingerprint_sha256/);
});

test('fails closed on wrong origin, insecure URL, credentials, schema drift, unsupported lane and oversized input', () => {
  assert.throws(() => adaptFacebookReaderEnvelope(baseEnvelope({ source_url: 'https://example.com/post' })), /Facebook URL/);
  assert.throws(() => adaptFacebookReaderEnvelope(baseEnvelope({ source_url: 'http://facebook.com/posts/123' })), /HTTPS/);
  assert.throws(() => adaptFacebookReaderEnvelope(baseEnvelope({ source_url: 'https://user:pass@facebook.com/posts/123' })), /credentials/);
  assert.throws(() => adaptFacebookReaderEnvelope(baseEnvelope({ schema: 'unknown.v1' })), /Envelope schema/);
  assert.throws(() => adaptFacebookReaderEnvelope(baseEnvelope({ reader_lane: 'stealth-crawler' })), /Unsupported reader_lane/);
  assert.throws(() => adaptFacebookReaderEnvelope(baseEnvelope({ visible_text: ['x'.repeat(12_001)] })), /visible_text exceeds/);
});

test('preserves original provenance while normalizing routing identity', () => {
  const source = 'https://www.facebook.com/share/19QXjD9LMi/?fbclid=abc&utm_source=message';
  const intake = adaptFacebookReaderEnvelope(baseEnvelope({ source_url: source }));
  assert.equal(intake.source.original_url, source);
  assert.equal(intake.source.normalized_url, 'https://facebook.com/share/19QXjD9LMi');
});
