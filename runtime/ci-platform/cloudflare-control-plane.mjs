const API_ROOT = 'https://api.cloudflare.com/client/v4';
const DEFAULT_ZONE = 'daubesonntag.com';

function cleanToken(token) {
  return String(token || '').trim();
}

function safeError(error) {
  const value = error instanceof Error ? error.message : String(error || 'unknown');
  return value.replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]').slice(0, 500);
}

async function cfApi({ token, pathname, search, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const url = new URL(`${API_ROOT}${pathname}`);
  for (const [key, value] of Object.entries(search || {})) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  const response = await fetchImpl(url, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(Math.max(500, Math.min(Number(timeoutMs) || 8000, 30000))),
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.success !== true) {
    const message = body?.errors?.[0]?.message || `http_${response.status}`;
    throw new Error(`cloudflare_api_failed:${message}`);
  }
  return body;
}

export function assertCloudflareMutationAuthorized({ action, zoneName, policy } = {}) {
  if (policy?.approved !== true) throw new Error('cloudflare_mutation_not_approved');
  if (policy?.noPaidSpendAuthorization !== true) throw new Error('cloudflare_paid_spend_not_forbidden');
  if (String(zoneName || '').toLowerCase() !== String(policy.zoneName || '').toLowerCase()) throw new Error('cloudflare_mutation_zone_not_allowed');
  if (!(policy.allowedActions || []).includes(String(action || ''))) throw new Error('cloudflare_mutation_action_not_allowed');
  return true;
}

export async function probeCloudflareControlPlane({
  token,
  zoneName = DEFAULT_ZONE,
  fetchImpl = fetch,
  timeoutMs = 8000,
} = {}) {
  const bearer = cleanToken(token);
  if (!bearer) return { status: 'HOLD_CLOUDFLARE_TOKEN_MISSING', tokenVerified: false, zone: null, dnsRecordCount: null, pages: { visible: false, projectCount: null, projectNames: [] } };

  try {
    const accountOwned = bearer.startsWith('cfat_');
    let tokenVerified = false;
    if (!accountOwned) {
      const verification = await cfApi({ token: bearer, pathname: '/user/tokens/verify', fetchImpl, timeoutMs });
      tokenVerified = verification?.result?.status === 'active';
      if (!tokenVerified) return { status: 'HOLD_CLOUDFLARE_TOKEN_INACTIVE', tokenVerified: false, zone: null, dnsRecordCount: null, pages: { visible: false, projectCount: null, projectNames: [] } };
    }
    const zones = await cfApi({ token: bearer, pathname: '/zones', search: { name: zoneName, status: 'active', per_page: 5 }, fetchImpl, timeoutMs });
    const exact = (zones.result || []).filter((zone) => String(zone?.name || '').toLowerCase() === String(zoneName).toLowerCase());
    if (exact.length !== 1) return { status: exact.length === 0 ? 'HOLD_CLOUDFLARE_ZONE_NOT_FOUND' : 'HOLD_CLOUDFLARE_ZONE_AMBIGUOUS', tokenVerified, zone: null, dnsRecordCount: null, pages: { visible: false, projectCount: null, projectNames: [] } };
    const rawZone = exact[0];
    const zone = {
      id: String(rawZone.id || ''),
      name: String(rawZone.name || ''),
      status: String(rawZone.status || ''),
      accountId: String(rawZone.account?.id || ''),
    };
    if (accountOwned) {
      if (!zone.accountId) return { status: 'HOLD_CLOUDFLARE_ACCOUNT_ID_MISSING', tokenVerified: false, zone, dnsRecordCount: null, pages: { visible: false, projectCount: null, projectNames: [] } };
      const verification = await cfApi({ token: bearer, pathname: `/accounts/${encodeURIComponent(zone.accountId)}/tokens/verify`, fetchImpl, timeoutMs });
      tokenVerified = verification?.result?.status === 'active';
      if (!tokenVerified) return { status: 'HOLD_CLOUDFLARE_TOKEN_INACTIVE', tokenVerified: false, zone, dnsRecordCount: null, pages: { visible: false, projectCount: null, projectNames: [] } };
    }
    const dns = await cfApi({ token: bearer, pathname: `/zones/${encodeURIComponent(zone.id)}/dns_records`, search: { per_page: 100 }, fetchImpl, timeoutMs });
    const dnsRecordCount = Number(dns?.result_info?.total_count ?? dns?.result?.length ?? 0);
    let pages = { visible: false, projectCount: null, projectNames: [] };
    if (zone.accountId) {
      try {
        const projects = await cfApi({ token: bearer, pathname: `/accounts/${encodeURIComponent(zone.accountId)}/pages/projects`, search: { per_page: 100 }, fetchImpl, timeoutMs });
        const names = (projects.result || []).map((project) => String(project?.name || '')).filter(Boolean).sort();
        pages = { visible: true, projectCount: names.length, projectNames: names };
      } catch {}
    }
    return {
      status: pages.visible ? 'READY' : 'READY_DNS_ONLY',
      tokenVerified: true,
      zone,
      dnsRecordCount,
      pages,
    };
  } catch (error) {
    return { status: 'HOLD_CLOUDFLARE_API_UNAVAILABLE', tokenVerified: false, zone: null, dnsRecordCount: null, pages: { visible: false, projectCount: null, projectNames: [] }, blocker: safeError(error) };
  }
}
