import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../surface-fabric/index.html', import.meta.url), 'utf8');
const reserved = ['app','api','assets','cloud','compute','docs','edge','lab','preview','status'];

test('shared technical fabric is a search-safe placeholder rather than a marketed live service', () => {
  assert.match(html, /name="robots" content="noindex,nofollow,noarchive"/);
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /RESERVED · NO LIVE-SERVICE CLAIM/);
  assert.match(html, /does not verify an application, API or service is live/);
  assert.doesNotMatch(html, /ONLINE · Cloudflare Edge|100% uptime|99\.9%/);
});

test('shared shell keeps unique host labels without merging an app or API', () => {
  const match = html.match(/const M=({.*?});let k=location\.hostname/s);
  assert.ok(match, 'host display registry missing');
  for (const host of reserved) {
    assert.ok(new RegExp('(?:^|[,{}])'+host+':\\[').test(match[1]), 'Missing '+host);
  }
  assert.match(html, /location\.hostname\.split/);
  assert.match(html, /Surface unavailable/);
  assert.doesNotMatch(html, /fetch\(|XMLHttpRequest|localStorage|sessionStorage/);
});

test('minimal static page does not expose secrets or privileged actions', () => {
  assert.doesNotMatch(html, /CLOUDFLARE_API_TOKEN|BEGIN PRIVATE KEY|service_role_key|PASSWORD=|<form/i);
  assert.ok(html.length < 4500, 'shared placeholder unexpectedly large');
});
