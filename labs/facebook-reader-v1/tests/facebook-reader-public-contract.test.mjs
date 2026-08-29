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
  assert.doesNotMatch(capture, /document\.cookie|localStorage|sessionStorage|chrome\.cookies|fetch\s*\(|XMLHttpRequest|WebSocket/i);
  assert.match(capture, /reader_lane:\s*'active-tab-extension'/);
  assert.match(capture, /authenticated_tab_selected_by_user:\s*true/);
});

test('popup requires an explicit current HTTPS Facebook tab', () => {
  assert.match(popup, /active:\s*true,\s*currentWindow:\s*true/);
  assert.match(popup, /parsed\.protocol === 'https:'/);
  assert.match(popup, /facebook\\\.com/);
  assert.match(popup, /frameIds:\s*\[0\]/);
});

test('Radar handoff excludes captured Facebook body text from query parameters', () => {
  assert.match(popup, /https:\/\/daubesonntag\.com\/radar\/share\//);
  assert.match(popup, /searchParams\.set\('url', lastEnvelope\.source_url\)/);
  assert.doesNotMatch(popup, /searchParams\.set\(['"]text['"]/);
});
