import { createHash } from 'node:crypto';

const TRACKING_PARAMS = new Set([
  'fbclid', 'mibextid', 'ref', 'refsrc', 'ref_url', 'share_url', 'si',
  'utm_campaign', 'utm_content', 'utm_medium', 'utm_source', 'utm_term'
]);

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

export function normalizeMediaUrl(value) {
  if (!value) throw new Error('--url is required');
  const parsed = new URL(value);
  parsed.hash = '';
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) parsed.searchParams.delete(key);
  }
  parsed.searchParams.sort();
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.toString().replace(/\/$/, '');
}

export function stableSourceId(normalizedUrl) {
  return `media-${createHash('sha256').update(normalizedUrl).digest('hex').slice(0, 16)}`;
}
