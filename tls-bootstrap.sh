#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${DAUBE_TLS_ENV_FILE:-/etc/daube-tls.env}"
[[ -r "$ENV_FILE" ]] || { echo "TLS env file is missing: $ENV_FILE" >&2; exit 2; }
# shellcheck disable=SC1090
. "$ENV_FILE"

HOSTNAME="${DAUBE_TLS_HOSTNAME:-auto}"
ACME_EMAIL="${DAUBE_TLS_ACME_EMAIL:-}"
WEBROOT="${DAUBE_TLS_WEBROOT:-/var/www/letsencrypt}"
STATIC_ROOT="${DAUBE_TLS_STATIC_ROOT:-}"
TLS_SITE="/etc/nginx/sites-available/daube-provider-tls"
TLS_LINK="/etc/nginx/sites-enabled/daube-provider-tls"
RATE_FILE="/etc/nginx/conf.d/daube-tls-rate.conf"
STATE_DIR="/var/lib/daube"

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 2; }
command -v certbot >/dev/null 2>&1 || { echo "certbot is required" >&2; exit 2; }
command -v nginx >/dev/null 2>&1 || { echo "nginx is required" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 2; }

install -d -m 0755 "$WEBROOT/.well-known/acme-challenge" "$STATE_DIR"

public_ipv4() {
  local ip=''
  ip="$(curl --fail --silent --show-error --max-time 2 \
    -H 'Metadata-Flavor: Google' \
    'http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip' 2>/dev/null || true)"
  if [[ ! "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    ip="$(curl --fail --silent --show-error --max-time 2 \
      -H 'Authorization: Bearer Oracle' \
      'http://169.254.169.254/opc/v2/vnics/' 2>/dev/null \
      | jq -r '[.[]? | .publicIp // empty][0] // empty' 2>/dev/null || true)"
  fi
  if [[ ! "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    ip="$(curl --fail --silent --show-error --max-time 4 'https://api.ipify.org' 2>/dev/null || true)"
  fi
  [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  printf '%s' "$ip"
}

if [[ "$HOSTNAME" == "auto" ]]; then
  IP="$(public_ipv4)" || { echo "Unable to discover public IPv4 for automatic TLS hostname" >&2; exit 1; }
  HOSTNAME="daube-${IP//./-}.sslip.io"
fi

[[ "$HOSTNAME" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]] \
  || { echo "DAUBE_TLS_HOSTNAME is not a valid DNS hostname" >&2; exit 2; }
if [[ -n "$ACME_EMAIL" && ! "$ACME_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo "DAUBE_TLS_ACME_EMAIL is invalid" >&2
  exit 2
fi
if [[ -n "$STATIC_ROOT" && "$STATIC_ROOT" != /* ]]; then
  echo "DAUBE_TLS_STATIC_ROOT must be an absolute path" >&2
  exit 2
fi

printf '%s\n' "$HOSTNAME" > "$STATE_DIR/tls-hostname"
chmod 0644 "$STATE_DIR/tls-hostname"

cat > "$RATE_FILE" <<'NGINX'
limit_req_zone $binary_remote_addr zone=daube_tls_worker:10m rate=30r/m;
NGINX

CERT_DIR="/etc/letsencrypt/live/$HOSTNAME"
if [[ ! -s "$CERT_DIR/fullchain.pem" || ! -s "$CERT_DIR/privkey.pem" ]]; then
  args=(
    certonly
    --webroot
    --webroot-path "$WEBROOT"
    --domain "$HOSTNAME"
    --non-interactive
    --agree-tos
    --keep-until-expiring
    --key-type ecdsa
  )
  if [[ -n "$ACME_EMAIL" ]]; then
    args+=(--email "$ACME_EMAIL")
  else
    args+=(--register-unsafely-without-email)
  fi
  certbot "${args[@]}"
else
  certbot renew --cert-name "$HOSTNAME" --non-interactive --quiet \
    --deploy-hook 'systemctl reload nginx' || true
fi

[[ -s "$CERT_DIR/fullchain.pem" && -s "$CERT_DIR/privkey.pem" ]] \
  || { echo "ACME certificate is still unavailable for $HOSTNAME" >&2; exit 1; }

cat > "$TLS_SITE" <<NGINX
server {
  listen 443 ssl;
  listen [::]:443 ssl;
  server_name $HOSTNAME;
  server_tokens off;
  client_max_body_size 64k;

  ssl_certificate $CERT_DIR/fullchain.pem;
  ssl_certificate_key $CERT_DIR/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_session_cache shared:DAUBE_TLS:10m;
  ssl_session_timeout 1d;
  ssl_session_tickets off;

  add_header Strict-Transport-Security "max-age=31536000" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "no-referrer" always;
  add_header X-Frame-Options "DENY" always;
  add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

  location = /healthz {
    proxy_pass http://127.0.0.1:8790/healthz;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Proto https;
    access_log off;
  }

  location = /v1/capabilities {
    limit_req zone=daube_tls_worker burst=10 nodelay;
    proxy_pass http://127.0.0.1:8791/v1/capabilities;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Proto https;
    access_log off;
  }

  location = /v1/compute/jobs {
    limit_req zone=daube_tls_worker burst=10 nodelay;
    proxy_pass http://127.0.0.1:8791/v1/compute/jobs;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Authorization \$http_authorization;
  }
NGINX

if systemctl is-active --quiet daube-provider-attestation.service 2>/dev/null; then
  cat >> "$TLS_SITE" <<'NGINX'
  location = /v1/provider-attestation {
    limit_req zone=daube_tls_worker burst=6 nodelay;
    proxy_pass http://127.0.0.1:8792/v1/provider-attestation;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    access_log off;
  }
NGINX
fi

if [[ -n "$STATIC_ROOT" ]]; then
  cat >> "$TLS_SITE" <<NGINX
  location ~ ^/(\\.git|\\.github|scripts|tests?|governance|gradle|supabase)(/|\$) {
    deny all;
    return 404;
  }

  location ~ /\\.(?!well-known).* {
    deny all;
    return 404;
  }

  location / {
    root $STATIC_ROOT;
    index index.html;
    try_files \$uri \$uri/ /index.html;
  }
NGINX
else
  cat >> "$TLS_SITE" <<'NGINX'
  location / {
    return 404;
  }
NGINX
fi

cat >> "$TLS_SITE" <<'NGINX'
}
NGINX

ln -sfn "$TLS_SITE" "$TLS_LINK"
nginx -t
systemctl reload nginx

curl --fail --silent --show-error --max-time 10 \
  --resolve "$HOSTNAME:443:127.0.0.1" \
  "https://$HOSTNAME/healthz" >/dev/null

printf 'DAUBE_TLS_READY hostname=%s certificate=%s\n' "$HOSTNAME" "$CERT_DIR/fullchain.pem"
