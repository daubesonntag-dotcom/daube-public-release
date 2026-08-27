#!/usr/bin/env node

import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, ".daube/evidence/release-channel-browser");
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
      const timer = setTimeout(() => reject(new Error("CDP websocket timeout")), 15000);
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
  send(method, params = {}, timeoutMs = 45000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timeout`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const value = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.text || "browser evaluation failed");
    return value.result?.value;
  }
  close() {
    if (this.ws.readyState <= WebSocket.OPEN) this.ws.close();
  }
}

async function waitFor(cdp, expression, label, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await cdp.evaluate(`Boolean(${expression})`)) return;
    await sleep(100);
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
    screenHeight: viewport.height,
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: viewport.mobile, maxTouchPoints: viewport.mobile ? 5 : 1 });
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: reducedMotion ? "reduce" : "no-preference" }],
  });
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${STATIC_PORT}/` });
  await waitFor(cdp, "document.readyState === 'complete' && document.querySelector('h1')", "release-channel document");
  await sleep(100);
}

async function snapshotState(cdp) {
  return cdp.evaluate(`(()=>{const canonical=document.querySelector('link[rel="canonical"]')?.href||'';const robots=document.querySelector('meta[name="robots"]')?.content||'';const links=[...document.querySelectorAll('a')].map(a=>a.href);const scripts=[...document.scripts].map(s=>s.src).filter(Boolean);const styleLinks=[...document.querySelectorAll('link[rel="stylesheet"]')].map(l=>l.href);return{title:document.title,viewport:{width:innerWidth,height:innerHeight},h1Count:document.querySelectorAll('h1').length,h1:document.querySelector('h1')?.textContent?.trim()||'',canonical,robots,links,scripts,styleLinks,horizontalOverflow:document.documentElement.scrollWidth-innerWidth,bodyText:document.body.innerText,hasLegacyHomepageScene:Boolean(document.querySelector('[data-chapter], [data-public-homepage], .chapter-media')),reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches};})()`);
}

function assertState(state, { reducedMotion = false } = {}) {
  if (state.title !== "D’AUBE SONNTAG · Public release channel") throw new Error(`Unexpected title: ${state.title}`);
  if (state.h1Count !== 1 || state.h1 !== "Public release channel") throw new Error("Release-channel heading contract failed");
  if (state.canonical !== "https://daubesonntag.com/") throw new Error(`Canonical target mismatch: ${state.canonical}`);
  if (state.robots !== "noindex,nofollow,noarchive,nosnippet") throw new Error(`Robots contract mismatch: ${state.robots}`);
  if (!state.links.includes("https://daubesonntag.com/")) throw new Error("Canonical customer link missing");
  if (!state.bodyText.includes("not the canonical homepage authority")) throw new Error("Authority boundary is not visible");
  if (!state.bodyText.includes("daube-web")) throw new Error("Canonical source repository is not visible");
  if (state.hasLegacyHomepageScene) throw new Error("Legacy homepage scene leaked into release-channel root");
  if (state.scripts.length !== 0 || state.styleLinks.length !== 0) throw new Error("Release-channel root unexpectedly loads external script/style resources");
  if (state.horizontalOverflow > 2) throw new Error(`Horizontal overflow detected: ${state.horizontalOverflow}px`);
  if (state.reducedMotion !== reducedMotion) throw new Error("Reduced-motion emulation mismatch");
  for (const forbidden of ["Founder OS", "COMMERCE LIVE", "production complete", "revenue verified"]) {
    if (state.bodyText.toLowerCase().includes(forbidden.toLowerCase())) throw new Error(`Unsupported/private claim leaked: ${forbidden}`);
  }
}

async function screenshot(cdp, name) {
  const result = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: true });
  const buffer = Buffer.from(result.data || "", "base64");
  if (buffer.length < 3000) throw new Error(`Screenshot ${name} too small: ${buffer.length} bytes`);
  await writeFile(path.join(OUTPUT, name), buffer);
  return { file: name, bytes: buffer.length, sha256: sha256(buffer) };
}

async function main() {
  await mkdir(OUTPUT, { recursive: true });
  const server = await startStaticServer();
  const profile = await mkdtemp(path.join(os.tmpdir(), "daube-release-channel-"));
  const chromeLogs = [];
  const chrome = spawn(chromeBinary(), [
    "--headless=new",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    "--disable-background-networking",
    "--disable-extensions",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
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
    await Promise.all([cdp.send("Page.enable"), cdp.send("Runtime.enable")]);

    await navigate(cdp, { width: 1440, height: 900, mobile: false }, false);
    const desktop = await snapshotState(cdp);
    assertState(desktop);
    const desktopScreenshot = await screenshot(cdp, "release-channel-desktop.png");

    await navigate(cdp, { width: 390, height: 844, mobile: true }, false);
    const mobile = await snapshotState(cdp);
    assertState(mobile);
    const mobileScreenshot = await screenshot(cdp, "release-channel-mobile.png");

    await navigate(cdp, { width: 390, height: 844, mobile: true }, true);
    const reducedMotion = await snapshotState(cdp);
    assertState(reducedMotion, { reducedMotion: true });
    const reducedScreenshot = await screenshot(cdp, "release-channel-reduced-motion.png");

    const evidence = {
      schema: "daube.public-release.browser-evidence.v1",
      generatedAt: new Date().toISOString(),
      status: "PASS",
      role: "PUBLIC_RELEASE_PROJECTION",
      canonicalHomepageAuthority: "daubesonntag-dotcom/daube-web",
      desktop,
      mobile,
      reducedMotion,
      screenshots: [desktopScreenshot, mobileScreenshot, reducedScreenshot],
      truthBoundary: {
        localChromiumRendered: true,
        releaseChannelRoleVerified: true,
        canonicalApexProductionVerified: false,
        customerHomepageVisualAcceptance: false,
      },
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
