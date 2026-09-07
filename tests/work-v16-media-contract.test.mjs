import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const manifestUrl = new URL('assets/media/hero/manifest.json', root);
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));

assert.deepEqual(
  { width: manifest.source.width, height: manifest.source.height, upscaled: manifest.source.upscaled },
  { width: 1672, height: 941, upscaled: false },
  'source truth boundary must stay 1672x941 with no upscale claim',
);

const expected = new Map([
  ['assets/media/hero/daube-bloom-768.avif', [768, 432, 'avif', 'desktop']],
  ['assets/media/hero/daube-bloom-768.webp', [768, 432, 'webp', 'desktop']],
  ['assets/media/hero/daube-bloom-1200.avif', [1200, 675, 'avif', 'desktop']],
  ['assets/media/hero/daube-bloom-1200.webp', [1200, 675, 'webp', 'desktop']],
  ['assets/media/hero/daube-bloom-1600.avif', [1600, 900, 'avif', 'desktop']],
  ['assets/media/hero/daube-bloom-1600.webp', [1600, 900, 'webp', 'desktop']],
  ['assets/media/hero/daube-bloom-mobile-706x941.avif', [706, 941, 'avif', 'mobile']],
  ['assets/media/hero/daube-bloom-mobile-706x941.webp', [706, 941, 'webp', 'mobile']],
]);

assert.equal(manifest.derivatives.length, expected.size, 'manifest must contain exactly the V16 responsive media pack');

for (const item of manifest.derivatives) {
  const exp = expected.get(item.file);
  assert.ok(exp, `unexpected derivative ${item.file}`);
  assert.deepEqual([item.width, item.height, item.format, item.role], exp, `${item.file}: dimensions/format/role mismatch`);
  assert.equal(item.upscaled, false, `${item.file}: upscaled must remain false`);
  assert.ok(item.width <= manifest.source.width, `${item.file}: derivative width exceeds source`);
  assert.ok(item.height <= manifest.source.height, `${item.file}: derivative height exceeds source`);
  assert.match(item.sha256, /^[a-f0-9]{64}$/, `${item.file}: sha256 receipt is required`);
  assert.ok(item.bytes > 0, `${item.file}: byte receipt is required`);
  await access(new URL(item.file, root));
}

assert.match(manifest.policy.truthBoundary, /No derivative exceeds source pixel dimensions/i);
assert.match(manifest.policy.mobileCrop, /706x941/);
console.log('WORK_V16_MEDIA_CONTRACT_PASS derivatives=8');
