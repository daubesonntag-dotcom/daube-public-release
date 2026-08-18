(() => {
  const MANIFEST_URL = "/assets/treasury/manifest.json";
  const RUNTIME_CSS = "/assets/treasury/runtime.css";
  const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  const consumersOf = (item) => Array.isArray(item?.consumers) ? item.consumers : (Array.isArray(item?.consumerTargets) ? item.consumerTargets : []);
  const approved = (item) => ["approved-local", "approved-cdn", "hero"].includes(item?.state) && typeof (item.localPath || item.cdnPath) === "string";
  const assetUrl = (item, key = null) => {
    const value = key ? item?.[key] : (item?.localPath || item?.cdnPath);
    if (typeof value !== "string" || !value) return null;
    if (/^https:\/\//i.test(value)) return value;
    return value.startsWith("/") ? value : `/${value}`;
  };
  const familyOf = (item) => item?.typeFamily || ({
    "svg-icon": "visual",
    "hero-image": "visual",
    "hero-render": "visual",
    "project-media": "visual",
    "editorial-image": "visual",
    "animated-image": "visual",
    "video": "video",
    "hero-video": "video",
    "audio": "audio",
    "music": "audio",
    "3d-model": "3d",
    "hdri": "3d",
    "vfx": "vfx-cgi",
    "cgi": "vfx-cgi"
  }[item?.kind] || null);

  function ensureRuntimeCss() {
    if (document.querySelector(`link[href="${RUNTIME_CSS}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = RUNTIME_CSS;
    document.head.append(link);
  }

  function provisionHomepageSlots() {
    const hero = document.querySelector(".public-mark");
    if (hero && !hero.dataset.treasurySlot) {
      hero.dataset.treasurySlot = "homepageHero";
      hero.dataset.treasuryAlt = "D’AUBE SONNTAG — visual hero";
    }

    const cardIcons = ["lucide-sparkles", "lucide-orbit", "lucide-gem", "lucide-boxes"];
    document.querySelectorAll(".public-grid .public-card").forEach((card, index) => {
      if (card.querySelector("[data-treasury-icon]")) return;
      const assetId = cardIcons[index];
      if (!assetId) return;
      const slot = document.createElement("span");
      slot.dataset.treasuryIcon = assetId;
      slot.setAttribute("aria-hidden", "true");
      card.prepend(slot);
    });
  }

  function createIcon(item, label) {
    const img = document.createElement("img");
    img.src = assetUrl(item);
    img.alt = label || "";
    img.width = 24;
    img.height = 24;
    img.loading = "lazy";
    img.decoding = "async";
    img.className = "treasury-icon";
    img.dataset.treasuryAsset = item.assetId;
    return img;
  }

  function bindIcons(artifacts) {
    const byId = new Map(artifacts.filter(approved).map((item) => [item.assetId, item]));
    for (const slot of document.querySelectorAll("[data-treasury-icon]")) {
      const item = byId.get(slot.dataset.treasuryIcon);
      if (!item || item.kind !== "svg-icon") {
        slot.dataset.treasuryState = "unresolved";
        continue;
      }
      slot.replaceChildren(createIcon(item, slot.dataset.treasuryIconLabel || ""));
      slot.dataset.treasuryState = "ready";
    }
  }

  function createImage(item, surface, name) {
    const img = document.createElement("img");
    img.src = assetUrl(item);
    img.alt = surface.dataset.treasuryAlt || "";
    img.decoding = "async";
    img.loading = name === "homepageHero" ? "eager" : "lazy";
    img.fetchPriority = name === "homepageHero" ? "high" : "auto";
    img.className = "treasury-media";
    img.dataset.treasuryAsset = item.assetId;
    if (item.width) img.width = item.width;
    if (item.height) img.height = item.height;
    return img;
  }

  function createVideo(item, surface, name) {
    const video = document.createElement("video");
    video.src = assetUrl(item);
    video.poster = assetUrl(item, "posterPath") || "";
    video.className = "treasury-media treasury-video";
    video.dataset.treasuryAsset = item.assetId;
    video.playsInline = true;
    video.preload = name === "homepageHero" ? "metadata" : "none";
    video.muted = true;
    video.loop = item.loop !== false;
    video.setAttribute("aria-label", surface.dataset.treasuryAlt || "");
    const decorativeAutoplay = item.autoplayPolicy === "muted-decorative" && !prefersReducedMotion();
    if (decorativeAutoplay) {
      video.autoplay = true;
      video.setAttribute("muted", "");
    } else {
      video.controls = item.controls === true;
    }
    return video;
  }

  function createPosterFallback(item, surface) {
    const poster = assetUrl(item, "posterPath") || assetUrl(item, "previewPath") || assetUrl(item, "thumbnailPath");
    if (!poster) return null;
    const img = document.createElement("img");
    img.src = poster;
    img.alt = surface.dataset.treasuryAlt || "";
    img.loading = "lazy";
    img.decoding = "async";
    img.className = "treasury-media treasury-poster-fallback";
    img.dataset.treasuryAsset = item.assetId;
    img.dataset.treasuryFallbackFor = familyOf(item) || item.kind;
    return img;
  }

  function createSurfaceMedia(item, surface, name) {
    const family = familyOf(item);
    if (family === "visual") return createImage(item, surface, name);
    if (family === "video") return createVideo(item, surface, name);
    if (["3d", "vfx-cgi", "motion"].includes(family)) return createPosterFallback(item, surface);
    return null;
  }

  function mediaRank(item, name) {
    const family = familyOf(item);
    const tier = { research: 0, utility: 1, premium: 2, hero: 3, "crown-jewel": 4 }[item.qualityTier] || 0;
    const heroFamilyScore = name === "homepageHero" && ["video", "3d", "vfx-cgi", "motion", "visual"].includes(family) ? 20 : 0;
    return heroFamilyScore + tier * 10 + (item.state === "hero" ? 5 : 0);
  }

  function bindMediaSurfaces(artifacts) {
    const usable = artifacts.filter(approved);
    for (const surface of document.querySelectorAll("[data-treasury-slot]")) {
      const name = surface.dataset.treasurySlot;
      const candidates = usable
        .filter((item) => consumersOf(item).includes(name))
        .filter((item) => ["visual", "video", "motion", "3d", "vfx-cgi"].includes(familyOf(item)))
        .sort((a, b) => mediaRank(b, name) - mediaRank(a, name));
      const media = candidates.find((item) => createSurfaceMedia(item, surface, name));
      if (!media) {
        surface.dataset.treasuryState = "unresolved";
        if (name === "homepageHero") surface.querySelector(".public-mark__scene")?.remove();
        continue;
      }
      const node = createSurfaceMedia(media, surface, name);
      if (!node) {
        surface.dataset.treasuryState = "unresolved";
        continue;
      }
      const mount = surface.querySelector("[data-treasury-media-mount]") || surface;
      mount.querySelectorAll(".treasury-media").forEach((existing) => existing.remove());
      mount.prepend(node);
      surface.dataset.treasuryState = "ready";
      surface.dataset.treasuryFamily = familyOf(media) || "unknown";
    }
  }

  function bindAudio(artifacts) {
    const usable = artifacts.filter(approved).filter((item) => familyOf(item) === "audio");
    const byId = new Map(usable.map((item) => [item.assetId, item]));
    for (const slot of document.querySelectorAll("[data-treasury-audio]")) {
      const item = byId.get(slot.dataset.treasuryAudio);
      if (!item) {
        slot.dataset.treasuryState = "unresolved";
        continue;
      }
      const audio = document.createElement("audio");
      audio.src = assetUrl(item);
      audio.preload = "none";
      audio.controls = true;
      audio.autoplay = false;
      audio.dataset.treasuryAsset = item.assetId;
      audio.setAttribute("aria-label", slot.dataset.treasuryAudioLabel || item.title || "Audio");
      slot.replaceChildren(audio);
      slot.dataset.treasuryState = "ready";
    }
  }

  async function boot() {
    ensureRuntimeCss();
    provisionHomepageSlots();
    try {
      const response = await fetch(MANIFEST_URL, { cache: "no-cache" });
      if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
      const manifest = await response.json();
      const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
      bindIcons(artifacts);
      bindMediaSurfaces(artifacts);
      bindAudio(artifacts);
      document.documentElement.dataset.treasuryRuntime = "ready";
      document.documentElement.dataset.treasuryHero = manifest.heroReady === true ? "ready" : "unresolved";
      document.documentElement.dataset.treasurySchema = manifest.schema || "unknown";
    } catch (error) {
      document.documentElement.dataset.treasuryRuntime = "failed";
      console.warn("D’AUBE Resource Treasury runtime unavailable", error);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
