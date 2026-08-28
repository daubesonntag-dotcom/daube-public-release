#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${DAUBE_PROVIDER_PROOF_ENV_FILE:-/etc/daube-provider-proof.env}"
[[ -r "$ENV_FILE" ]] || { echo "provider proof env missing" >&2; exit 2; }
# shellcheck disable=SC1090
. "$ENV_FILE"

INTAKE_URL="${DAUBE_ORACLE_A1_INTAKE_URL:-}"
TLS_HOST_FILE="${DAUBE_TLS_HOST_FILE:-/var/lib/daube/tls-hostname}"
STATE_FILE="${DAUBE_PROVIDER_PROOF_STATE_FILE:-/var/lib/daube/oracle-a1-proof.json}"

[[ "$INTAKE_URL" == https://* ]] || { echo "provider proof intake must be HTTPS" >&2; exit 2; }

for _ in $(seq 1 60); do
  if [[ -s "$TLS_HOST_FILE" ]]; then break; fi
  sleep 5
done
[[ -s "$TLS_HOST_FILE" ]] || { echo "TLS hostname unavailable" >&2; exit 1; }

HOSTNAME="$(tr -d '\r\n' < "$TLS_HOST_FILE")"
[[ "$HOSTNAME" =~ ^daube-([0-9]{1,3}-){3}[0-9]{1,3}\.sslip\.io$ ]] || { echo "automatic sslip.io hostname required for autonomous proof" >&2; exit 2; }
BASE_URL="https://${HOSTNAME}"
PAYLOAD="$(jq -nc --arg base_url "$BASE_URL" '{base_url:$base_url}')"
RESPONSE="$(curl --fail-with-body --silent --show-error --max-time 30 \
  -H 'Content-Type: application/json' -H 'Accept: application/json' \
  --data "$PAYLOAD" "$INTAKE_URL")"

printf '%s\n' "$RESPONSE" | jq -e '.status == "ORACLE_A1_LIVE" and .providerId == "oracle-a1-free" and .signatureVerified == true and .oracleIpRangeVerified == true and .persistentLinuxVpsProven == true and .paidSpendAuthorized == false' >/dev/null
install -d -m 0755 "$(dirname "$STATE_FILE")"
TMP="${STATE_FILE}.tmp.$$"
printf '%s\n' "$RESPONSE" > "$TMP"
chmod 0644 "$TMP"
mv -f "$TMP" "$STATE_FILE"
printf 'DAUBE_ORACLE_A1_PROOF_PUBLISHED base_url=%s\n' "$BASE_URL"
