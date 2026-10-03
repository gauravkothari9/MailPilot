#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 EC2 instance for MailPilot.
# Installs Node 22, MongoDB 8 (localhost only), PM2, Nginx, firewall, swap and daily backups.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> System packages"
sudo apt-get update -y
sudo apt-get install -y curl gnupg nginx ufw

echo "==> Node.js 22"
if ! node -v 2>/dev/null | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo npm install -g pm2

# MongoDB 8.0 refuses to start on Linux kernel >= 6.19 (SERVER-121912); current Ubuntu 24.04
# AWS images ship kernel 7.x, so use the 8.2 series (signed with the 8.0 key).
echo "==> MongoDB 8.2"
if ! command -v mongod >/dev/null; then
  curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | sudo gpg --dearmor --yes -o /usr/share/keyrings/mongodb-server-8.0.gpg
  echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.2 multiverse" \
    | sudo tee /etc/apt/sources.list.d/mongodb-org-8.2.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y mongodb-org
fi
sudo systemctl enable --now mongod   # listens on 127.0.0.1 only (default config)

echo "==> 2 GB swap (protects small instances from running out of memory)"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "==> App folder"
sudo mkdir -p /opt/mailpilot && sudo chown "$USER:$USER" /opt/mailpilot

echo "==> Nginx"
sudo cp "$HERE/nginx-mailpilot.conf" /etc/nginx/sites-available/mailpilot
sudo ln -sf /etc/nginx/sites-available/mailpilot /etc/nginx/sites-enabled/mailpilot
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo "==> Firewall (SSH, HTTP, HTTPS only)"
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable

echo "==> Daily database backup at 03:00, keeps 7 days"
mkdir -p "$HOME/backups"
CRON="0 3 * * * mongodump --db mailpilot --gzip --archive=$HOME/backups/mailpilot-\$(date +\\%F).gz && find $HOME/backups -name '*.gz' -mtime +7 -delete"
# (a fresh server has no crontab yet, so tolerate the empty listing)
{ { crontab -l 2>/dev/null || true; } | { grep -v 'mongodump --db mailpilot' || true; }; echo "$CRON"; } | crontab -

echo "==> PM2 starts on boot"
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null

echo "Server setup complete."
