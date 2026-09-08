#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail
umask 077
HOST_ALIAS="${DAUBE_HOST_ALIAS:-daube-host-01}"
PR_BRANCH="${DAUBE_PR_BRANCH:-automation/zero-cost-runner-harvest-20260909}"
LOG_DIR="$HOME/.daube-v3"; LOG_FILE="$LOG_DIR/recovery.log"; mkdir -p "$LOG_DIR"
log(){ printf '[%s] %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG_FILE"; }
die(){ log "ERROR: $*"; exit 1; }
case "${PREFIX:-}" in *com.termux*) ;; *) die 'Run inside Termux on Android.';; esac
termux-wake-lock 2>/dev/null || true
pkg install -y openssh autossh tmux coreutils procps >/dev/null
ssh -G "$HOST_ALIAS" >/dev/null 2>&1 || die "SSH alias '$HOST_ALIAS' missing in $HOME/.ssh/config"
ssh -o BatchMode=yes -o ConnectTimeout=12 "$HOST_ALIAS" 'printf ok' >/dev/null 2>&1 || die "Cannot reach $HOST_ALIAS with key-based SSH"
log "Recovering $HOST_ALIAS..."
ssh -tt -o ServerAliveInterval=20 -o ServerAliveCountMax=6 "$HOST_ALIAS" "DAUBE_PR_BRANCH='$PR_BRANCH' bash -s" <<'REMOTE'
set -Eeuo pipefail
REPO="$HOME/daube/daube-compute-mesh"; PR_BRANCH="${DAUBE_PR_BRANCH:-automation/zero-cost-runner-harvest-20260909}"
say(){ printf '[HOST %s] %s\n' "$(date '+%F %T')" "$*"; }
[[ -d "$REPO/.git" ]] || { say "missing $REPO"; exit 20; }
cd "$REPO"
say '1/5 enterprise recovery'
bash scripts/enterprise-host-recovery.sh
say '2/5 Remote Commander repair'
service_user="$(id -un)"; remote_unit="daube-remote-control-agent@${service_user}.service"
sudo -n systemctl reset-failed "$remote_unit" 2>/dev/null || true
sudo -n systemctl enable --now "$remote_unit" >/dev/null
sudo -n systemctl restart "$remote_unit"
sleep 3
systemctl is-active --quiet "$remote_unit" || { journalctl -u "$remote_unit" -n 60 --no-pager >&2 || true; exit 21; }
say "remote agent active: $remote_unit"
say '3/5 self-hosted runner repair'
mapfile -t runners < <(systemctl list-unit-files 'actions.runner*.service' --no-legend 2>/dev/null | awk '{print $1}' | sort -u)
if ((${#runners[@]})); then
  for unit in "${runners[@]}"; do sudo -n systemctl reset-failed "$unit" 2>/dev/null || true; sudo -n systemctl enable --now "$unit" >/dev/null 2>&1 || true; sudo -n systemctl restart "$unit" || true; say "runner $unit=$(systemctl is-active "$unit" 2>/dev/null || true)"; done
else say 'no system actions.runner service found'; fi
say '4/5 zero-cost PR validation in detached worktree'
TMP="/tmp/daube-pr233-$$"; rm -rf "$TMP"
if git fetch --no-tags origin "refs/heads/$PR_BRANCH:refs/remotes/origin/$PR_BRANCH" >/dev/null 2>&1; then
  git worktree add --detach "$TMP" "refs/remotes/origin/$PR_BRANCH" >/dev/null
  trap 'git -C "$REPO" worktree remove --force "$TMP" >/dev/null 2>&1 || rm -rf "$TMP"' EXIT
  cd "$TMP"
  node -e "JSON.parse(require('fs').readFileSync('config/community-ci-resource-registry-v1.json','utf8')); console.log('registry JSON PASS')"
  node --check src/gpu-fabric-control-plane-v3.mjs
  npm run test:gpu-fabric-v3
  cd "$REPO"; git worktree remove --force "$TMP" >/dev/null; trap - EXIT
else say "PR branch unavailable: $PR_BRANCH"; fi
say '5/5 health'
printf 'compute-mesh: '; systemctl is-active daube-compute-mesh.service || true
printf 'remote-agent: '; systemctl is-active "$remote_unit" || true
printf 'ssh: '; systemctl is-active ssh.service 2>/dev/null || systemctl is-active sshd.service 2>/dev/null || true
printf 'healthz: '; curl -fsS --max-time 4 http://127.0.0.1:8787/healthz >/dev/null && echo PASS || echo FAIL
say 'TERMUX_CONTROL_RECOVERY=PASS'
REMOTE
log 'Reviving persistent Termux control loops...'
[[ -x "$HOME/.termux/boot/daube-v2" ]] && "$HOME/.termux/boot/daube-v2" >/dev/null 2>&1 || true
[[ -x "$HOME/.daube-v2/autossh.sh" ]] && { tmux has-session -t daube-autossh 2>/dev/null || tmux new-session -d -s daube-autossh "$HOME/.daube-v2/autossh.sh"; } || true
[[ -x "$HOME/.daube-v2/operator.sh" ]] && { tmux has-session -t daube-operator 2>/dev/null || tmux new-session -d -s daube-operator "$HOME/.daube-v2/operator.sh"; } || true
log 'PASS: Termux control recovery completed.'
tmux ls 2>/dev/null || true
