#!/bin/bash
# Full server setup for 3Dmol AlphaFold Multimer Viewer
# Run as ubuntu user with sudo rights on a fresh Ubuntu 22.04 instance
# Usage: bash setup.sh [AFM_DIR]
#   AFM_DIR defaults to /mnt/3dmol/test_data/AFM

set -e

AFM_DIR="${1:-/mnt/3dmol/test_data/AFM}"
APP_DIR="/opt/3dmol-app"
REPO="https://github.com/KristinaGagalova/3dmol-viewer-ccdm.git"

echo "=== 3Dmol Viewer Setup ==="
echo "App dir : $APP_DIR"
echo "AFM dir : $AFM_DIR"
echo ""

# ── Node.js ──────────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "Node $(node --version) / npm $(npm --version)"

# ── nginx ────────────────────────────────────────────────────────────────────
if ! command -v nginx &>/dev/null; then
  echo "Installing nginx..."
  sudo apt-get install -y nginx
fi

# ── App ──────────────────────────────────────────────────────────────────────
sudo mkdir -p "$APP_DIR"
sudo chown -R ubuntu:ubuntu "$APP_DIR"

if [ -d "$APP_DIR/.git" ]; then
  echo "Updating existing installation..."
  git -C "$APP_DIR" pull
else
  echo "Cloning repo..."
  git clone "$REPO" "$APP_DIR"
fi

cd "$APP_DIR"
npm install --omit=dev

# ── systemd service ───────────────────────────────────────────────────────────
sudo sed "s|AFM_DIR=.*|AFM_DIR=$AFM_DIR|" deploy/3dmol.service \
  | sudo tee /etc/systemd/system/3dmol.service > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable 3dmol
sudo systemctl restart 3dmol

# ── nginx config ──────────────────────────────────────────────────────────────
sudo cp deploy/nginx-3dmol.conf /etc/nginx/sites-available/3dmol
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/3dmol /etc/nginx/sites-enabled/3dmol
sudo nginx -t && sudo systemctl reload nginx

echo ""
echo "=== Setup complete ==="
echo "App: http://$(curl -s ifconfig.me 2>/dev/null || echo '<server-ip>')"
echo ""
echo "IMPORTANT: set your credentials in /etc/systemd/system/3dmol.service:"
echo "  Environment=ADMIN_PASSWORD=your-password"
echo "  Environment=JWT_SECRET=your-secret"
echo "Then: sudo systemctl daemon-reload && sudo systemctl restart 3dmol"
