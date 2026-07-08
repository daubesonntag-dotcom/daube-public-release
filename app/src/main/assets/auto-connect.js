(() => {
  const ENDPOINT_KEY = "daube-backend-url";
  const CONFIG_URL = "https://raw.githubusercontent.com/daubesonntag-dotcom/daube-site/main/backend-config.json";
  const DEFAULT_CONFIG = {
    healthPaths: ["/api/ecosystem/status", "/api/health"],
    candidates: ["https://daube-sonntag.vercel.app"],
    retry: { attempts: 3, delayMs: 1200, timeoutMs: 5000 }
  };

  const clean = value => String(value || "").trim().replace(/\/$/, "");
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadConfig() {
    try {
      const response = await fetchWithTimeout(CONFIG_URL, {}, 5000);
      if (!response.ok) return DEFAULT_CONFIG;
      const data = await response.json();
      return { ...DEFAULT_CONFIG, ...data, retry: { ...DEFAULT_CONFIG.retry, ...(data.retry || {}) } };
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  async function isHealthy(base, healthPaths, timeoutMs) {
    for (const path of healthPaths) {
      try {
        const response = await fetchWithTimeout(clean(base) + path, {}, timeoutMs);
        const data = await response.json().catch(() => null);
        if (response.ok && data?.ok) return true;
      } catch {}
    }
    return false;
  }

  async function discover() {
    const config = await loadConfig();
    const saved = clean(localStorage.getItem(ENDPOINT_KEY));
    const candidates = [...new Set([saved, ...(config.candidates || [])].map(clean).filter(Boolean))];
    const attempts = Math.max(1, Number(config.retry?.attempts || 3));
    const delayMs = Math.max(250, Number(config.retry?.delayMs || 1200));
    const timeoutMs = Math.max(1000, Number(config.retry?.timeoutMs || 5000));

    for (let round = 0; round < attempts; round++) {
      for (const candidate of candidates) {
        if (await isHealthy(candidate, config.healthPaths || DEFAULT_CONFIG.healthPaths, timeoutMs)) {
          localStorage.setItem(ENDPOINT_KEY, candidate);
          localStorage.setItem("daube-backend-last-ok", new Date().toISOString());
          window.dispatchEvent(new CustomEvent("daube-backend-online", { detail: { base: candidate } }));
          return candidate;
        }
      }
      if (round < attempts - 1) await sleep(delayMs);
    }

    window.dispatchEvent(new CustomEvent("daube-backend-offline"));
    return null;
  }

  window.DAUBE_AUTO_CONNECT = { discover, loadConfig };
  document.addEventListener("DOMContentLoaded", () => discover());
  setInterval(discover, 5 * 60 * 1000);
})();
