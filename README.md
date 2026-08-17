# 3Dmol Structure Prediction Viewer

A web-based protein structure viewer for effector–host interaction predictions, built with [3Dmol.js](https://3dmol.org). Browses and visualises predictions produced by **five different structure prediction methods** for the same curated set of effector/host protein pairs, with cross-method comparison, interface residue detection, pLDDT confidence coloring, and customisable colours.

## Features

- **Curated pair browser** — search and cross-filter interaction pairs by plant species, pathogen species, and effector name (each filter's options are derived from the other two, so every combination stays valid)
- **Multi-method structure comparison** — switch between AF3, AlphaFold-Multimer, Boltz-2, Chai-1, and ESMFold2 predictions for the same pair, and between ranked models within a method
- **Interface residue detection** — highlight residues within a configurable distance cutoff (default 10 Å) between chains
- **pLDDT confidence coloring** — optional per-residue coloring using the AlphaFold DB confidence bands (read from the B-factor / `_atom_site.B_iso_or_equiv` field, present in every method's output)
- **Sequence viewer panel** — per-chain sequence display synced to residue selection/highlighting
- **Live colour pickers** — independently set structure and interface colours for Chain A and Chain B
- **Display styles** — Cartoon, Stick, Surface
- **JWT authentication** — login-protected; designed for easy migration to a remote user database

> **Rebuilding this app elsewhere?** See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full system architecture plus a copy-paste-ready prompt for reconstructing it from scratch with Claude.

---

## Supported Prediction Methods

| Key | Label | Models served | Notes |
|---|---|---|---|
| `af3` | AlphaFold3 | up to 5 (`seed-1_sample-0` … `sample-4`) | one directory per pair |
| `afm` | AlphaFold-Multimer | up to 5 (`ranked_0.pdb` … `ranked_4.pdb`) | only the official `ranked_*` files are served — see rule below |
| `boltz2` | Boltz-2 | 1 (`model_0`) | this pipeline only emits a single model per pair |
| `chai` | Chai-1 | up to 5 (`pred.model_idx_0.cif` … `idx_4.cif`) | |
| `esmfold2` | ESMFold2 | 1 (`_structure.cif`) | single-model method |

Each method has its own resolver function in `server.js` (`resolveAf3`, `resolveAfm`, `resolveBoltz2`, `resolveChai`, `resolveEsmfold2`), and `GET /api/methods/:id` reports which models are actually available for a given pair across all five.

Not every pair has output from every method — some prediction runs failed (typically GPU out-of-memory on unusually long sequences). The resolvers check file existence directly, so a method with no completed run for a pair simply reports zero available models rather than erroring.

---

## Data Structure Expected

The viewer reads directly from a shared input data directory (`INPUT_DATA_DIR`) containing the curated metadata TSV and one output directory per method:

```
INPUT_DATA_DIR/
├── metadata_curated_positive.tsv
├── curated_positive_af3_results/
│   └── PairName/
│       └── seed-1_sample-N/
│           └── PairName_seed-1_sample-N_model.cif
├── curated_positive_afm_results/
│   └── PairName/
│       └── PairName/                      # nested subdirectory, same name
│           └── ranked_N.pdb
├── curated_positive_boltz2_results/
│   └── PairName.yaml/
│       └── boltz_results_PairName/predictions/PairName/
│           └── PairName_model_0.cif
├── curated_positive_chai_results/
│   └── models/
│       └── PairName/
│           └── pred.model_idx_N.cif
└── curated_positive_esmfold2_results/
    └── PairName/
        └── PairName_structure.cif
```

`PairName` is the pair identifier as it appears in the `Identifier` column of the metadata TSV (see aliasing rule below — the on-disk directory name doesn't always match exactly).

---

## Rules Applied When Resolving Structures

These were added after auditing the pipeline outputs against the metadata TSV and finding two systematic issues affecting cross-method lookups.

### 1. Identifier aliasing (special-character mismatches)

AlphaFold3 sanitizes special characters out of job names on submission, and the metadata TSV's `Identifier` column was generated from AF3's spelling. The other four pipelines (AFM, Boltz-2, Chai, ESMFold2) were run with the literal, unsanitized name, so for a handful of pairs the on-disk directory name differs from the TSV identifier — meaning those pairs' non-AF3 data was invisible to the viewer even though the files existed.

Confirmed characters affected: Greek letters (`α`, `ε`), parentheses, semicolons, and extra whitespace around abbreviations — all silently dropped or collapsed by AF3's sanitizer but preserved by the other four pipelines.

Fix: a static `ID_ALIASES` map in `server.js` (TSV identifier → actual on-disk name), applied only to the `afm`, `boltz2`, `chai`, and `esmfold2` resolvers — never to `af3`, whose directory names already match the TSV identifier for every pair. The map is explicit and static rather than fuzzy-matched at runtime, so a future naming collision can't silently mismatch two different pairs.

### 2. AFM: only the official `ranked_*.pdb` files are served, with no fallback

The AFM resolver previously fell back to `unrelaxed_model_N_multimer_v3_pred_0.pdb` whenever a `ranked_N.pdb` file was missing for a given model index. This silently served an unrelaxed structure (steric clashes not resolved) as if it were a valid ranked prediction, and — worse — meant pairs with a genuinely failed/incomplete run (no `ranked_*.pdb` at all) still displayed a structure instead of correctly reporting "no model available."

Fix: `resolveAfm` now only ever looks for `ranked_0.pdb` … `ranked_4.pdb`. If a given index is missing, it is simply omitted — never substituted with an unrelaxed file.

---

## Server Architecture

```
Internet
   │  restricted by firewall (temporary — see note below)
   ▼
 nginx  ──► proxy_pass ──► Node.js (port 3000)
   │                            │
   │                            /opt/3dmol-app/
   │                            ├── server.js        # Express API + JWT auth
   │                            ├── package.json
   │                            ├── public/
   │                            │   └── index.html   # single-page app (3Dmol.js)
   │                            └── deploy/          # service + nginx config templates
   ▼
 reads structure files + metadata TSV live from
 the shared input data directory on every request
```

> **Current deployment state — temporary.**
> - Access is currently restricted at the network firewall to a small set of approved source addresses, rather than being open to the public internet. This is a stop-gap access control, not a replacement for authentication — the app-level login is still required regardless.
> - The server is currently reached by IP address rather than a DNS hostname, so **no TLS certificate has been issued**. Let's Encrypt/Certbot (see below) requires a resolvable hostname and cannot issue a certificate for a bare IP. Traffic is not yet encrypted end-to-end; treat this as an interim state until a hostname is assigned and a certificate is provisioned.

---

## Quick Install (fresh Ubuntu 22.04)

```bash
git clone <this-repo-url>
cd 3dmol-viewer-ccdm
bash deploy/setup.sh /path/to/your/input_data
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

### Enable HTTPS with Let's Encrypt

Once the server has a public **hostname** (not just an IP — see note above), issue a free trusted certificate with Certbot:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-hostname.example.com \
  --non-interactive --agree-tos --email your@email.com --redirect
```

Certbot automatically configures nginx for HTTPS and sets up a systemd timer for renewal. No further action is needed — certificates renew automatically before expiry.

### Manual install

```bash
npm install --omit=dev
export INPUT_DATA_DIR=/path/to/input_data
export PORT=3000
export ADMIN_PASSWORD=your-password
export JWT_SECRET=your-secret
node server.js
```

---

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `INPUT_DATA_DIR` | yes | Path to the shared directory containing the metadata TSV and all five method result directories |
| `METADATA_TSV` | no (default `INPUT_DATA_DIR/metadata_curated_positive.tsv`) | Override path to the metadata TSV |
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

### Metadata

| Method | Endpoint | Query | Returns |
|--------|----------|-------|---------|
| GET | `/api/metadata/filters` | `?plantSpecies=&pathogenSpecies=&effectorName=` | cross-filtered option lists for the other two fields |
| GET | `/api/metadata/search` | `?plantSpecies=&pathogenSpecies=&effectorName=` | `{ entries: [...] }` |
| GET | `/api/metadata/entry/:id` | — | metadata row for one pair |

### Structures

| Method | Endpoint | Query | Returns |
|--------|----------|-------|---------|
| GET | `/api/methods/:id` | — | `{ methods: { af3: { label, models }, afm: {...}, boltz2: {...}, chai: {...}, esmfold2: {...} } }` |
| GET | `/api/structure/:method/:id/:model` | — | Structure file (PDB or mmCIF, `text/plain`, format in `X-File-Format` header) |
| GET | `/api/structure/:method/:id/:model/sequence` | — | Per-chain residue sequence |
| GET | `/api/structure/:method/:id/:model/interface` | `?cutoff=10` | `{ cutoff, interface: { A: [...resi], B: [...resi] } }` |

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

- `ADMIN_PASSWORD` and `JWT_SECRET` must be set as environment variables — never hardcoded or committed
- The app runs behind nginx; port 3000 is never exposed externally
- **Interim state:** inbound access is currently restricted at the network firewall to approved source addresses, and the deployment is not yet served over HTTPS (see [Server Architecture](#server-architecture)) — do not treat this as the final security posture
- Once a hostname is assigned, enable HTTPS via Let's Encrypt/Certbot and relax the firewall rule accordingly
- `.env` is in `.gitignore` — never commit credentials to the repository
