(() => {
  'use strict';

  const EXTRACTOR_VERSION = '0.2.0';
  const MAX_TEXT_TOTAL = 6000;
  const MAX_TEXT_BLOCK = 2000;
  const MAX_COMPACT_TEXT = 3000;
  const MAX_COMPACT_LINKS = 24;
  const MAX_LINKS = 100;
  const MAX_MEDIA = 20;
  const TRACKING_QUERY_KEYS = new Set([
    'fbclid', 'gclid', 'mibextid', 'ref', 'refsrc', 'ref_url', 'share_url', 'si',
    'utm_campaign', 'utm_content', 'utm_medium', 'utm_source', 'utm_term'
  ]);
  const SENSITIVE_QUERY_KEYS = new Set([
    'access_token', 'auth', 'auth_token', 'authorization', 'code', 'credential', 'jwt', 'key',
    'password', 'secret', 'session', 'session_id', 'sig', 'signature', 'state', 'token'
  ]);

  const isHttp = (url) => url && (url.protocol === 'https:' || url.protocol === 'http:');
  const isFacebookHost = (host) => /(^|\.)facebook\.com$/i.test(host);

  const hasSensitiveQueryKey = (parsed) => {
    for (const key of parsed.searchParams.keys()) {
      const lower = key.toLowerCase();
      if (SENSITIVE_QUERY_KEYS.has(lower) || /(?:token|secret|password|credential|session|signature|auth)/i.test(lower)) return true;
    }
    return false;
  };

  const sanitizeParsedUrl = (parsed, { stripTracking = false } = {}) => {
    if (!isHttp(parsed) || parsed.username || parsed.password || hasSensitiveQueryKey(parsed)) return null;
    if (stripTracking) {
      for (const key of [...parsed.searchParams.keys()]) {
        const lower = key.toLowerCase();
        if (TRACKING_QUERY_KEYS.has(lower) || lower.startsWith('utm_')) parsed.searchParams.delete(key);
      }
      parsed.searchParams.sort();
      parsed.hash = '';
    }
    return parsed.toString();
  };

  const normalizeUrl = (value, options = {}) => {
    try {
      const parsed = new URL(value, location.href);
      if (!isHttp(parsed)) return null;
      if (parsed.hostname === 'l.facebook.com' && parsed.pathname === '/l.php') {
        const wrapped = parsed.searchParams.get('u');
        if (wrapped) return sanitizeParsedUrl(new URL(wrapped), options);
      }
      return sanitizeParsedUrl(parsed, options);
    } catch {
      return null;
    }
  };

  const redact = (value) => String(value || '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]');

  const visibleText = (node) => {
    if (!(node instanceof Element)) return '';
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return '';
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return '';
    return redact(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
  };

  const sourceUrl = normalizeUrl(location.href);
  const sourceType = /\/reel\//i.test(location.pathname)
    ? 'reel'
    : /\/videos?\//i.test(location.pathname)
      ? 'video'
      : /story\.php|\/posts?\//i.test(location.pathname)
        ? 'post'
        : 'facebook-page';

  const canonicalCandidates = [...document.querySelectorAll('a[href]')]
    .map((a) => normalizeUrl(a.href, { stripTracking: true }))
    .filter(Boolean)
    .filter((href) => {
      try {
        const u = new URL(href);
        return isFacebookHost(u.hostname) && /\/reel\/|\/videos?\/|\/posts?\/|\/permalink\/|story\.php/i.test(u.pathname + u.search);
      } catch {
        return false;
      }
    });

  const textSelectors = [
    '[data-ad-preview="message"]',
    '[data-ad-comet-preview="message"]',
    'div[role="article"] div[dir="auto"]'
  ];
  const seenText = new Set();
  const textBlocks = [];
  let textBudget = 0;
  for (const selector of textSelectors) {
    for (const node of document.querySelectorAll(selector)) {
      const text = visibleText(node).slice(0, MAX_TEXT_BLOCK);
      if (!text || text.length < 2 || seenText.has(text)) continue;
      const remaining = MAX_TEXT_TOTAL - textBudget;
      if (remaining <= 0) break;
      const bounded = text.slice(0, remaining);
      textBlocks.push(bounded);
      seenText.add(text);
      textBudget += bounded.length;
    }
    if (textBudget >= MAX_TEXT_TOTAL) break;
  }

  const outbound = [];
  const seenLinks = new Set();
  for (const anchor of document.querySelectorAll('a[href]')) {
    if (outbound.length >= MAX_LINKS) break;
    const href = normalizeUrl(anchor.href, { stripTracking: true });
    if (!href || seenLinks.has(href)) continue;
    try {
      const u = new URL(href);
      if (isFacebookHost(u.hostname)) continue;
      const label = redact(visibleText(anchor)).slice(0, 300);
      outbound.push({ url: href, label });
      seenLinks.add(href);
    } catch {
      // ignore malformed links
    }
  }

  const githubRepos = [];
  const seenRepos = new Set();
  for (const item of outbound) {
    try {
      const u = new URL(item.url);
      if (u.hostname !== 'github.com') continue;
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length < 2) continue;
      const owner = parts[0];
      const repoName = parts[1].replace(/\.git$/i, '').replace(/[.,;:!?]+$/u, '');
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) continue;
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(repoName)) continue;
      const repo = `${owner}/${repoName}`;
      if (!seenRepos.has(repo.toLowerCase())) {
        seenRepos.add(repo.toLowerCase());
        githubRepos.push(repo);
      }
    } catch {
      // ignore malformed links
    }
  }

  const media = [];
  for (const img of document.querySelectorAll('img[alt]')) {
    if (media.length >= MAX_MEDIA) break;
    const alt = redact(img.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (alt) media.push({ kind: 'image', alt });
  }
  if (media.length < MAX_MEDIA) {
    for (const video of document.querySelectorAll('video')) {
      if (media.length >= MAX_MEDIA) break;
      const poster = normalizeUrl(video.poster || '', { stripTracking: true });
      media.push({ kind: 'video', poster });
    }
  }

  const compactParts = [];
  if (githubRepos.length) compactParts.push(`GitHub repositories: ${githubRepos.join(', ')}`);
  for (const item of outbound.slice(0, MAX_COMPACT_LINKS)) {
    try {
      const u = new URL(item.url);
      const label = item.label ? ` — ${item.label}` : '';
      compactParts.push(`Link: ${u.hostname}${u.pathname}${label}`);
    } catch {
      // ignore malformed compact link
    }
  }
  for (const block of textBlocks) compactParts.push(`Text: ${block}`);
  const compactContext = compactParts.join('\n').slice(0, MAX_COMPACT_TEXT);

  const imageEvidenceCount = media.filter((item) => item.kind === 'image').length;
  const localOcrRecommended = textBudget < 160 && imageEvidenceCount > 0;
  const ocrReasons = [];
  if (textBudget < 160) ocrReasons.push('low-visible-dom-text');
  if (imageEvidenceCount > 0) ocrReasons.push('visible-image-evidence-present');

  const canonicalUrl = canonicalCandidates[0] || sourceUrl;
  const quality = (textBlocks.length > 0 || outbound.length > 0) && canonicalUrl ? 'full' : 'partial';

  return {
    schema: 'daube.facebook-reader-envelope.v1',
    extractor_version: EXTRACTOR_VERSION,
    reader_lane: 'active-tab-extension',
    reader_quality: quality,
    source_type: sourceType,
    source_url: sourceUrl,
    canonical_url: canonicalUrl,
    page_title: redact(document.title).slice(0, 500),
    visible_text: textBlocks,
    compact_context: compactContext,
    outbound_links: outbound,
    github_repos: githubRepos,
    media,
    capability_hints: {
      local_ocr_recommended: localOcrRecommended,
      local_ocr_mode: 'offline-user-authorized-region',
      local_ocr_reasons: ocrReasons,
      network_allowed_for_ocr: false,
      image_pixels_captured_by_extension: false
    },
    capture_metrics: {
      visible_text_characters: textBudget,
      compact_context_characters: compactContext.length,
      outbound_link_count: outbound.length,
      github_repo_count: githubRepos.length,
      image_evidence_count: imageEvidenceCount
    },
    captured_at: new Date().toISOString(),
    provenance: {
      original_url: sourceUrl,
      authenticated_tab_selected_by_user: true
    }
  };
})();
