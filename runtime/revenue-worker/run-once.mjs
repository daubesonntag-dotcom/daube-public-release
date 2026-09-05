import { externalWriteDecision } from './worker.mjs';

function binding(name) {
  return Boolean(process.env[name]);
}

const adapters = [
  {
    source: 'freelancer',
    official: true,
    authenticated: binding('FREELANCER_OFFICIAL_TOKEN'),
    permitsExactAction: binding('FREELANCER_PROPOSAL_WRITE_ALLOWED'),
  },
  {
    source: 'contra',
    official: true,
    authenticated: binding('CONTRA_OFFICIAL_BINDING'),
    // Contra MCP requires provider prepare-confirm; unattended writes must remain closed.
    permitsExactAction: false,
  },
];

const decisions = adapters.map((adapter) => ({ source: adapter.source, ...externalWriteDecision(adapter) }));
console.log(JSON.stringify({ timestamp: new Date().toISOString(), decisions }, null, 2));

if (decisions.every((x) => x.action === 'FOUNDER_PLATFORM_GATE')) {
  console.log('No unattended official marketplace write rail is currently provable on this runner.');
}
