#!/usr/bin/env bash
set -Eeuo pipefail

HARDEN_SSH="${HARDEN_SSH:-false}"
SWAP_MB="${SWAP_MB:-2048}"

log() {
  printf '[bootstrap] %s\n' "$1"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  }
}

if [[ "$(id -u)" -eq 0 ]]; then
  printf 'Run as a regular sudo user, not root.\n' >&2
  exit 1
fi

require_cmd sudo

log "Updating apt metadata"
sudo apt-get update -y

log "Installing base packages"
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates \
  curl \
  fail2ban \
  git \
  jq \
  openssh-server \
  python3 \
  python3-venv \
  ufw \
  unattended-upgrades

log "Installing Docker Engine and compose plugin"
if ! sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-plugin; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2
fi
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"

if [[ "$SWAP_MB" -gt 0 ]]; then
  if sudo swapon --show | grep -q '/swapfile'; then
    log "Swapfile already exists"
  else
    log "Creating ${SWAP_MB}MB swapfile"
    sudo fallocate -l "${SWAP_MB}M" /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    if ! grep -q '^/swapfile ' /etc/fstab; then
      echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
    fi
  fi
fi

log "Configuring UFW"
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw --force enable

log "Enabling fail2ban and unattended upgrades"
sudo systemctl enable --now fail2ban
sudo dpkg-reconfigure -f noninteractive unattended-upgrades

if [[ "$HARDEN_SSH" == "true" ]]; then
  log "Applying SSH hardening (key-only auth)"
  sudo install -d -m 755 /etc/ssh/sshd_config.d
  cat <<'EOF' | sudo tee /etc/ssh/sshd_config.d/60-openclaw-hardening.conf >/dev/null
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
EOF
  sudo systemctl restart ssh
fi

log "Bootstrap complete"
log "Important: log out and back in so docker group membership is applied."
