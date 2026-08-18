(() => {
  const MANIFEST_URL = "assets/treasury/manifest.json";
  const approved = (item) => item?.state === "approved-local" && typeof item.localPath === "string" && item.localPath.startsWith("assets/treasury/");

  function createIcon(item, label) {
    const img = document.createElement("img");
    img.src = item.localPath;
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

  function bindMediaSurfaces(artifacts) {
    const local = artifacts.filter(approved);
    for (const surface of document.querySelectorAll("[data-treasury-slot]")) {
      const name = surface.dataset.treasurySlot;
      const candidates = local.filter((item) => item.consumers?.includes(name));
      const media = candidates.find((item) => ["hero-image", "hero-render", "project-media", "editorial-image"].includes(item.kind));
      if (!media) {
        surface.dataset.treasuryState = "unresolved";
        continue;
      }
      const img = document.createElement("img");
      img.src = media.localPath;
      img.alt = surface.dataset.treasuryAlt || "";
      img.decoding = "async";
      img.fetchPriority = name === "homepageHero" ? "high" : "auto";
      img.className = "treasury-media";
      img.dataset.treasuryAsset = media.assetId;
      const mount = surface.querySelector("[data-treasury-media-mount]") || surface;
      mount.prepend(img);
      surface.dataset.treasuryState = "ready";
    }
  }

  async function boot() {
    try {
      const response = await fetch(MANIFEST_URL, { cache: "no-cache" });
      if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
      const manifest = await response.json();
      const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
      bindIcons(artifacts);
      bindMediaSurfaces(artifacts);
      document.documentElement.dataset.treasuryRuntime = "ready";
      document.documentElement.dataset.treasuryHero = manifest.heroReady === true ? "ready" : "unresolved";
    } catch (error) {
      document.documentElement.dataset.treasuryRuntime = "failed";
      console.warn("D’AUBE Resource Treasury runtime unavailable", error);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
