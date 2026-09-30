#!/usr/bin/env node
import crypto from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const prefix = process.env.HARNESS_PREFIX;
if (!prefix) throw new Error("HARNESS_PREFIX_required");
const require = createRequire(path.join(prefix, "package.json"));
const { chromium } = require("playwright");
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const targetUrl = publicHttpsUrl(process.env.TARGET_URL);
await assertPublicDns(targetUrl.hostname);
const expectedRevision = normalizeOptionalSha(process.env.EXPECTED_REVISION);
const workloadDigest = normalizeOptionalDigest(process.env.WORKLOAD_DIGEST);
const viewport = {
  width: boundedInt(process.env.VIEWPORT_WIDTH, 240, 7680, 1440),
  height: boundedInt(process.env.VIEWPORT_HEIGHT, 240, 4320, 1000)
};
const scenario = token(process.env.SCENARIO || "default", 80);
const outputDir = path.resolve(process.env.OUTPUT_DIR || "outputs/community-browser-harness-v1");
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport,
  reducedMotion: scenario === "reduced-motion" ? "reduce" : "no-preference",
  colorScheme: scenario === "dark" ? "dark" : "light"
});
const page = await context.newPage();
const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];
page.on("pageerror", error => pageErrors.push(String(error?.message || error).slice(0, 500)));
page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 500)); });
page.on("requestfailed", req => failedRequests.push({ url: req.url().slice(0, 500), error: req.failure()?.errorText || "unknown" }));

let response;
let statusCode = null;
let finalUrl = null;
let title = null;
let visibleTextChars = 0;
let metrics = null;
let axe = null;
let observedRevision = null;
let screenshotSha256 = null;
let screenshotPath = null;
let fatalError = null;

try {
  response = await page.goto(targetUrl.toString(), { waitUntil: "domcontentloaded", timeout: 45_000 });
  statusCode = response?.status() ?? null;
  finalUrl = page.url();
  await page.waitForTimeout(800);
  title = await page.title();
  metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    visibleTextChars: (document.body?.innerText || "").trim().length,
    metaRevision: document.querySelector('meta[name="daube-revision"]')?.getAttribute("content") || null,
    datasetRevision: document.documentElement?.dataset?.daubeRevision || document.body?.dataset?.daubeRevision || null
  }));
  visibleTextChars = metrics.visibleTextChars;
  observedRevision = normalizeObservedRevision(
    response?.headers()?.["x-daube-revision"] ||
    response?.headers()?.["x-deployment-revision"] ||
    metrics.metaRevision ||
    metrics.datasetRevision
  );

  await page.addScriptTag({ content: axeSource });
  axe = await page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }
    });
    return {
      violations: result.violations.map(v => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.length,
        description: v.description
      }))
    };
  });

  screenshotPath = path.join(outputDir, "screenshot.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  screenshotSha256 = sha256(fs.readFileSync(screenshotPath));
} catch (error) {
  fatalError = String(error?.stack || error).slice(0, 2000);
} finally {
  await browser.close();
}

const seriousOrCritical = (axe?.violations || []).filter(v => v.impact === "serious" || v.impact === "critical");
const horizontalOverflow = metrics ? Math.max(0, metrics.scrollWidth - metrics.clientWidth) : null;
const revisionMatched = expectedRevision ? observedRevision === expectedRevision : null;
const result = {
  schema: "daube.community-browser-evidence.v1",
  providerId: "github-public-actions",
  publicSafe: true,
  privateDataObserved: false,
  secretObserved: false,
  targetUrl: targetUrl.toString(),
  finalUrl,
  scenario,
  viewport,
  statusCode,
  title,
  visibleTextChars,
  horizontalOverflowPx: horizontalOverflow,
  accessibility: {
    totalViolations: axe?.violations?.length ?? null,
    seriousOrCritical: seriousOrCritical.length,
    violations: axe?.violations || []
  },
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    hostnameClass: os.hostname() ? "ephemeral-host" : "unknown",
    pageErrors,
    consoleErrors,
    failedRequests
  },
  revision: {
    expected: expectedRevision,
    observed: observedRevision,
    matched: revisionMatched
  },
  screenshot: screenshotPath ? {
    file: path.basename(screenshotPath),
    sha256: screenshotSha256
  } : null,
  workloadDigest,
  supplementalOnly: workloadDigest === null,
  fatalError
};

const pass =
  !fatalError &&
  typeof statusCode === "number" && statusCode < 400 &&
  visibleTextChars > 0 &&
  (horizontalOverflow ?? 999) <= 1 &&
  seriousOrCritical.length === 0 &&
  pageErrors.length === 0 &&
  (revisionMatched !== false);

result.status = pass ? "PASS" : "FAIL";
result.resultDigest = sha256(Buffer.from(JSON.stringify({
  status: result.status,
  statusCode,
  finalUrl,
  viewport,
  scenario,
  visibleTextChars,
  horizontalOverflow,
  seriousOrCritical: seriousOrCritical.map(v => [v.id, v.nodes]),
  pageErrors,
  revisionMatched,
  screenshotSha256
})));
result.evidenceDigest = sha256(Buffer.from(JSON.stringify(result)));
if (workloadDigest) {
  result.communityReceipt = {
    schema: "daube.community-receipt.v1",
    providerId: "github-public-actions",
    workloadDigest,
    publicSafe: true,
    privateDataObserved: false,
    secretObserved: false,
    resultDigest: result.resultDigest,
    evidenceDigest: result.evidenceDigest
  };
}

const receiptPath = path.join(outputDir, "receipt.json");
fs.writeFileSync(receiptPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  status: result.status,
  targetUrl: result.targetUrl,
  statusCode,
  seriousOrCritical: seriousOrCritical.length,
  horizontalOverflowPx: horizontalOverflow,
  pageErrors: pageErrors.length,
  screenshotSha256,
  workloadDigest,
  receiptPath
}, null, 2));
process.exit(pass ? 0 : 1);

function publicHttpsUrl(raw) {
  let url;
  try { url = new URL(String(raw || "")); } catch { throw new Error("target_url_invalid"); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("target_url_must_be_public_https");
  if (isForbiddenHost(url.hostname)) throw new Error("target_url_private_host_forbidden");
  return url;
}
async function assertPublicDns(hostname) {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!records.length) throw new Error("target_dns_empty");
  for (const record of records) {
    if (isPrivateIp(record.address)) throw new Error(`target_dns_private_ip_forbidden:${record.address}`);
  }
}
function isForbiddenHost(host) {
  const h=String(host||"").toLowerCase();
  return h === "localhost" || h.endsWith(".local") || isPrivateIp(h);
}
function isPrivateIp(value) {
  const family=net.isIP(value);
  if (family === 4) {
    const p=value.split(".").map(Number);
    return p[0]===10 || p[0]===127 || p[0]===0 || (p[0]===169&&p[1]===254) ||
      (p[0]===172&&p[1]>=16&&p[1]<=31) || (p[0]===192&&p[1]===168) ||
      (p[0]===100&&p[1]>=64&&p[1]<=127) || p[0]>=224;
  }
  if (family === 6) {
    const v=value.toLowerCase();
    return v==="::1" || v==="::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
  }
  return false;
}
function normalizeOptionalSha(v) {
  const s=String(v||"").trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-f0-9]{40}$/.test(s)) throw new Error("expected_revision_invalid");
  return s;
}
function normalizeObservedRevision(v) {
  const s=String(v||"").trim().toLowerCase();
  return /^[a-f0-9]{40}$/.test(s) ? s : null;
}
function normalizeOptionalDigest(v) {
  const s=String(v||"").trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-f0-9]{64}$/.test(s)) throw new Error("workload_digest_invalid");
  return s;
}
function boundedInt(v,min,max,fallback) {
  if (v===undefined || v===null || v==="") return fallback;
  const n=Number(v);
  if (!Number.isInteger(n) || n<min || n>max) throw new Error("viewport_invalid");
  return n;
}
function token(v,max) {
  const s=String(v||"").trim();
  if (!s || s.length>max || /[\r\n]/.test(s)) throw new Error("scenario_invalid");
  return s;
}
function sha256(data) { return crypto.createHash("sha256").update(data).digest("hex"); }
