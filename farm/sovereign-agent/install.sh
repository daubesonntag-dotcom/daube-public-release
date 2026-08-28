#!/usr/bin/env bash
set -euo pipefail

SOURCE_URL="${DAUBE_SOVEREIGN_AGENT_URL:-https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/2aa7806ce529d038cc54bed13a6d8d40ad4f14ce/farm/sovereign-agent/direct-agent.py}"
INSTALL_DIR="/usr/local/lib/daube-sovereign-agent"
STATE_DIR="/var/lib/daube-sovereign-host"
SERVICE_USER="daube-sovereign"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

[[ "$(uname -s)" == "Linux" ]] || { echo "Linux is required." >&2; exit 2; }
[[ "${EUID}" -eq 0 ]] || { echo "Run with sudo/root; the installed agent itself runs unprivileged." >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "python3 is required." >&2; exit 2; }
command -v openssl >/dev/null 2>&1 || { echo "openssl is required." >&2; exit 2; }
command -v curl >/dev/null 2>&1 || { echo "curl is required." >&2; exit 2; }
command -v systemctl >/dev/null 2>&1 || { echo "systemd is required for unattended refresh. On non-systemd Linux, run direct-agent.py manually on a schedule." >&2; exit 2; }

curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$SOURCE_URL" -o "$TMP"
python3 -m py_compile "$TMP"

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$STATE_DIR" --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi
install -d -o root -g root -m 0755 "$INSTALL_DIR"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 "$STATE_DIR"
install -o root -g root -m 0755 "$TMP" "$INSTALL_DIR/direct-agent.py"

cat >/etc/systemd/system/daube-sovereign-agent.service <<'UNIT'
[Unit]
Description=D'AUBE direct sovereign capability proof
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=daube-sovereign
Group=daube-sovereign
Environment=DAUBE_SOVEREIGN_HOME=/var/lib/daube-sovereign-host
ExecStart=/usr/bin/python3 /usr/local/lib/daube-sovereign-agent/direct-agent.py
SuccessExitStatus=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
MemoryDenyWriteExecute=true
ReadWritePaths=/var/lib/daube-sovereign-host
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

[Install]
WantedBy=multi-user.target
UNIT

cat >/etc/systemd/system/daube-sovereign-agent.timer <<'UNIT'
[Unit]
Description=Refresh D'AUBE sovereign proof periodically

[Timer]
OnBootSec=90s
OnUnitActiveSec=30min
RandomizedDelaySec=120s
Persistent=true
Unit=daube-sovereign-agent.service

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
set +e
sudo -u "$SERVICE_USER" env DAUBE_SOVEREIGN_HOME="$STATE_DIR" /usr/bin/python3 "$INSTALL_DIR/direct-agent.py"
RC=$?
set -e
if [[ "$RC" -ne 0 && "$RC" -ne 3 ]]; then
  echo "Initial proof failed with exit code $RC; timer not enabled." >&2
  exit "$RC"
fi
systemctl enable --now daube-sovereign-agent.timer

echo
echo "D'AUBE sovereign agent installed: outbound HTTPS only; no GitHub runner token, PAT, cloud credential, or inbound port required."
if [[ "$RC" -eq 3 ]]; then
  echo "PAIRING_REQUIRED: approve the fingerprint printed above only after confirming this exact machine is directly controlled by D'AUBE/founder."
else
  echo "Initial proof accepted; Resource Farm should auto-promote sovereign-local while evidence remains fresh."
fi
