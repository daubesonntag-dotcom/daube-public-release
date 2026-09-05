import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { probeCloudflareControlPlane } from './cloudflare-control-plane.mjs';

const stateRoot = process.env.DAUBE_EXECUTOR_STATE_ROOT || '/var/lib/daube-executor';
const target = path.join(stateRoot, 'cloudflare-control-plane.json');
const zoneName = process.env.DAUBE_CLOUDFLARE_ZONE || 'daubesonntag.com';
const intervalMs = Math.max(30_000, Number(process.env.DAUBE_CLOUDFLARE_PROBE_MS || 60_000));
let inFlight = false;

function writeAtomic(value) {
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, target);
}

async function probeOnce() {
  if (inFlight) return;
  inFlight = true;
  try {
    const result = await probeCloudflareControlPlane({
      token: process.env.CLOUDFLARE_API_TOKEN,
      zoneName,
    });
    const snapshot = {
      schema: 'daube.cloudflare-control-plane.v1',
      observedAt: new Date().toISOString(),
      status: result.status,
      tokenVerified: result.tokenVerified === true,
      zone: result.zone || null,
      dnsRecordCount: result.dnsRecordCount,
      pages: result.pages,
      blocker: result.blocker || null,
    };
    writeAtomic(snapshot);
    process.stdout.write(`${JSON.stringify({ service: 'daube-cloudflare-control-plane', event: 'probe', status: snapshot.status, at: snapshot.observedAt })}\n`);
  } catch (error) {
    const snapshot = {
      schema: 'daube.cloudflare-control-plane.v1',
      observedAt: new Date().toISOString(),
      status: 'HOLD_CLOUDFLARE_HOOK_ERROR',
      tokenVerified: false,
      zone: null,
      dnsRecordCount: null,
      pages: { visible: false, projectCount: null, projectNames: [] },
      blocker: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
    };
    writeAtomic(snapshot);
  } finally {
    inFlight = false;
  }
}

void probeOnce();
const timer = setInterval(() => { void probeOnce(); }, intervalMs);
timer.unref();
