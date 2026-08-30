#!/usr/bin/env bash
set -euo pipefail

EXPECTED_SHA="${DAUBE_RELEASE_SHA:-}"
WORKER_NAME="${DAUBE_WORKER_NAME:-daube-sonntag-web}"
LIVE_ORIGIN="${DAUBE_WEB_LIVE_ORIGIN:-https://daubesonntag.com}"
HOOK_URL="${CLOUDFLARE_WEB_DEPLOY_HOOK_URL:-}"
API_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
GITHUB_ACCOUNT_ID="${DAUBE_GITHUB_ACCOUNT_ID:-297018471}"
GITHUB_ACCOUNT_NAME="${DAUBE_GITHUB_ACCOUNT_NAME:-daubesonntag-dotcom}"
GITHUB_REPO_ID="${DAUBE_GITHUB_REPO_ID:-1340463576}"
GITHUB_REPO_NAME="${DAUBE_GITHUB_REPO_NAME:-daube-web}"

fail() { printf 'ERROR %s\n' "$1" >&2; exit "${2:-1}"; }
need() { command -v "$1" >/dev/null 2>&1 || fail "missing_command:$1" 20; }
need curl
need jq

[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || fail 'expected_sha_invalid' 21
[[ "$LIVE_ORIGIN" == 'https://daubesonntag.com' ]] || fail 'live_origin_invalid' 22

verify_external() {
  local build_url="${LIVE_ORIGIN}/.well-known/daube-build.json?exact-sha=${EXPECTED_SHA:0:12}"
  local revision_url="${LIVE_ORIGIN}/__daube/revision.json?exact-sha=${EXPECTED_SHA:0:12}"
  local build_code revision_code
  for attempt in $(seq 1 60); do
    build_code="$(curl -sS -o /tmp/daube-build.json -w '%{http_code}' -H 'Accept: application/json' -H 'Cache-Control: no-cache' "$build_url" || true)"
    revision_code="$(curl -sS -o /tmp/daube-revision.json -w '%{http_code}' -H 'Accept: application/json' -H 'Cache-Control: no-cache' "$revision_url" || true)"
    if [[ "$build_code" == 200 && "$revision_code" == 200 ]] \
      && jq -e --arg sha "$EXPECTED_SHA" '.schema == "daube.web.public-build-readback.v1" and .repository == "daubesonntag-dotcom/daube-web" and .sourceRevision == $sha and .exactShaBound == true and .admissionExpectedRevision == $sha and .publicEvidenceOnly == true' /tmp/daube-build.json >/dev/null 2>&1 \
      && jq -e --arg sha "$EXPECTED_SHA" '.schema == "daube.web.source-revision.v1" and .repository == "daubesonntag-dotcom/daube-web" and .sourceRevision == $sha and .admissionExpectedRevision == $sha and .exactShaBound == true and .publicEvidenceOnly == true' /tmp/daube-revision.json >/dev/null 2>&1; then
      printf 'DAUBE_WEB_EXTERNAL_EXACT_SHA_GREEN %s\n' "$EXPECTED_SHA"
      return 0
    fi
    sleep 5
  done
  fail "external_exact_sha_readback_failed:build_http_${build_code:-none}:revision_http_${revision_code:-none}" 70
}

trigger_with_hook() {
  [[ "$HOOK_URL" =~ ^https://api\.cloudflare\.com/client/v4/workers/builds/deploy_hooks/[0-9a-fA-F-]{36}$ ]] || fail 'deploy_hook_url_invalid' 30
  local code
  code="$(curl -sS -o /tmp/cf-hook.json -w '%{http_code}' -X POST "$HOOK_URL" || true)"
  [[ "$code" == 200 || "$code" == 201 || "$code" == 202 ]] || fail "deploy_hook_trigger_http_${code}" 31
  jq -e '.success == true and (.result.build_uuid | type == "string")' /tmp/cf-hook.json >/dev/null || fail 'deploy_hook_response_invalid' 32
  printf 'CLOUDFLARE_DEPLOY_HOOK_ADMITTED build_uuid=%s\n' "$(jq -r '.result.build_uuid' /tmp/cf-hook.json)"
  verify_external
}

api() {
  curl -fsS -H "Authorization: Bearer ${API_TOKEN}" -H 'Accept: application/json' "$1"
}

trigger_with_api() {
  local code account_id worker_tag repo_uuid build_token_uuid trigger_uuid build_uuid outcome observed_sha
  code="$(curl -sS -o /tmp/cf-token.json -w '%{http_code}' -H "Authorization: Bearer ${API_TOKEN}" -H 'Accept: application/json' https://api.cloudflare.com/client/v4/user/tokens/verify || true)"
  [[ "$code" == 200 ]] && jq -e '.success == true and .result.status == "active"' /tmp/cf-token.json >/dev/null || fail 'cloudflare_api_token_not_active' 40

  api 'https://api.cloudflare.com/client/v4/accounts?per_page=50' >/tmp/cf-accounts.json
  account_id=''; worker_tag=''
  while IFS= read -r candidate; do
    [[ -n "$candidate" ]] || continue
    if api "https://api.cloudflare.com/client/v4/accounts/${candidate}/workers/scripts" >/tmp/cf-scripts.json 2>/dev/null; then
      worker_tag="$(jq -r --arg name "$WORKER_NAME" '.result[]? | select(.id == $name) | .tag // empty' /tmp/cf-scripts.json | head -n1)"
      if [[ -n "$worker_tag" ]]; then account_id="$candidate"; break; fi
    fi
  done < <(jq -r '.result[]?.id' /tmp/cf-accounts.json)
  [[ -n "$account_id" && -n "$worker_tag" ]] || fail 'canonical_worker_not_found' 41

  api "https://api.cloudflare.com/client/v4/accounts/${account_id}/builds/account/limits" >/tmp/cf-limits.json
  jq -e '.success == true and .result.has_reached_build_minutes_limit == false and (.result.build_minutes_refresh_on | type == "string")' /tmp/cf-limits.json >/dev/null || fail 'zero_spend_build_capacity_not_proven' 42

  local repo_payload
  repo_payload="$(jq -nc --arg provider_account_id "$GITHUB_ACCOUNT_ID" --arg provider_account_name "$GITHUB_ACCOUNT_NAME" --arg repo_id "$GITHUB_REPO_ID" --arg repo_name "$GITHUB_REPO_NAME" '{provider_type:"github",provider_account_id:$provider_account_id,provider_account_name:$provider_account_name,repo_id:$repo_id,repo_name:$repo_name}')"
  code="$(curl -sS -o /tmp/cf-repo.json -w '%{http_code}' -X PUT -H "Authorization: Bearer ${API_TOKEN}" -H 'Content-Type: application/json' --data "$repo_payload" "https://api.cloudflare.com/client/v4/accounts/${account_id}/builds/repos/connections" || true)"
  [[ "$code" == 200 || "$code" == 201 ]] || fail "repo_connection_http_${code}" 43
  repo_uuid="$(jq -r '.result.repo_connection_uuid // empty' /tmp/cf-repo.json)"
  [[ -n "$repo_uuid" ]] || fail 'repo_connection_uuid_missing' 44

  api "https://api.cloudflare.com/client/v4/accounts/${account_id}/builds/tokens" >/tmp/cf-build-tokens.json
  build_token_uuid="$(jq -r '.result[0].build_token_uuid // empty' /tmp/cf-build-tokens.json)"
  [[ -n "$build_token_uuid" ]] || fail 'build_token_missing' 45

  api "https://api.cloudflare.com/client/v4/accounts/${account_id}/builds/workers/${worker_tag}/triggers" >/tmp/cf-triggers.json || true
  trigger_uuid="$(jq -r '.result[]? | select((.branch_includes // []) | index("main")) | .trigger_uuid // empty' /tmp/cf-triggers.json | head -n1)"
  local build_command deploy_command trigger_payload
  build_command='test "$WORKERS_CI_COMMIT_SHA" = "$DAUBE_RELEASE_SHA" && node scripts/cloudflare/verify-git-driven-release-contract.mjs && npm run install:reproducible && npm run build && npm run verify:release:ci'
  deploy_command='npx --yes wrangler@4.115.0 deploy'
  trigger_payload="$(jq -nc --arg external_script_id "$worker_tag" --arg repo_connection_uuid "$repo_uuid" --arg build_token_uuid "$build_token_uuid" --arg build_command "$build_command" --arg deploy_command "$deploy_command" '{external_script_id:$external_script_id,repo_connection_uuid:$repo_connection_uuid,build_token_uuid:$build_token_uuid,trigger_name:"D’AUBE Web exact-head production v2",build_command:$build_command,deploy_command:$deploy_command,root_directory:"/",branch_includes:["main"],branch_excludes:[],path_includes:["*"],path_excludes:[],build_caching_enabled:true}')"
  if [[ -n "$trigger_uuid" ]]; then
    code="$(curl -sS -o /tmp/cf-trigger.json -w '%{http_code}' -X PATCH -H "Authorization: Bearer ${API_TOKEN}" -H 'Content-Type: application/json' --data "$trigger_payload" "https://api.cloudflare.com/client/v4/accounts/${account_id}/builds/triggers/${trigger_uuid}" || true)"
  else
    code="$(curl -sS -o /tmp/cf-trigger.json -w '%{http_code}' -X POST -H "Authorization: Bearer ${API_TOKEN}" -H 'Content-Type: application/json' --data "$trigger_payload" "https://api.cloudflare.com/client/v4/accounts/${account_id}/builds/triggers" || true)"
    trigger_uuid="$(jq -r '.result.trigger_uuid // empty' /tmp/cf-trigger.json)"
  fi
  [[ "$code" == 200 || "$code" == 201 ]] || fail "trigger_write_http_${code}" 46
  [[ -n "$trigger_uuid" ]] || trigger_uuid="$(jq -r '.result.trigger_uuid // empty' /tmp/cf-trigger.json)"
  [[ -n "$trigger_uuid" ]] || fail 'trigger_uuid_missing' 47

  local env_payload
  env_payload="$(jq -nc --arg sha "$EXPECTED_SHA" '{NODE_ENV:{value:"production",is_secret:false},DAUBE_RELEASE_SHA:{value:$sha,is_secret:false},DAUBE_ZERO_SPEND_MODE:{value:"1",is_secret:false},SKIP_DEPENDENCY_INSTALL:{value:"1",is_secret:false}}')"
  code="$(curl -sS -o /tmp/cf-trigger-env.json -w '%{http_code}' -X PATCH -H "Authorization: Bearer ${API_TOKEN}" -H 'Content-Type: application/json' --data "$env_payload" "https://api.cloudflare.com/client/v4/accounts/${account_id}/builds/triggers/${trigger_uuid}/environment_variables" || true)"
  [[ "$code" == 200 ]] || fail "trigger_environment_http_${code}" 48

  local build_payload
  build_payload="$(jq -nc --arg branch main --arg commit_hash "$EXPECTED_SHA" '{branch:$branch,commit_hash:$commit_hash}')"
  code="$(curl -sS -o /tmp/cf-build.json -w '%{http_code}' -X POST -H "Authorization: Bearer ${API_TOKEN}" -H 'Content-Type: application/json' --data "$build_payload" "https://api.cloudflare.com/client/v4/accounts/${account_id}/builds/triggers/${trigger_uuid}/builds" || true)"
  [[ "$code" == 200 || "$code" == 201 || "$code" == 202 ]] || fail "build_trigger_http_${code}" 49
  build_uuid="$(jq -r '.result.build_uuid // .result.uuid // empty' /tmp/cf-build.json)"
  [[ -n "$build_uuid" ]] || fail 'build_uuid_missing' 50
  printf 'CLOUDFLARE_BUILD_ADMITTED build_uuid=%s\n' "$build_uuid"

  outcome=''; observed_sha=''
  for attempt in $(seq 1 180); do
    api "https://api.cloudflare.com/client/v4/accounts/${account_id}/builds/builds/${build_uuid}" >/tmp/cf-build-status.json || true
    outcome="$(jq -r '.result.build_outcome // empty' /tmp/cf-build-status.json 2>/dev/null || true)"
    observed_sha="$(jq -r '.result.build_trigger_metadata.commit_hash // empty' /tmp/cf-build-status.json 2>/dev/null || true)"
    [[ -z "$observed_sha" || "$observed_sha" == "$EXPECTED_SHA" ]] || fail 'build_commit_mismatch' 51
    case "$outcome" in
      success) break ;;
      fail|cancelled|terminated|skipped) fail "build_${outcome}" 52 ;;
    esac
    sleep 5
  done
  [[ "$outcome" == success && "$observed_sha" == "$EXPECTED_SHA" ]] || fail 'exact_build_outcome_not_proven' 53
  verify_external
}

if [[ -n "$HOOK_URL" ]]; then
  printf 'AUTHORITY_PATH=DEPLOY_HOOK\n'
  trigger_with_hook
elif [[ -n "$API_TOKEN" ]]; then
  printf 'AUTHORITY_PATH=USER_SCOPED_API_TOKEN\n'
  trigger_with_api
else
  fail 'cloudflare_authority_absent:bind_CLOUDFLARE_WEB_DEPLOY_HOOK_URL_or_CLOUDFLARE_API_TOKEN_in_a_protected_executor' 60
fi
