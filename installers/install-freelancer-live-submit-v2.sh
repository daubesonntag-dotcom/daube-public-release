#!/usr/bin/env bash
set -euo pipefail

BASE="$HOME/daube-freelancer-live"
SECRET_DIR="$HOME/.config/daube/secrets"
TOKEN_FILE="$SECRET_DIR/freelancer.token"
SERVICE_NAME="daube-freelancer-live.service"
TIMER_NAME="daube-freelancer-live.timer"
mkdir -p "$BASE" "$SECRET_DIR" "$BASE/inbox" "$BASE/outbox" "$BASE/receipts" "$BASE/processed" "$BASE/dead-letter"
chmod 700 "$BASE" "$SECRET_DIR" "$BASE/inbox" "$BASE/outbox" "$BASE/receipts" "$BASE/processed" "$BASE/dead-letter"

if [[ ! -s "$TOKEN_FILE" ]]; then
  read -rsp "Freelancer OAuth access token (hidden): " FLN_TOKEN
  echo
  [[ -n "$FLN_TOKEN" ]] || { echo "ERROR: empty token" >&2; exit 4; }
  umask 077
  printf '%s' "$FLN_TOKEN" > "$TOKEN_FILE"
  unset FLN_TOKEN
fi
chmod 600 "$TOKEN_FILE"

cat > "$BASE/worker.mjs" <<'NODE'
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = path.join(os.homedir(), 'daube-freelancer-live');
const TOKEN_FILE = path.join(os.homedir(), '.config', 'daube', 'secrets', 'freelancer.token');
const INBOX = path.join(BASE, 'inbox');
const OUTBOX = path.join(BASE, 'outbox');
const RECEIPTS = path.join(BASE, 'receipts');
const PROCESSED = path.join(BASE, 'processed');
const DEAD = path.join(BASE, 'dead-letter');
const URL = 'https://www.freelancer.com';
for (const d of [INBOX, OUTBOX, RECEIPTS, PROCESSED, DEAD]) fs.mkdirSync(d, {recursive:true, mode:0o700});

function token() {
  const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  if (!t) throw new Error('FLN_OAUTH_TOKEN_REQUIRED');
  return t;
}
function headers(json=false) {
  const h = {'Freelancer-OAuth-V1': token(), 'User-Agent':'D-AUBE-Revenue-Worker/2.0', 'Accept':'application/json'};
  if (json) h['Content-Type']='application/json';
  return h;
}
async function provider(url, init={}) {
  const r = await fetch(url, init);
  let body;
  try { body = await r.json(); } catch { body={message:'NON_JSON_PROVIDER_RESPONSE'}; }
  if (!r.ok) throw new Error(body?.message || `HTTP_${r.status}`);
  return body;
}
async function self() {
  const b=await provider(`${URL}/api/users/0.1/self/`,{headers:headers()});
  const id=Number(b?.result?.id);
  if(!Number.isInteger(id)||id<=0) throw new Error('FREELANCER_SELF_ID_MISSING');
  return id;
}
function safeName(v){return String(v??'').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120)}
function alreadySubmitted(projectId){
  return fs.readdirSync(RECEIPTS).some(n=>{
    try { const x=JSON.parse(fs.readFileSync(path.join(RECEIPTS,n),'utf8')); return Number(x.project_id)===Number(projectId)&&x.authoritative===true&&Number(x.bid_id)>0; }
    catch{return false}
  });
}
function validate(x){
  const e=[];
  if(String(x.source??'').toLowerCase().startsWith('freelancer')===false)e.push('SOURCE_NOT_FREELANCER');
  if(!Number.isInteger(Number(x.project_id))||Number(x.project_id)<=0)e.push('PROJECT_ID_REQUIRED');
  if(!(Number(x.amount)>=25&&Number(x.amount)<=1000))e.push('AMOUNT_OUTSIDE_STANDARD_AUTHORITY');
  if(!(Number.isInteger(Number(x.period))&&Number(x.period)>=1&&Number(x.period)<=3))e.push('DELIVERY_OUTSIDE_72H');
  if(typeof x.description!=='string'||x.description.trim().length<80)e.push('TAILORED_DESCRIPTION_REQUIRED');
  if(x.confirm_standard_contract!==true)e.push('STANDARD_CONTRACT_GUARD_REQUIRED');
  if(x.paid_spend_required===true)e.push('PAID_SPEND_BLOCKED');
  if(x.nonstandard_legal_terms===true)e.push('NONSTANDARD_TERMS_BLOCKED');
  return e;
}
async function submit(x){
  const e=validate(x);
  if(e.length)return {ok:false,state:'FOUNDER_PLATFORM_GATE',errors:e};
  if(alreadySubmitted(x.project_id))return {ok:true,state:'ALREADY_SUBMITTED',offer_sent:false,project_id:Number(x.project_id)};
  const bidder_id=await self();
  const payload={project_id:Number(x.project_id),bidder_id,amount:Number(x.amount),period:Number(x.period),milestone_percentage:Number(x.milestone_percentage??100),description:x.description.trim()};
  const b=await provider(`${URL}/api/projects/0.1/bids/`,{method:'POST',headers:headers(true),body:JSON.stringify(payload)});
  const bid_id=Number(b?.result?.id);
  if(!Number.isInteger(bid_id)||bid_id<=0)throw new Error('AUTHORITATIVE_BID_ID_MISSING');
  const receipt={type:'marketplace_submission_receipt',authoritative:true,provider:'freelancer_official_api',recorded_at:new Date().toISOString(),project_id:payload.project_id,bid_id,bidder_id,submitted_amount:payload.amount,delivery_days:payload.period,request_id:b?.request_id??null};
  fs.writeFileSync(path.join(RECEIPTS,`${payload.project_id}-${bid_id}.json`),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
  return {ok:true,state:'SUBMITTED',offer_sent:true,provider_evidence:receipt};
}
async function main(){
  const me=await self();
  console.log(JSON.stringify({at:new Date().toISOString(),freelancer_api:'AUTHENTICATED',user_id:me}));
  const files=fs.readdirSync(INBOX).filter(n=>n.endsWith('.json')).sort();
  for(const n of files){
    const src=path.join(INBOX,n); const stem=safeName(n.replace(/\.json$/,''));
    try{
      const x=JSON.parse(fs.readFileSync(src,'utf8'));
      const r=await submit(x);
      fs.writeFileSync(path.join(OUTBOX,`${stem}.result.json`),JSON.stringify(r,null,2)+'\n',{mode:0o600});
      fs.renameSync(src,path.join(PROCESSED,n));
      console.log(JSON.stringify({input:n,...r}));
    }catch(err){
      const r={ok:false,state:'PROVIDER_ERROR_FAIL_CLOSED',error:err instanceof Error?err.message:String(err)};
      fs.writeFileSync(path.join(OUTBOX,`${stem}.error.json`),JSON.stringify(r,null,2)+'\n',{mode:0o600});
      fs.renameSync(src,path.join(DEAD,n));
      console.error(JSON.stringify({input:n,...r}));
    }
  }
}
main().catch(e=>{console.error(JSON.stringify({ok:false,state:'AUTH_OR_PROVIDER_GATE',error:e.message}));process.exitCode=2});
NODE
chmod 700 "$BASE/worker.mjs"

# Verify the credential before enabling any live-submit unit.
if ! node "$BASE/worker.mjs" </dev/null | head -n 1 | grep -q '"freelancer_api":"AUTHENTICATED"'; then
  echo "ERROR: Freelancer OAuth token verification failed; service not enabled." >&2
  exit 9
fi

echo "Freelancer API identity verified."

sudo tee "/etc/systemd/system/$SERVICE_NAME" >/dev/null <<EOF
[Unit]
Description=D'AUBE official Freelancer live-submit worker
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$(id -un)
Environment=HOME=$HOME
ExecStart=$(command -v node) $BASE/worker.mjs
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$BASE
ReadOnlyPaths=$SECRET_DIR
EOF

sudo tee "/etc/systemd/system/$TIMER_NAME" >/dev/null <<EOF
[Unit]
Description=Run D'AUBE official Freelancer live-submit worker

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
Persistent=true
RandomizedDelaySec=30

[Install]
WantedBy=timers.target
EOF

# Disable the legacy scout timer to prevent duplicate worker ownership.
sudo systemctl disable --now daube-revenue-worker.timer 2>/dev/null || true
sudo systemctl daemon-reload
sudo systemctl enable --now "$TIMER_NAME"
sudo systemctl start "$SERVICE_NAME"

echo "=== API AUTH READBACK ==="
journalctl -u "$SERVICE_NAME" -n 12 --no-pager || true
echo "=== TIMER READBACK ==="
systemctl --no-pager list-timers "$TIMER_NAME" || true
echo "READY: D'AUBE official Freelancer runtime installed. Live submissions are accepted only from guarded JSON packets placed in $BASE/inbox."
