# 3Dmol AlphaFold Multimer Viewer

A web-based protein structure viewer for AlphaFold Multimer predictions, built with [3Dmol.js](https://3dmol.org). Designed to browse and visualise protein–protein interaction predictions produced by AlphaFold Multimer, with interface residue detection and customisable colours.

## Features

- **Protein pair browser** — search and filter interaction pairs by name
- **AlphaFold model selector** — switch between ranked models 0–4 (`ranked_0.pdb` … `ranked_4.pdb`)
- **Interface residue detection** — highlight residues within a configurable distance cutoff (default 10 Å) between chains
- **Live colour pickers** — independently set structure and interface colours for Chain A and Chain B
- **Display styles** — Cartoon, Stick, Surface
- **JWT authentication** — login-protected; designed for easy migration to a remote user database

---

## Data Structure Expected

The viewer reads AlphaFold Multimer output directories. Each protein pair must follow this layout:

```
AFM_DIR/
└── PairName_Species1_ProteinB_Species2/          # interaction pair directory
    └── PairName_Species1_ProteinB_Species2/      # nested subdirectory (same name)
        ├── ranked_0.pdb                          # AlphaFold best model
        ├── ranked_1.pdb
        ├── ranked_2.pdb
        ├── ranked_3.pdb
        ├── ranked_4.pdb
        └── unrelaxed_model_1_multimer_v3_pred_0.pdb  # fallback if ranked absent
```

Models are served in order of rank (0 = best confidence). If `ranked_N.pdb` is missing for a given index, the viewer falls back to `unrelaxed_model_{N+1}_multimer_v3_pred_0.pdb`.

---

## Server Architecture

```
Internet
   │  port 80
   ▼
 nginx  ──► proxy_pass ──► Node.js (port 3000)
                                │
                         /opt/3dmol-app/
                         ├── server.js        # Express API + JWT auth
                         ├── package.json
                         ├── public/
                         │   └── index.html   # single-page app (3Dmol.js)
                         └── deploy/          # service + nginx config templates
```

---

## Quick Install (fresh Ubuntu 22.04)

```bash
git clone https://github.com/KristinaGagalova/3dmol-viewer-ccdm.git
cd 3dmol-viewer-ccdm
bash deploy/setup.sh /path/to/your/AFM/data
```

The script installs Node.js 20, configures nginx as a reverse proxy, registers a systemd service, and starts the app on port 80.

After setup, set your credentials in `/etc/systemd/system/3dmol.service`:

```ini
Environment=ADMIN_PASSWORD=your-password
Environment=JWT_SECRET=your-long-random-secret
```

Then reload:

```bash
sudo systemctl daemon-reload && sudo systemctl restart 3dmol
```

### Manual install

```bash
npm install --omit=dev
export AFM_DIR=/path/to/AFM
export PORT=3000
export ADMIN_PASSWORD=your-password
export JWT_SECRET=your-secret
node server.js
```

---

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `AFM_DIR` | yes | Path to AlphaFold Multimer output directory |
| `ADMIN_PASSWORD` | yes | Login password for the `admin` user |
| `JWT_SECRET` | yes | Secret for signing JWT tokens — use a long random string |
| `PORT` | no (default 3000) | HTTP port the Node app listens on |

> **Never commit credentials.** Set all secrets via environment variables or the systemd service file on the server. The systemd service file itself should not be committed if it contains real values.

---

## Managing Users

The password is set via the `ADMIN_PASSWORD` environment variable — no plaintext credentials in the code.

To change the password, update the systemd service:

```bash
sudo systemctl edit 3dmol
# Add under [Service]:
#   Environment=ADMIN_PASSWORD=new-password
sudo systemctl restart 3dmol
```

**Future:** replace the in-memory `USERS` object in `server.js` with a database lookup — the `bcrypt.compareSync` call in `POST /api/login` is the only change point.

---

## API Reference

All endpoints except `POST /api/login` require a Bearer token in the `Authorization` header.

### Auth

| Method | Endpoint | Body | Returns |
|--------|----------|------|---------|
| POST | `/api/login` | `{ username, password }` | `{ token, username }` |

Token expires after 8 hours.

### Structures

| Method | Endpoint | Query | Returns |
|--------|----------|-------|---------|
| GET | `/api/pairs` | `?search=text` | `{ pairs: [...] }` |
| GET | `/api/models/:pair` | — | `{ models: [0,1,2,3,4] }` |
| GET | `/api/structure/:pair/:model` | — | PDB file (text/plain) |
| GET | `/api/structure/:pair/:model/interface` | `?cutoff=10` | `{ cutoff, interface: { A: [...resi], B: [...resi] } }` |

**Interface cutoff** — distance in Ångströms between any atom pair across chains. Min 1 Å, max 30 Å, default 10 Å.

---

## Service Management

```bash
sudo systemctl status 3dmol
sudo systemctl restart 3dmol
sudo journalctl -u 3dmol -f
sudo systemctl reload nginx
```

---

## Security Notes

- `ADMIN_PASSWORD` and `JWT_SECRET` must be set as environment variables — never hardcoded
- Port 3000 is not exposed externally — nginx proxies port 80 only
- `.env` is in `.gitignore` — never commit it
