import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../extension/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
const capture = await readFile(new URL('capture.js', root), 'utf8');
const popup = await readFile(new URL('popup.js', root), 'utf8');

const sorted = (items) => [...items].sort();

test('public fixture is Manifest V3 with exact least-privilege permissions', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(sorted(manifest.permissions), sorted(['activeTab', 'scripting']));
  assert.equal(manifest.host_permissions, undefined);
  assert.doesNotMatch(JSON.stringify(manifest), /cookies|webRequest|<all_urls>/i);
});

test('capture is bounded and does not touch browser credential/session stores or network', () => {
  assert.match(capture, /MAX_TEXT_TOTAL\s*=\s*6000/);
  assert.match(capture, /MAX_LINKS\s*=\s*100/);
  assert.match(capture, /SENSITIVE_QUERY_KEYS/);
  assert.match(capture, /hasSensitiveQueryKey/);
  assert.doesNotMatch(capture, /document\.cookie|localStorage|sessionStorage|chrome\.cookies|fetch\s*\(|XMLHttpRequest|WebSocket/i);
  assert.match(capture, /reader_lane:\s*'active-tab-extension'/);
  assert.match(capture, /authenticated_tab_selected_by_user:\s*true/);
});

test('compact context stays local, bounded and free of a second network reader', () => {
  assert.match(capture, /MAX_COMPACT_TEXT\s*=\s*3000/);
  assert.match(capture, /MAX_COMPACT_LINKS\s*=\s*24/);
  assert.match(capture, /compact_context:\s*compactContext/);
  assert.match(capture, /compact_context_characters:\s*compactContext\.length/);
  assert.doesNotMatch(capture, /navigator\.sendBeacon|EventSource|chrome\.runtime\.connectNative/i);
});

test('local OCR is an offline hint and does not silently capture image pixels', () => {
  assert.match(capture, /local_ocr_recommended:\s*localOcrRecommended/);
  assert.match(capture, /local_ocr_mode:\s*'offline-user-authorized-region'/);
  assert.match(capture, /network_allowed_for_ocr:\s*false/);
  assert.match(capture, /image_pixels_captured_by_extension:\s*false/);
  assert.match(capture, /textBudget\s*<\s*160\s*&&\s*imageEvidenceCount\s*>\s*0/);
  assert.doesNotMatch(capture, /getImageData|toDataURL|captureVisibleTab|drawImage|OffscreenCanvas/i);
});

test('outbound URLs reject sensitive queries and strip tracking before evidence admission', () => {
  assert.match(capture, /TRACKING_QUERY_KEYS/);
  assert.match(capture, /SENSITIVE_QUERY_KEYS/);
  assert.match(capture, /normalizeUrl\(anchor\.href,\s*\{\s*stripTracking:\s*true\s*\}\)/);
  assert.match(capture, /lower\.startsWith\('utm_'\)/);
});

test('popup requires an explicit current HTTPS Facebook tab', () => {
  assert.match(popup, /active:\s*true,\s*currentWindow:\s*true/);
  assert.match(popup, /parsed\.protocol === 'https:'/);
  assert.match(popup, /facebook\\\.com/);
  assert.match(popup, /frameIds:\s*\[0\]/);
});

test('Radar handoff excludes captured Facebook body and compact context from query parameters', () => {
  assert.match(popup, /https:\/\/daubesonntag\.com\/radar\/share\//);
  assert.match(popup, /searchParams\.set\('url', lastEnvelope\.source_url\)/);
  assert.doesNotMatch(popup, /searchParams\.set\(['"]text['"]/);
  assert.doesNotMatch(popup, /searchParams\.set\(['"]compact/i);
});
