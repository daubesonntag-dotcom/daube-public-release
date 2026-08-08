#!/usr/bin/env node

import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const ASSET_ROOT = path.join(ROOT, "app/src/main/assets");
const OUTPUT = path.join(ROOT, ".daube/evidence/nexus-browser");
const STATIC_PORT = 4810;
const BACKEND_PORT = 4811;
const DEBUG_PORT = 9561;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = buffer => crypto.createHash("sha256").update(buffer).digest("hex");

function chromeBinary() {
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const probe = spawnSync("bash", ["-lc", `command -v ${name}`], { encoding: "utf8" });
    if (probe.status === 0) return name;
  }
  throw new Error("Chromium binary not found");
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}

async function startStaticServer() {
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url || "/", `http://127.0.0.1:${STATIC_PORT}`).pathname;
      const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const absolute = path.resolve(ASSET_ROOT, relative);
      if (!absolute.startsWith(path.resolve(ASSET_ROOT) + path.sep) && absolute !== path.resolve(ASSET_ROOT, "index.html")) {
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
  await new Promise(resolve => server.listen(STATIC_PORT, "127.0.0.1", resolve));
  return server;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function startBackendServer(requests) {
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type,x-daube-client");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    if (req.method === "GET" && req.url === "/api/ecosystem/status") {
      requests.push({ method: "GET", path: req.url, client: req.headers["x-daube-client"] || null });
      res.writeHead(200).end(JSON.stringify({ ok: true, source: "nexus-browser-evidence" }));
      return;
    }
    if (req.method === "POST" && req.url === "/api/v1/quest") {
      const body = await readJson(req);
      requests.push({ method: "POST", path: req.url, client: req.headers["x-daube-client"] || null, body });
      res.writeHead(200).end(JSON.stringify({ text: `Verified backend response · ${body.mode} · ${body.message}` }));
      return;
    }
    res.writeHead(404).end(JSON.stringify({ error: "NOT_FOUND" }));
  });
  await new Promise(resolve => server.listen(BACKEND_PORT, "127.0.0.1", resolve));
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
    this.ws.addEventListener("message", event => {
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
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timeout`)); }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); }
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const value = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.text || "browser evaluation failed");
    return value.result?.value;
  }
  close() { if (this.ws.readyState <= WebSocket.OPEN) this.ws.close(); }
}

async function waitFor(cdp, expression, label, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cdp.evaluate(`Boolean(${expression})`)) return;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function clickSelector(cdp, selector, touch = false) {
  const point = await cdp.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node || node.disabled || node.getAttribute('aria-disabled') === 'true') return null;
    node.scrollIntoView({ block: 'center', inline: 'center' });
    const r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!point) throw new Error(`Enabled visible control not found: ${selector}`);
  if (touch) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y, force: 1, radiusX: 2, radiusY: 2 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  }
}

async function main() {
  await mkdir(OUTPUT, { recursive: true });
  const requests = [];
  const staticServer = await startStaticServer();
  const backendServer = await startBackendServer(requests);
  const profile = await mkdtemp(path.join(os.tmpdir(), "daube-nexus-browser-"));
  const chromeLogs = [];
  const chrome = spawn(chromeBinary(), [
    "--headless=new",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    "--disable-background-networking",
    "--disable-extensions",
    "--no-first-run",
    "about:blank"
  ], { stdio: ["ignore", "pipe", "pipe"] });
  chrome.stdout?.on("data", chunk => chromeLogs.push(Buffer.from(chunk)));
  chrome.stderr?.on("data", chunk => chromeLogs.push(Buffer.from(chunk)));

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
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

    const url = `http://127.0.0.1:${STATIC_PORT}/index.html`;
    await cdp.send("Page.navigate", { url });
    await waitFor(cdp, `document.readyState === 'complete' && document.getElementById('live')`, "initial Nexus render");
    await waitFor(cdp, `document.getElementById('systemState')?.textContent === 'Chưa kết nối'`, "truthful disconnected state");

    const initial = await cdp.evaluate(`(() => ({
      title: document.title,
      logo: document.querySelector('.brand img')?.getAttribute('src') || '',
      live: document.getElementById('live')?.textContent || '',
      system: document.getElementById('systemState')?.textContent || '',
      endpoint: document.getElementById('endpointValue')?.textContent || '',
      disabledUpload: Boolean(document.querySelector('.disabled-control[disabled][aria-disabled="true"]')),
      disabledReason: document.querySelector('.disabled-control small')?.textContent || '',
      bodyText: document.body.innerText
    }))()`);
    if (initial.title !== "D’AUBE Nexus") throw new Error(`Unexpected title: ${initial.title}`);
    if (initial.logo !== "daube-ds-editorial-monogram.svg") throw new Error(`Canonical logo missing: ${initial.logo}`);
    if (initial.system !== "Chưa kết nối" || !initial.live.includes("CHƯA KẾT NỐI")) throw new Error(`Disconnected truth failed: ${JSON.stringify(initial)}`);
    if (!initial.disabledUpload || !initial.disabledReason.includes("Chưa hỗ trợ")) throw new Error("Unsupported attachment must be disabled with reason");
    if (/Dawn Achieved|Planning\s*→|Building\s*→|AGENTS\s*6|setInterval/i.test(initial.bodyText)) throw new Error("Fake completion/status text leaked into rendered Nexus");

    await cdp.evaluate(`localStorage.setItem('daube-backend-url', 'http://127.0.0.1:${BACKEND_PORT}'); localStorage.removeItem('daube-chat-history'); location.reload(); true`);
    await waitFor(cdp, `document.getElementById('systemState')?.textContent === 'Online'`, "verified backend online state");

    await cdp.evaluate(`document.getElementById('command').value = 'Evidence-bound Nexus request'; true`);
    await clickSelector(cdp, "#launch", true);
    await waitFor(cdp, `document.getElementById('console')?.textContent.includes('Verified backend response')`, "real quest response");
    await waitFor(cdp, `document.getElementById('historyCount')?.textContent === '2'`, "real local history update");

    await clickSelector(cdp, '[data-view="settings"]', true);
    await waitFor(cdp, `document.getElementById('settings')?.classList.contains('active') && document.getElementById('test-ai')`, "settings controls");
    await clickSelector(cdp, "#test-ai", true);
    await waitFor(cdp, `document.getElementById('console')?.textContent.includes('Backend online')`, "explicit health test outcome");

    const finalState = await cdp.evaluate(`(() => ({
      live: document.getElementById('live')?.textContent || '',
      system: document.getElementById('systemState')?.textContent || '',
      endpoint: document.getElementById('endpointValue')?.textContent || '',
      historyCount: document.getElementById('historyCount')?.textContent || '',
      console: document.getElementById('console')?.textContent || '',
      settingsActive: document.getElementById('settings')?.classList.contains('active') || false,
      launchDisabled: document.getElementById('launch')?.disabled || false
    }))()`);
    if (!finalState.live.includes("AI ONLINE") || finalState.system !== "Online") throw new Error(`Online truth failed: ${JSON.stringify(finalState)}`);
    if (finalState.endpoint !== `http://127.0.0.1:${BACKEND_PORT}`) throw new Error(`Endpoint readback mismatch: ${finalState.endpoint}`);
    if (finalState.historyCount !== "2") throw new Error(`History count mismatch: ${finalState.historyCount}`);
    if (!finalState.settingsActive || finalState.launchDisabled) throw new Error("Rendered control state mismatch");

    const questRequest = requests.find(item => item.method === "POST" && item.path === "/api/v1/quest");
    if (!questRequest) throw new Error("No backend quest request observed");
    if (questRequest.client !== "android") throw new Error(`Missing Android client header: ${JSON.stringify(questRequest)}`);
    if (questRequest.body?.message !== "Evidence-bound Nexus request" || questRequest.body?.mode !== "chat") throw new Error(`Quest payload mismatch: ${JSON.stringify(questRequest.body)}`);
    if (!requests.some(item => item.method === "GET" && item.path === "/api/ecosystem/status")) throw new Error("No health request observed");

    const screenshotResult = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    const screenshot = Buffer.from(screenshotResult.data || "", "base64");
    if (screenshot.length < 15_000) throw new Error(`Screenshot too small: ${screenshot.length}`);
    await writeFile(path.join(OUTPUT, "nexus-mobile.png"), screenshot);

    const evidence = {
      program: "DAUBE-NEXUS-RENDERED-RUNTIME-EVIDENCE-V1",
      generatedAt: new Date().toISOString(),
      status: "PASS",
      viewport: { width: 390, height: 844, touch: true },
      initial,
      finalState,
      observedRequests: requests,
      screenshot: { bytes: screenshot.length, sha256: sha256(screenshot) },
      truthBoundary: {
        browserAssetRuntimeVerified: true,
        backendNetworkOutcomeVerified: true,
        apkBuildVerifiedBySeparateWorkflowStep: true,
        physicalAndroidWebViewDeviceVerified: false,
        founderGoldVisualConfirmed: false
      }
    };
    await writeFile(path.join(OUTPUT, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    cdp?.close();
    chrome.kill("SIGTERM");
    await sleep(400);
    if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill("SIGKILL");
    await writeFile(path.join(OUTPUT, "chrome.log"), Buffer.concat(chromeLogs));
    await new Promise(resolve => staticServer.close(resolve));
    await new Promise(resolve => backendServer.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
