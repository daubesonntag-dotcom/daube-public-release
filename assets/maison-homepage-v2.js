(() => {
  const root = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const scenes = [...document.querySelectorAll("[data-motion-scene]")];
  const header = document.querySelector("[data-header]");
  const menu = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".maison-nav");

  const applyMotionMode = () => {
    root.classList.add("maison-motion");
    root.classList.toggle("maison-reduced-motion", reduced.matches);
    if (reduced.matches) scenes.forEach((scene) => scene.classList.add("is-visible"));
  };
  applyMotionMode();
  reduced.addEventListener?.("change", applyMotionMode);

  if (!reduced.matches && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add("is-visible");
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    scenes.forEach((scene) => observer.observe(scene));
  } else {
    scenes.forEach((scene) => scene.classList.add("is-visible"));
  }

  const finePointer = matchMedia("(pointer:fine)").matches;
  if (finePointer && !reduced.matches) {
    scenes.forEach((scene) => {
      const media = scene.querySelector("[data-depth-media]");
      if (!media) return;
      scene.addEventListener("pointermove", (event) => {
        const rect = media.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return;
        const x = ((event.clientX - rect.left) / rect.width - 0.5) * 7;
        const y = ((event.clientY - rect.top) / rect.height - 0.5) * 5;
        media.style.setProperty("--mx", `${x}px`);
        media.style.setProperty("--my", `${y}px`);
      }, { passive: true });
      scene.addEventListener("pointerleave", () => {
        media.style.setProperty("--mx", "0px");
        media.style.setProperty("--my", "0px");
      });
    });
  }

  if (menu && nav) {
    menu.addEventListener("click", () => {
      const expanded = menu.getAttribute("aria-expanded") === "true";
      menu.setAttribute("aria-expanded", String(!expanded));
      document.body.classList.toggle("nav-open", !expanded);
    });
  }

  let lastY = scrollY;
  addEventListener("scroll", () => {
    if (!header) return;
    const nextY = scrollY;
    header.classList.toggle("header-compact", nextY > 24);
    header.classList.toggle("header-away", nextY > lastY && nextY > 220);
    lastY = nextY;
  }, { passive: true });
})();
