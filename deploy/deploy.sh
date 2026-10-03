#!/usr/bin/env bash
# Builds the app on this PC and ships it to the EC2 server. Run from Git Bash:
#
#   deploy/deploy.sh <server-ip> <path-to-key.pem>              # update code only
#   deploy/deploy.sh <server-ip> <path-to-key.pem> --first-time # also sets up the server, .env and data
#
set -euo pipefail
IP="${1:?server ip}"; KEY="${2:?path to .pem key}"; MODE="${3:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="ubuntu@$IP"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$TARGET")
SCP=(scp -i "$KEY" -o StrictHostKeyChecking=accept-new)

echo "==> Building the React app"
(cd "$ROOT/client" && npx vite build >/dev/null)

echo "==> Packaging"
PKG="$(mktemp -d)/mailpilot.tgz"
tar -czf "$PKG" -C "$ROOT" --exclude='node_modules' --exclude='server/.env' --exclude='server/scripts/*.json' \
  package.json server client/dist

if [[ "$MODE" == "--first-time" ]]; then
  echo "==> Server setup (Node, MongoDB, Nginx, firewall, backups) - takes a few minutes"
  "${SCP[@]}" "$ROOT/deploy/setup-server.sh" "$ROOT/deploy/nginx-mailpilot.conf" "$TARGET:/tmp/"
  "${SSH[@]}" "bash /tmp/setup-server.sh"

  echo "==> Production .env (reuses your encryption key so saved sender passwords keep working)"
  get() { grep -E "^$1=" "$ROOT/server/.env" | head -1 | cut -d= -f2-; }
  ENVFILE="$(mktemp)"
  cat > "$ENVFILE" <<ENV
PORT=5000
HOST=127.0.0.1
NODE_ENV=production
MONGODB_URI=mongodb://127.0.0.1:27017/mailpilot
PUBLIC_URL=http://$IP
ENCRYPTION_KEY=$(get ENCRYPTION_KEY)
JWT_SECRET=$(get JWT_SECRET)
ENV
  "${SSH[@]}" "mkdir -p /opt/mailpilot/server"
  "${SCP[@]}" "$ENVFILE" "$TARGET:/opt/mailpilot/server/.env"
  rm -f "$ENVFILE"
  "${SSH[@]}" "chmod 600 /opt/mailpilot/server/.env"
fi

echo "==> Uploading and installing"
"${SCP[@]}" "$PKG" "$TARGET:/tmp/mailpilot.tgz"
"${SSH[@]}" "set -e
  tar -xzf /tmp/mailpilot.tgz -C /opt/mailpilot
  cd /opt/mailpilot/server && npm ci --omit=dev --no-audit --no-fund >/dev/null"

if [[ "$MODE" == "--first-time" && -f "$ROOT/deploy/mailpilot-data.json" ]]; then
  echo "==> Restoring your data"
  "${SCP[@]}" "$ROOT/deploy/mailpilot-data.json" "$TARGET:/tmp/mailpilot-data.json"
  "${SSH[@]}" "cd /opt/mailpilot/server && node scripts/data-transfer.js import /tmp/mailpilot-data.json && rm /tmp/mailpilot-data.json"
fi

echo "==> (Re)starting"
"${SSH[@]}" "cd /opt/mailpilot/server && pm2 startOrReload ecosystem.config.js --update-env && pm2 save >/dev/null"
sleep 3
if curl -fsS "http://$IP/api/auth/status" >/dev/null; then
  echo "✓ MailPilot is live at http://$IP"
else
  echo "! Deployed, but http://$IP did not respond yet. Check: ssh -i $KEY $TARGET 'pm2 logs mailpilot --lines 50'"
fi
