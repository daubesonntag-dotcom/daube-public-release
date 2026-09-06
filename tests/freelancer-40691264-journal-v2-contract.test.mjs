import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagePath = path.join(ROOT, 'labs/freelancer-40691264-journal-v2/index.html');

test('journal v2 keeps the submitted scope complete and every optional tier inside the posted $250 ceiling', async () => {
  const page = await readFile(pagePath, 'utf8');
  for (const expected of ['Studio Care Plus', '$129', 'Heirloom Edition', '$189', 'Collector Edition', '$249']) {
    assert.match(page, new RegExp(expected.replace('$', '\\$'), 'i'));
  }
  assert.doesNotMatch(page, /\$300/);
  assert.match(page, /original.*\$129.*remains complete/i);
  assert.match(page, /optional/i);
});

test('journal v2 is a truthful speculative proof and does not solicit off-platform contact or payment', async () => {
  const page = await readFile(pagePath, 'utf8');
  assert.match(page, /D’AUBE-owned speculative concept proof/i);
  assert.match(page, /not client work/i);
  assert.doesNotMatch(page, /mailto:|@[a-z0-9.-]+\.[a-z]{2,}|whatsapp|telegram|skype|stripe|paypal|payment link/i);
  assert.doesNotMatch(page, /most popular|limited time|act now|only \d+ spots|you(?:'|’)ll regret/i);
});

test('journal v2 exposes real interactive proof plus fit-first upgrade guidance', async () => {
  const page = await readFile(pagePath, 'utf8');
  for (const expected of ['data-page-next', 'data-note', 'localStorage', 'data-tier', 'Best when', 'Not needed when', 'prefers-reduced-motion']) {
    assert.match(page, new RegExp(expected, 'i'));
  }
});
