#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeMediaUrl, parseArgs, stableSourceId } from './media-research-compat.mjs';

const ENVELOPE_SCHEMA = 'daube.facebook-reader-envelope.v1';
const OUTPUT_SCHEMA = 'daube.facebook-reader-radar-intake.v1';
const ALLOWED_READER_LANES = new Set(['active-tab-extension', 'cloud-browser', 'evidence-upload']);
const MAX_VISIBLE_TEXT_BLOCKS = 64;
const MAX_VISIBLE_TEXT_TOTAL = 12_000;
const MAX_OUTBOUND_LINKS = 200;
const MAX_REPO_CANDIDATES = 100;
const MAX_RELATED_SOURCES = 100;
const SENSITIVE_QUERY_KEYS = new Set([
  'access_token', 'auth', 'auth_token', 'authorization', 'code', 'credential', 'jwt', 'key',
  'password', 'secret', 'session', 'session_id', 'sig', 'signature', 'state', 'token'
]);
const TRACKING_QUERY_KEYS = new Set([
  'fbclid', 'gclid', 'mibextid', 'ref', 'refsrc', 'ref_url', 'share_url', 'si',
  'utm_campaign', 'utm_content', 'utm_medium', 'utm_source', 'utm_term'
]);

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function boundedString(value, maxLength) { return typeof value === 'string' ? value.slice(0, maxLength) : ''; }
function isFacebookHost(hostname) { return /(^|\.)facebook\.com$/i.test(hostname) || hostname.toLowerCase() === 'fb.watch'; }
function hasSensitiveQueryKey(parsed) {
  for (const key of parsed.searchParams.keys()) {
    const lower = key.toLowerCase();
    if (SENSITIVE_QUERY_KEYS.has(lower) || /(?:token|secret|password|credential|session|signature|auth)/i.test(lower)) return true;
  }
  return false;
}

function parseHttpsFacebookUrl(value, label) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${label} must be a valid URL`); }
  if (parsed.protocol !== 'https:') throw new Error(`${label} must use HTTPS`);
  if (!isFacebookHost(parsed.hostname)) throw new Error(`${label} must be a Facebook URL`);
  if (parsed.username || parsed.password) throw new Error(`${label} must not contain URL credentials`);
  if (hasSensitiveQueryKey(parsed)) throw new Error(`${label} must not contain sensitive query parameters`);
  return parsed;
}

function safeFacebookCandidate(value) {
  if (!value) return null;
  try { return normalizeMediaUrl(parseHttpsFacebookUrl(value, 'canonical_url').toString()); } catch { return null; }
}

function normalizeRepo(owner, repo) {
  const cleanOwner = String(owner || '').trim();
  const cleanRepo = String(repo || '').trim().replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(cleanOwner)) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(cleanRepo)) return null;
  return `${cleanOwner}/${cleanRepo}`;
}

function repoFromGithubUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') return null;
    if (parsed.username || parsed.password) return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts.length < 2 ? null : normalizeRepo(parts[0], parts[1]);
  } catch { return null; }
}

function sanitizePublicRelatedUrl(value) {
  try {
    const parsed = new URL(value);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    if (hasSensitiveQueryKey(parsed)) return null;
    for (const key of [...parsed.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (TRACKING_QUERY_KEYS.has(lower) || lower.startsWith('utm_')) parsed.searchParams.delete(key);
    }
    parsed.hash = '';
    parsed.searchParams.sort();
    return parsed.toString();
  } catch { return null; }
}

function validateEnvelopeShape(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('Envelope must be an object');
  if (envelope.schema !== ENVELOPE_SCHEMA) throw new Error(`Envelope schema must be ${ENVELOPE_SCHEMA}`);
  if (!ALLOWED_READER_LANES.has(envelope.reader_lane)) throw new Error(`Unsupported reader_lane: ${envelope.reader_lane}`);
  if (!['full', 'partial'].includes(envelope.reader_quality)) throw new Error('reader_quality must be full or partial');
  if (!Array.isArray(envelope.visible_text)) throw new Error('visible_text must be an array');
  if (!Array.isArray(envelope.outbound_links)) throw new Error('outbound_links must be an array');
  if (!Array.isArray(envelope.github_repos)) throw new Error('github_repos must be an array');
  if (envelope.visible_text.length > MAX_VISIBLE_TEXT_BLOCKS) throw new Error(`visible_text exceeds ${MAX_VISIBLE_TEXT_BLOCKS} blocks`);
  if (envelope.outbound_links.length > MAX_OUTBOUND_LINKS) throw new Error(`outbound_links exceeds ${MAX_OUTBOUND_LINKS} entries`);
  if (envelope.github_repos.length > MAX_REPO_CANDIDATES) throw new Error(`github_repos exceeds ${MAX_REPO_CANDIDATES} entries`);
  const totalText = envelope.visible_text.reduce((sum, block) => sum + (typeof block === 'string' ? block.length : 0), 0);
  if (totalText > MAX_VISIBLE_TEXT_TOTAL) throw new Error(`visible_text exceeds ${MAX_VISIBLE_TEXT_TOTAL} characters`);
  return totalText;
}

function collectRepoCandidates(envelope) {
  const byKey = new Map();
  const add = (repo, discovery, sourceUrl = null) => {
    if (!repo) return;
    const key = repo.toLowerCase();
    const existing = byKey.get(key) ?? { repo, discovered_by: new Set(), source_urls: new Set() };
    existing.discovered_by.add(discovery);
    if (sourceUrl) existing.source_urls.add(sourceUrl);
    byKey.set(key, existing);
  };
  for (const raw of envelope.github_repos) {
    if (typeof raw !== 'string') continue;
    const parts = raw.split('/').filter(Boolean);
    if (parts.length >= 2) add(normalizeRepo(parts[0], parts[1]), 'envelope.github_repos');
  }
  for (const link of envelope.outbound_links) {
    if (!link || typeof link !== 'object') continue;
    const url = sanitizePublicRelatedUrl(link.url);
    if (url) add(repoFromGithubUrl(url), 'outbound-github-link', url);
  }
  const githubUrlRegex = /https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9][A-Za-z0-9._-]{0,99})/giu;
  for (const block of envelope.visible_text) {
    if (typeof block !== 'string') continue;
    let match;
    while ((match = githubUrlRegex.exec(block)) !== null) {
      const visibleRepoName = match[2].replace(/\.+$/u, '');
      const repo = normalizeRepo(match[1], visibleRepoName);
      add(repo, 'visible-text-github-url', repo ? `https://github.com/${repo}` : null);
    }
  }
  return [...byKey.values()].sort((a, b) => a.repo.toLowerCase().localeCompare(b.repo.toLowerCase())).map(item => ({
    candidate_id: `github-${sha256(item.repo.toLowerCase()).slice(0, 16)}`,
    repo: item.repo,
    discovered_by: [...item.discovered_by].sort(),
    source_urls: [...item.source_urls].sort(),
    state: 'QUEUED_VERIFICATION',
    canonical_verification_required: true,
    license_verification_required: true,
    maintenance_verification_required: true,
    security_surface_review_required: true,
    sandbox_required_before_adoption: true,
    adoption_decision: null,
    score: null
  }));
}

function collectRelatedSources(envelope) {
  const urls = new Set();
  for (const link of envelope.outbound_links) {
    if (!link || typeof link !== 'object') continue;
    const safe = sanitizePublicRelatedUrl(link.url);
    if (!safe || repoFromGithubUrl(safe)) continue;
    try { if (isFacebookHost(new URL(safe).hostname)) continue; } catch { continue; }
    urls.add(safe);
    if (urls.size >= MAX_RELATED_SOURCES) break;
  }
  return [...urls].sort().map(url => ({ url, state: 'DISCOVERY_ONLY', canonical_verification_required: true }));
}

export function adaptFacebookReaderEnvelope(envelope, options = {}) {
  const visibleTextChars = validateEnvelopeShape(envelope);
  const sourceParsed = parseHttpsFacebookUrl(envelope.source_url, 'source_url');
  const originalUrl = sourceParsed.toString();
  const normalizedUrl = normalizeMediaUrl(originalUrl);
  const sourceId = stableSourceId(normalizedUrl);
  const canonicalCandidateUrl = safeFacebookCandidate(envelope.canonical_url);
  const visibleText = envelope.visible_text.filter(value => typeof value === 'string').join('\n');
  const candidates = collectRepoCandidates(envelope);
  const relatedSources = collectRelatedSources(envelope);
  return {
    schema: OUTPUT_SCHEMA,
    generated_at: options.now ?? new Date().toISOString(),
    source: {
      source_id: sourceId, platform: 'Facebook', original_url: originalUrl, normalized_url: normalizedUrl,
      canonical_candidate_url: canonicalCandidateUrl,
      source_type: boundedString(envelope.source_type, 64) || 'facebook-page',
      page_title: boundedString(envelope.page_title, 500) || null,
      captured_at: boundedString(envelope.captured_at, 64) || null,
      reader_lane: envelope.reader_lane, reader_quality: envelope.reader_quality,
      extractor_version: boundedString(envelope.extractor_version, 64) || null,
      evidence_fingerprint_sha256: visibleText ? sha256(visibleText) : null,
      visible_text_character_count: visibleTextChars
    },
    privacy: { visible_text_persisted: false, cookies_persisted: false, credentials_persisted: false, sensitive_query_urls_dropped: true, raw_envelope_should_remain_in_authorized_intake_boundary: true },
    candidates,
    related_sources: relatedSources,
    gates: {
      facebook_evidence_is_discovery_evidence_only: true,
      canonical_upstream_verification_required: true,
      license_and_attribution_required: true,
      dependency_security_telemetry_network_filesystem_process_secret_review_required: true,
      direct_adoption_from_social_evidence_forbidden: true,
      runtime_live_claim_requires_sandbox_or_canary_evidence: true,
      unlicensed_or_ambiguous_code_must_not_be_copied: true,
      useful_blocked_concepts_may_be_independently_reimplemented: true
    },
    summary: { github_candidate_count: candidates.length, related_source_count: relatedSources.length, next_stage: candidates.length || relatedSources.length ? 'OPEN_SOURCE_RADAR_VERIFICATION' : 'NO_PUBLIC_CANDIDATES_FOUND' }
  };
}

export function writeFacebookReaderRadarIntake(envelope, options = {}) {
  const intake = adaptFacebookReaderEnvelope(envelope, options);
  const sourceDir = path.join(path.resolve(options.outDir ?? 'build/facebook-reader-radar'), intake.source.source_id);
  fs.mkdirSync(sourceDir, { recursive: true });
  const outputPath = path.join(sourceDir, 'radar-intake.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(intake, null, 2)}\n`, 'utf8');
  return { intake, outputPath };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.input) throw new Error('--input is required');
    const envelope = JSON.parse(fs.readFileSync(path.resolve(args.input), 'utf8'));
    const result = writeFacebookReaderRadarIntake(envelope, { outDir: args.out });
    console.log(args.json ? JSON.stringify(result.intake, null, 2) : result.outputPath);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}
