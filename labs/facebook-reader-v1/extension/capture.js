(() => {
  'use strict';
  const EXTRACTOR_VERSION = '0.1.0';
  const MAX_TEXT_TOTAL = 6000;
  const MAX_TEXT_BLOCK = 2000;
  const MAX_LINKS = 100;
  const MAX_MEDIA = 20;
  const isHttp = (url) => url && (url.protocol === 'https:' || url.protocol === 'http:');
  const isFacebookHost = (host) => /(^|\.)facebook\.com$/i.test(host);
  const normalizeUrl = (value) => {
    try {
      const parsed = new URL(value, location.href);
      if (!isHttp(parsed)) return null;
      if (parsed.hostname === 'l.facebook.com' && parsed.pathname === '/l.php') {
        const wrapped = parsed.searchParams.get('u');
        if (wrapped) {
          const unwrapped = new URL(wrapped);
          return isHttp(unwrapped) ? unwrapped.toString() : null;
        }
      }
      return parsed.toString();
    } catch { return null; }
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
  const sourceType = /\/reel\//i.test(location.pathname) ? 'reel' : /\/videos?\//i.test(location.pathname) ? 'video' : /story\.php|\/posts?\//i.test(location.pathname) ? 'post' : 'facebook-page';
  const canonicalCandidates = [...document.querySelectorAll('a[href]')].map((a) => normalizeUrl(a.href)).filter(Boolean).filter((href) => {
    try {
      const u = new URL(href);
      return isFacebookHost(u.hostname) && /\/reel\/|\/videos?\/|\/posts?\/|\/permalink\/|story\.php/i.test(u.pathname + u.search);
    } catch { return false; }
  });
  const textSelectors = ['[data-ad-preview="message"]','[data-ad-comet-preview="message"]','div[role="article"] div[dir="auto"]'];
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
    const href = normalizeUrl(anchor.href);
    if (!href || seenLinks.has(href)) continue;
    try {
      const u = new URL(href);
      if (isFacebookHost(u.hostname)) continue;
      outbound.push({ url: href, label: redact(visibleText(anchor)).slice(0, 300) });
      seenLinks.add(href);
    } catch {}
  }
  const githubRepos = [];
  const seenRepos = new Set();
  for (const item of outbound) {
    try {
      const u = new URL(item.url);
      if (u.hostname !== 'github.com') continue;
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length < 2) continue;
      const repo = `${parts[0]}/${parts[1].replace(/\.git$/i, '')}`;
      if (!seenRepos.has(repo)) { seenRepos.add(repo); githubRepos.push(repo); }
    } catch {}
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
      media.push({ kind: 'video', poster: normalizeUrl(video.poster || '') });
    }
  }
  const canonicalUrl = canonicalCandidates[0] || sourceUrl;
  const quality = (textBlocks.length > 0 || outbound.length > 0) && canonicalUrl ? 'full' : 'partial';
  return {
    schema: 'daube.facebook-reader-envelope.v1', extractor_version: EXTRACTOR_VERSION,
    reader_lane: 'active-tab-extension', reader_quality: quality, source_type: sourceType,
    source_url: sourceUrl, canonical_url: canonicalUrl, page_title: redact(document.title).slice(0, 500),
    visible_text: textBlocks, outbound_links: outbound, github_repos: githubRepos, media,
    captured_at: new Date().toISOString(),
    provenance: { original_url: sourceUrl, authenticated_tab_selected_by_user: true }
  };
})();
