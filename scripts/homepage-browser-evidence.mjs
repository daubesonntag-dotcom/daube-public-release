#!/usr/bin/env node

import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, ".daube/evidence/free-first-homepage");
const STATIC_PORT = 4820;
const DEBUG_PORT = 9570;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

function chromeBinary() {
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const probe = spawnSync("bash", ["-lc", `command -v ${name}`], { encoding: "utf8" });
    if (probe.status === 0) return name;
  }
  throw new Error("Chromium binary not found");
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js") || file.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".webp")) return "image/webp";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  if (file.endsWith(".json") || file.endsWith(".webmanifest")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

async function startStaticServer() {
  const root = path.resolve(ROOT);
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url || "/", `http://127.0.0.1:${STATIC_PORT}`).pathname;
      let relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
      if (relative.endsWith("/")) relative += "index.html";
      const absolute = path.resolve(ROOT, relative);
      if (!absolute.startsWith(`${root}${path.sep}`) && absolute !== path.join(root, "index.html")) {
        res.writeHead(403).end("forbidden");
        return;
      }
      await stat(absolute);
      const body = await readFile(absolute);
      res.writeHead(200, { "content-type": contentType(absolute), "cache-control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise((resolve) => server.listen(STATIC_PORT, "127.0.0.1", resolve));
  return server;
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP websocket timeout")), 15_000);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP websocket error")); }, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result || {});
    });
  }

  send(method, params = {}, timeoutMs = 45_000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timeout`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const value = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    });
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.text || "browser evaluation failed");
    return value.result?.value;
  }

  close() {
    if (this.ws.readyState <= WebSocket.OPEN) this.ws.close();
  }
}

async function waitFor(cdp, expression, label, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await cdp.evaluate(`Boolean(${expression})`)) return;
    await sleep(120);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function navigate(cdp, viewport, reducedMotion = false) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
    screenWidth: viewport.width,
    screenHeight: viewport.height
  });
  if (viewport.mobile) {
    await cdp.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 5
    });
  } else {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: reducedMotion ? "reduce" : "no-preference" }]
  });
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${STATIC_PORT}/` });
  await waitFor(cdp, `document.readyState === 'complete' && document.querySelector('[data-public-homepage="founder-visual-lock-10-scene"]')`, "homepage render");
  await waitFor(cdp, `document.documentElement.classList.contains('ff-motion')`, "Free-First motion bootstrap");
  await sleep(250);
}

async function exerciseScrollReveals(cdp) {
  await cdp.evaluate(`(async () => {
    const root = document.documentElement;
    const priorScrollBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    const targets = [
      ...document.querySelectorAll('[data-motion-scene]'),
      ...document.querySelectorAll('[data-motion-card]')
    ];
    for (const target of targets) {
      const rect = target.getBoundingClientRect();
      const top = Math.max(0, rect.top + window.scrollY - Math.max(24, innerHeight * 0.18));
      window.scrollTo(0, top);
      await new Promise((resolve) => setTimeout(resolve, 90));
    }
    window.scrollTo(0, 0);
    await new Promise((resolve) => setTimeout(resolve, 420));
    root.style.scrollBehavior = priorScrollBehavior;
    return true;
  })()`);
}

async function snapshotState(cdp) {
  return cdp.evaluate(`(() => {
    const obsolete = ['.fv-orbit', '.fv-crystal', '.fv-spectrum', '.fv-system-map'];
    const iconNodes = [...document.querySelectorAll('.fv-object-icon')];
    const sourceStyles = [...document.styleSheets].map(sheet => sheet.href || '').filter(Boolean);
    const sourceScripts = [...document.scripts].map(script => script.src || '').filter(Boolean);
    const copyNodes = [...document.querySelectorAll('[data-motion-copy]')];
    const cardNodes = [...document.querySelectorAll('[data-motion-card]')];
    const main = document.querySelector('main');
    return {
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight },
      sceneCount: document.querySelectorAll('.fv-scene').length,
      h1Count: document.querySelectorAll('h1').length,
      obsoleteCount: obsolete.reduce((count, selector) => count + document.querySelectorAll(selector).length, 0),
      treasuryIconCount: iconNodes.length,
      loadedTreasuryIconCount: iconNodes.filter(node => node.complete && node.naturalWidth > 0).length,
      hasFreeFirstCss: sourceStyles.some(url => url.includes('free-first-homepage-v1.css')),
      hasFreeFirstJs: sourceScripts.some(url => url.includes('free-first-homepage-v1.js')),
      reducedMotionClass: document.documentElement.classList.contains('ff-reduced-motion'),
      unrevealedCopyCount: copyNodes.filter(node => !node.closest('[data-motion-scene]')?.classList.contains('ff-in-view')).length,
      unrevealedCardCount: cardNodes.filter(node => !node.classList.contains('ff-in-view')).length,
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      mainWidth: main?.getBoundingClientRect().width || 0,
      bodyText: document.body.innerText.slice(0, 4000)
    };
  })()`);
}

function assertState(state, { reducedMotion = false } = {}) {
  if (state.title !== "D’AUBE SONNTAG — Meaning, made visible.") throw new Error(`Unexpected title: ${state.title}`);
  if (state.sceneCount !== 10) throw new Error(`Expected 10 Founder scenes, got ${state.sceneCount}`);
  if (state.h1Count !== 1) throw new Error(`Expected exactly one h1, got ${state.h1Count}`);
  if (state.obsoleteCount !== 0) throw new Error(`CSS-art markup still rendered: ${state.obsoleteCount}`);
  if (state.treasuryIconCount !== 8 || state.loadedTreasuryIconCount !== 8) throw new Error(`Treasury icons not fully rendered: ${state.loadedTreasuryIconCount}/${state.treasuryIconCount}`);
  if (!state.hasFreeFirstCss || !state.hasFreeFirstJs) throw new Error("Free-First CSS/JS layer did not load");
  if (state.unrevealedCopyCount !== 0 || state.unrevealedCardCount !== 0) throw new Error(`Motion reveal did not complete: copy=${state.unrevealedCopyCount}, cards=${state.unrevealedCardCount}`);
  if (state.horizontalOverflow > 3) throw new Error(`Horizontal overflow detected: ${state.horizontalOverflow}px`);
  if (state.mainWidth < Math.min(360, state.viewport.width - 20)) throw new Error(`Main surface unexpectedly narrow: ${state.mainWidth}px`);
  if (state.reducedMotionClass !== reducedMotion) throw new Error(`Reduced-motion state mismatch: ${state.reducedMotionClass}`);
  if (!state.bodyText.includes("Meaning, made visible.")) throw new Error("Canonical Founder copy is not visible");
}

async function screenshot(cdp, name) {
  const result = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: true
  });
  const buffer = Buffer.from(result.data || "", "base64");
  if (buffer.length < 20_000) throw new Error(`Screenshot ${name} too small: ${buffer.length} bytes`);
  await writeFile(path.join(OUTPUT, name), buffer);
  return { file: name, bytes: buffer.length, sha256: sha256(buffer) };
}

async function main() {
  await mkdir(OUTPUT, { recursive: true });
  const server = await startStaticServer();
  const profile = await mkdtemp(path.join(os.tmpdir(), "daube-homepage-browser-"));
  const chromeLogs = [];
  const chrome = spawn(chromeBinary(), [
    "--headless=new",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    "--disable-extensions",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank"
  ], { stdio: ["ignore", "pipe", "pipe"] });
  chrome.stdout?.on("data", (chunk) => chromeLogs.push(Buffer.from(chunk)));
  chrome.stderr?.on("data", (chunk) => chromeLogs.push(Buffer.from(chunk)));

  let cdp;
  try {
    for (let i = 0; i < 80; i += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
        if (response.ok) break;
      } catch {}
      await sleep(200);
      if (i === 79) throw new Error("Chromium did not start");
    }

    const targetResponse = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
    const target = await targetResponse.json();
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await Promise.all([cdp.send("Page.enable"), cdp.send("Runtime.enable"), cdp.send("Network.enable")]);

    await navigate(cdp, { width: 1440, height: 1000, mobile: false }, false);
    await exerciseScrollReveals(cdp);
    const desktop = await snapshotState(cdp);
    assertState(desktop);
    const desktopScreenshot = await screenshot(cdp, "homepage-desktop.png");

    await navigate(cdp, { width: 390, height: 844, mobile: true }, false);
    await exerciseScrollReveals(cdp);
    const mobile = await snapshotState(cdp);
    assertState(mobile);
    const mobileScreenshot = await screenshot(cdp, "homepage-mobile.png");

    await navigate(cdp, { width: 390, height: 844, mobile: true }, true);
    await exerciseScrollReveals(cdp);
    const reducedMotion = await snapshotState(cdp);
    assertState(reducedMotion, { reducedMotion: true });

    const evidence = {
      program: "DAUBE-FREE-FIRST-HOMEPAGE-BROWSER-EVIDENCE-V1",
      generatedAt: new Date().toISOString(),
      status: "PASS",
      desktop,
      mobile,
      reducedMotion,
      screenshots: [desktopScreenshot, mobileScreenshot],
      truthBoundary: {
        localChromiumRendered: true,
        desktopRendered: true,
        mobileRendered: true,
        reducedMotionRendered: true,
        scrollRevealExercisedBeforeCapture: true,
        productionDomainVerified: false,
        founderGoldVisualConfirmed: false,
        externalMediaCompletenessNotRequiredForPass: true
      }
    };
    await writeFile(path.join(OUTPUT, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    cdp?.close();
    chrome.kill("SIGTERM");
    await sleep(300);
    if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill("SIGKILL");
    await writeFile(path.join(OUTPUT, "chrome.log"), Buffer.concat(chromeLogs));
    await new Promise((resolve) => server.close(resolve));
    await rm(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
