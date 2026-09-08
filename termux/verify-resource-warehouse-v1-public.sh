#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail
umask 077
HOST_ALIAS="${DAUBE_HOST_ALIAS:-daube-host-01}"
HOST_VERIFIER_SHA="4436ca1333ca67eb17a56274dc9b76dd69ac863d"
HOST_VERIFIER_URL="https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/${HOST_VERIFIER_SHA}/host/verify-resource-warehouse-public-v2.sh"

command -v ssh >/dev/null 2>&1 || { echo 'OpenSSH missing in Termux.' >&2; exit 20; }
ssh -G "$HOST_ALIAS" >/dev/null 2>&1 || { echo "SSH alias missing: $HOST_ALIAS" >&2; exit 10; }
ssh -o BatchMode=yes -o ConnectTimeout=12 "$HOST_ALIAS" "curl -fsSL --proto '=https' --tlsv1.2 '$HOST_VERIFIER_URL' | bash"
