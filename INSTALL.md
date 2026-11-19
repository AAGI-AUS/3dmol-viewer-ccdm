# Installation Guide

## Quick Start (Ubuntu 22.04)

For a quick automated setup on a fresh Ubuntu 22.04 system, use the installation script:

```bash
git clone https://github.com/AAGI-AUS/3dmol-viewer-ccdm.git
cd 3dmol-viewer-ccdm
bash deploy/setup.sh /path/to/your/input_data
```

The script will:
- Install Node.js 20
- Configure nginx as a reverse proxy
- Register a systemd service
- Start the application on port 80

After setup, configure your credentials in `/etc/systemd/system/3dmol.service`:

```ini
Environment=ADMIN_PASSWORD=your-password
Environment=JWT_SECRET=your-long-random-secret
```

Then reload and restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart 3dmol
```

## Manual Installation

### Prerequisites

- Node.js 20 or higher
- npm 8 or higher
- nginx (for production deployment)

### Step 1: Clone the Repository

```bash
git clone https://github.com/AAGI-AUS/3dmol-viewer-ccdm.git
cd 3dmol-viewer-ccdm
```

### Step 2: Install Dependencies

```bash
npm install --omit=dev
```

### Step 3: Configure Environment

```bash
export INPUT_DATA_DIR=/path/to/your/input_data
export ADMIN_PASSWORD=your-secure-password
export JWT_SECRET=your-long-random-secret-key
export PORT=3000  # optional, defaults to 3000
```

### Step 4: Start the Application

```bash
node server.js
```

The application will be available at `http://localhost:3000`

### Step 5: Configure nginx (Optional, for Production)

See `deploy/nginx.conf.template` for a sample nginx configuration. Adapt it to your environment and copy to nginx sites-available.

### Step 6: Set Up as a systemd Service (Linux)

See `deploy/3dmol.service.template` for a sample systemd service file. Customize with your credentials and install:

```bash
sudo cp deploy/3dmol.service.template /etc/systemd/system/3dmol.service
sudo nano /etc/systemd/system/3dmol.service  # Edit credentials
sudo systemctl daemon-reload
sudo systemctl enable 3dmol
sudo systemctl start 3dmol
```

### Verify Installation

```bash
# Check service status
sudo systemctl status 3dmol

# View logs
sudo journalctl -u 3dmol -f
```

## Enable HTTPS with Let's Encrypt

Once you have a public hostname (not just an IP address), enable HTTPS:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-hostname.example.com \
  --non-interactive --agree-tos \
  --email your@email.com --redirect
```

Certbot will:
- Issue a free SSL certificate
- Configure nginx for HTTPS
- Set up automatic renewal via systemd timer

No further action needed — certificates renew automatically.

## Data Directory Structure

Ensure your `INPUT_DATA_DIR` contains:

```
INPUT_DATA_DIR/
├── metadata_curated_positive.tsv
├── curated_positive_af3_results/
├── curated_positive_afm_results/
├── curated_positive_boltz2_results/
├── curated_positive_chai_results/
└── curated_positive_esmfold2_results/
```

See the main [README.md](README.md#data-structure-expected) for detailed data structure requirements.

## Troubleshooting

### Application won't start

1. Check Node.js version: `node --version` (should be 20+)
2. Verify `INPUT_DATA_DIR` exists and is readable
3. Check for port conflicts: `sudo lsof -i :3000` or `sudo lsof -i :80`
4. Review error logs: `sudo journalctl -u 3dmol -n 50`

### Can't access the application

1. Verify nginx is running: `sudo systemctl status nginx`
2. Check firewall rules: `sudo ufw status`
3. Verify the application is actually running: `curl http://localhost:3000/`

### Database/file permission issues

1. Verify `INPUT_DATA_DIR` is readable by the application user
2. Check file ownership: `ls -l /path/to/input_data`
3. Adjust permissions if needed: `chmod -R 755 /path/to/input_data`

### HTTPS/Certificate issues

1. Verify you have a valid hostname (DNS points to your server)
2. Check certificate status: `sudo certbot certificates`
3. Test renewal: `sudo certbot renew --dry-run`

## Upgrading

To upgrade to a newer version:

```bash
cd 3dmol-viewer-ccdm
git pull origin main
npm install --omit=dev
sudo systemctl restart 3dmol
```

## Support

For additional help, please refer to:
- [README.md](README.md) - Full project documentation
- [API Reference](README.md#api-reference) - Endpoint documentation
- [GitHub Issues](https://github.com/AAGI-AUS/3dmol-viewer-ccdm/issues) - Bug reports and feature requests
