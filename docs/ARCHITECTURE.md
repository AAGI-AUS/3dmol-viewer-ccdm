# Architecture

Reference documentation for how this application is built, plus a
copy-paste-ready prompt (bottom of this file) for reconstructing it from
scratch with Claude — e.g. on a new server, in a new repo, or as a template
for a similar multi-method structure viewer.

## Overview

A password-protected, single-page web app for browsing and visually
comparing protein–protein interaction structure predictions produced by
**five different prediction methods** (AlphaFold3, AlphaFold-Multimer,
Boltz-2, Chai-1, ESMFold2) for the same curated set of effector/host protein
pairs. The backend does no pre-processing or database-ification of structure
files — it resolves and streams them live from a shared input-data directory
on every request. The frontend is a single static HTML file using
[3Dmol.js](https://3dmol.org) for rendering.

## System diagram

```
Internet
   │
   ▼
 nginx (port 80, reverse proxy)  ──►  Node.js / Express (127.0.0.1:3000)
                                            │
                                            │  JWT auth (bcrypt-hashed
                                            │  single admin user)
                                            ▼
                                  reads live, per request:
                                  ┌─────────────────────────────────┐
                                  │ INPUT_DATA_DIR/                 │
                                  │  ├── metadata_curated_positive  │
                                  │  │     .tsv  (loaded once at    │
                                  │  │     startup into memory)     │
                                  │  ├── curated_positive_af3_results/
                                  │  ├── curated_positive_afm_results/
                                  │  ├── curated_positive_boltz2_results/
                                  │  ├── curated_positive_chai_results/
                                  │  └── curated_positive_esmfold2_results/
                                  └─────────────────────────────────┘
```

## Backend (`server.js`)

Plain Express app, no database. Key pieces:

- **Auth**: one hardcoded `admin` user, password from `ADMIN_PASSWORD` env
  var, bcrypt-hashed at startup (process exits if the env var is unset).
  Login issues an 8-hour JWT signed with `JWT_SECRET`. All routes except
  `POST /api/login` require `Authorization: Bearer <token>`.
- **Metadata**: `metadata_curated_positive.tsv` is parsed once at startup
  into an in-memory array. Three endpoints serve it:
  - `GET /api/metadata/filters` — cross-filtering: each field's option list
    is computed from the *other two* selected filters only, so any pick is
    guaranteed to match at least one row.
  - `GET /api/metadata/search` — filters by all three fields (AND).
  - `GET /api/metadata/entry/:id` — single row lookup.
- **Method resolvers**: one function per prediction method (`resolveAf3`,
  `resolveAfm`, `resolveBoltz2`, `resolveChai`, `resolveEsmfold2`), each
  mapping a pair identifier to whichever model files actually exist on disk.
  See [Data layout & rules](#data-layout--rules-per-method) below — these
  encode two bug fixes that are easy to reintroduce if rebuilt naively.
- **Structure endpoints**: `GET /api/methods/:id` (availability across all 5
  methods), `GET /api/structure/:method/:id/:model` (raw file, streamed with
  an `X-File-Format` header so the client knows `pdb` vs `cif`),
  `.../sequence` (per-chain residue list) and `.../interface?cutoff=` (
  distance-based interface residue detection) — both of the latter run a
  small hand-written PDB/mmCIF atom parser (no external structure-parsing
  library) to avoid pulling in a heavy dependency for two small geometric
  queries.

## Frontend (`public/index.html`)

Single static file: inline CSS (dark theme), inline vanilla JS, 3Dmol.js
from CDN. No build step. Login screen → sidebar (species/effector
cross-filters, matching-pairs list, metadata detail panel, method/model
selectors, style selector, pLDDT confidence toggle, per-chain color pickers)
→ 3Dmol viewer canvas with floating zoom/spin/label controls → collapsible
per-chain sequence strip synced to click-to-label residue selection → a
selected-residues side panel.

## Data layout & rules per method

| Method | Directory | Path pattern | Models |
|---|---|---|---|
| AF3 | `curated_positive_af3_results/` | `<id>/seed-1_sample-<n>/<id>_seed-1_sample-<n>_model.cif` | up to 5 |
| AFM | `curated_positive_afm_results/` | `<id>/<id>/ranked_<n>.pdb` | up to 5 |
| Boltz-2 | `curated_positive_boltz2_results/` | `<id>.yaml/boltz_results_<id>/predictions/<id>/<id>_model_0.cif` | 1 |
| Chai-1 | `curated_positive_chai_results/models/` | `<id>/pred.model_idx_<n>.cif` | up to 5 |
| ESMFold2 | `curated_positive_esmfold2_results/` | `<id>/<id>_structure.cif` | 1 |

### Rule 1 — AFM only serves genuine `ranked_*.pdb` files, never unrelaxed

This pipeline only Amber-relaxes AlphaFold-Multimer's top-ranked model.
`ranked_1.pdb`…`ranked_4.pdb` are still the official AlphaFold-Multimer
output naming for the other 4 predictions. An earlier version of
`resolveAfm` fell back to `unrelaxed_model_<n+1>_multimer_v3_pred_0.pdb`
whenever a `ranked_<n>.pdb` was missing — this silently served genuinely
unrelaxed structures (and, for pairs whose run failed entirely with zero
`ranked_*.pdb` files, served an unrelaxed structure as if it were a valid
result at all). Fixed: only check for `ranked_<n>.pdb`; a missing index is
simply omitted, never substituted.

### Rule 2 — identifier aliasing across methods

AlphaFold3 sanitizes special characters out of job names on submission
(dropping Greek letters, parentheses, semicolons, collapsing irregular
whitespace), and the metadata TSV's `Identifier` column follows AF3's
sanitized spelling. AFM/Boltz-2/Chai/ESMFold2 were run with the literal
unsanitized name, so a handful of pairs have a different on-disk directory
name per tool than the TSV identifier — those pairs' non-AF3 data was
invisible to the viewer despite existing on disk. Fixed with a static
`ID_ALIASES` map (TSV identifier → actual on-disk name) applied only inside
the `afm`/`boltz2`/`chai`/`esmfold2` resolvers, never `af3` (whose directory
name always matches the TSV identifier). Kept static/explicit rather than
fuzzy-matched at runtime, so a genuinely different pair with a similar name
can never be silently mismatched.

To discover these yourself on a new dataset: normalize every TSV identifier
and every on-disk directory name per method (lowercase, strip all
non-alphanumeric characters), flag any TSV identifier whose normalized form
matches a directory in some method but whose literal string does not, and
record the literal on-disk spelling found.

## Deployment

- nginx reverse-proxies port 80 → `127.0.0.1:3000` (Node never exposed
  directly).
- systemd unit runs `node server.js` with `Restart=on-failure` and
  `PORT`/`INPUT_DATA_DIR`/`ADMIN_PASSWORD`/`JWT_SECRET` set via
  `Environment=` lines — the committed template file must only ever contain
  placeholder values.
- HTTPS via Certbot/Let's Encrypt requires a DNS **hostname** — it cannot
  issue a certificate for a bare IP address. If a deployment is only
  reachable by IP (no hostname assigned yet), don't attempt HTTPS
  configuration; serve over HTTP and restrict access at the network firewall
  to known source addresses as an explicitly temporary interim measure, not
  a permanent design choice.

---

## Rebuild-from-scratch prompt

Paste everything between the `---PROMPT START---` and `---PROMPT END---`
markers into a fresh Claude Code session in an empty project directory to
reconstruct a functionally equivalent application. Fill in the placeholder
values before sending.

---PROMPT START---

Build a web application called **"3Dmol Structure Prediction Viewer"** — a
password-protected, single-page structure browser for comparing
protein–protein interaction predictions produced by five different structure
prediction methods for the same curated set of protein pairs. Use plain
Node.js/Express on the backend (no framework beyond Express) and a single
static HTML file with vanilla JavaScript and [3Dmol.js](https://3dmol.org) on
the frontend (loaded from `https://3Dmol.org/build/3Dmol-min.js`) — no build
step, no bundler, no frontend framework.

### 1. Domain and data model

The application does **not** store data itself — it reads two things live
from a shared input-data directory on disk, on every request (no caching of
structure files, though the metadata TSV is loaded into memory once at
process startup):

1. A **metadata TSV** (`metadata_curated_positive.tsv`) — tab-separated, one
   row per protein-pair "interaction," with a header row. Columns needed by
   the app (there are many other columns in the real file — model confidence
   scores per method, experiment provenance, etc. — the app only needs to
   read these, ignore the rest):

   | TSV column header | internal field name |
   |---|---|
   | `Identifier` | `identifier` (primary key — see naming rule below) |
   | `Effector name` | `effectorName` |
   | `Effector Allele` | `effectorAllele` |
   | `Plant protein/domain name` | `plantProteinName` |
   | `PDB (if available)` | `pdb` |
   | `Pathogen Species` | `pathogenSpecies` |
   | `Plant species` | `plantSpecies` |
   | `Reference(s)` | `references` |
   | `Citation (Harvard style)` | `citation` |
   | `Evidence of interaction` | `evidenceOfInteraction` |
   | `Experiment type` | `experimentType` |
   | `Host protein description` | `hostProteinDescription` |
   | `Effector-host interaction` | `effectorHostInteraction` |
   | `Mechanism` | `mechanism` |

   Only rows with a non-empty `identifier` are kept.

2. **Five structure-prediction output directories**, one per method, each
   containing one subdirectory per pair (see §3 for exact per-method layout
   and file-resolution rules).

### 2. Tech stack

- **Backend**: Node.js, Express 4, `jsonwebtoken` (JWT auth), `bcryptjs`
  (password hashing). No database — a single hardcoded admin user, password
  from an environment variable, hashed with bcrypt at process start.
- **Frontend**: one static `public/index.html` file — inline `<style>` and
  `<script>`, no separate JS/CSS files, no npm frontend dependencies, 3Dmol.js
  loaded from its CDN.
- **Process manager**: systemd unit running `node server.js` directly (no
  PM2, no Docker).
- **Reverse proxy**: nginx in front of the Node process, proxying to
  `127.0.0.1:3000`.

`package.json` dependencies (exact):
```json
{
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "express": "^4.18.2",
    "jsonwebtoken": "^9.0.2"
  }
}
```

### 3. The five prediction methods and how to resolve their files

Implement one resolver function per method, all taking a pair `identifier`
and returning an array of `{ model: <int 0-4>, file: <absolute path>, format:
'pdb'|'cif' }`. A method with no completed run for a pair must return an
**empty array**, never throw, never substitute a different kind of file.

| Method key | Label | Directory under `INPUT_DATA_DIR` | Path pattern per model | Format |
|---|---|---|---|---|
| `af3` | AlphaFold3 | `curated_positive_af3_results/` | `<id>/seed-1_sample-<n>/<id>_seed-1_sample-<n>_model.cif` for n=0..4 | cif |
| `afm` | AlphaFold-Multimer | `curated_positive_afm_results/` | `<id>/<id>/ranked_<n>.pdb` for n=0..4 | pdb |
| `boltz2` | Boltz-2 | `curated_positive_boltz2_results/` | `<id>.yaml/boltz_results_<id>/predictions/<id>/<id>_model_0.cif` (single model only, index 0) | cif |
| `chai` | Chai-1 | `curated_positive_chai_results/models/` | `<id>/pred.model_idx_<n>.cif` for n=0..4 | cif |
| `esmfold2` | ESMFold2 | `curated_positive_esmfold2_results/` | `<id>/<id>_structure.cif` (single model only, index 0) | cif |

**Critical rule — AFM must NOT fall back to unrelaxed structures.** In this
pipeline's real output, AlphaFold-Multimer only Amber-relaxes its top-ranked
model; `ranked_1.pdb` through `ranked_4.pdb` are themselves the as-generated
(non-`ranked_0`) predictions with the official AlphaFold naming. A naive
implementation might be tempted to fall back to
`unrelaxed_model_<n+1>_multimer_v3_pred_0.pdb` when a `ranked_<n>.pdb` file is
missing for some index — **do not do this**. Only ever check for
`ranked_<n>.pdb`; if it doesn't exist for a given index, omit that index
entirely from the returned models array. A pair with zero `ranked_*.pdb`
files must report zero available AFM models, not silently substitute an
unrelaxed structure.

**Critical rule — identifier aliasing between methods.** AlphaFold3's job
submission sanitizes special characters (accented/Greek letters, parentheses,
semicolons, irregular whitespace) out of the job name, and the metadata TSV's
`Identifier` column follows AF3's sanitized spelling. The other four
pipelines (AFM, Boltz-2, Chai, ESMFold2) were run with the literal,
unsanitized name, so for a small number of pairs the on-disk directory name
for those four tools differs from the TSV identifier by exactly the
sanitized-out character(s). Implement a static alias map, `ID_ALIASES`,
keyed by TSV identifier → actual on-disk name, and resolve through it inside
the `afm`, `boltz2`, `chai`, and `esmfold2` resolvers only — **never** apply
it inside the `af3` resolver, whose directory name always equals the TSV
identifier directly. Do not implement this as fuzzy/normalized matching at
runtime — keep it an explicit, static, auditable table, so a future
genuinely-different pair with a similar name can't be silently mismatched.
(When you index a real dataset, build this table by: normalizing every TSV
identifier and every on-disk directory name per method — lowercase, strip
every non-alphanumeric character — then flagging any TSV identifier whose
normalized form matches a directory in some method but whose literal string
does not; record the literal on-disk spelling found for each such case.)

### 4. Backend — Express server (`server.js`)

Environment variables:

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `INPUT_DATA_DIR` | no | `<<YOUR_INPUT_DATA_PATH>>` | root of metadata TSV + 5 method dirs |
| `METADATA_TSV` | no | `${INPUT_DATA_DIR}/metadata_curated_positive.tsv` | override metadata path |
| `ADMIN_PASSWORD` | **yes** | — | process must exit at startup with an error logged if unset |
| `JWT_SECRET` | no | a hardcoded fallback string (acceptable for dev only — document that production must override it) | JWT signing secret |
| `PORT` | no | `3000` | HTTP port |

Startup behavior:
- Read `ADMIN_PASSWORD`; if unset, `console.error(...)` and `process.exit(1)`.
- Build a `USERS` object: `{ admin: bcrypt.hashSync(ADMIN_PASSWORD, 10) }`.
- Serve `public/` as static files via `express.static`.
- Parse the metadata TSV once into an in-memory array of row objects (see §1
  column mapping); log how many rows were loaded and from which path; if
  loading fails, log the error but continue running with an empty metadata
  array rather than crashing.

Auth middleware `requireAuth`: read `Authorization: Bearer <token>` header,
`jwt.verify` it with `JWT_SECRET`, attach the decoded payload to `req.user`,
call `next()`; on missing header return 401 `{ error: 'Unauthorized' }`; on
verify failure return 401 `{ error: 'Invalid or expired token' }`.

**Endpoints** (all except login require `requireAuth`):

| Method | Path | Query/body | Behavior |
|---|---|---|---|
| POST | `/api/login` | body `{ username, password }` | look up `USERS[username]`, `bcrypt.compareSync`; on success sign a JWT `{ username }` with 8-hour expiry, return `{ token, username }`; on failure 401 `{ error: 'Invalid credentials' }` |
| GET | `/api/metadata/filters` | `?plantSpecies=&pathogenSpecies=&effectorName=` | **cross-filtering**: for each of the three fields, compute its available option list by filtering the full metadata array using the *other two* currently-selected query params only (never the field's own current value), so whichever value the user picks next is guaranteed to match at least one row; return `{ plantSpecies: [...], pathogenSpecies: [...], effectorNames: [...] }`, each list deduplicated and locale-sorted |
| GET | `/api/metadata/search` | `?plantSpecies=&pathogenSpecies=&effectorName=` | filter the metadata array by all three params (AND, exact match, empty = no filter); return `{ entries: [...] }` |
| GET | `/api/metadata/entry/:id` | — | find one row by `identifier`; 404 `{ error: 'Entry not found' }` if absent |
| GET | `/api/methods/:id` | — | for each of the 5 method keys, call its resolver and return `{ methods: { <key>: { label, models: [<int>,...] } } }` — `models` holds just the model-index integers |
| GET | `/api/structure/:method/:id/:model` | — | resolve the specific model file via the method's resolver; 404 if not found; else stream the raw file text with header `Content-Type: text/plain` and a custom header `X-File-Format: pdb`|`cif` so the client knows how to hand it to 3Dmol.js |
| GET | `/api/structure/:method/:id/:model/sequence` | — | parse the resolved file's atoms (see §5), build per-chain ordered list of `{ resi, resn }` (first-seen residue per chain, sorted by `resi`), return as `{ <chain>: [...] }` |
| GET | `/api/structure/:method/:id/:model/interface` | `?cutoff=10` (clamp to [1,30], default 10) | parse atoms, group into residues (average nothing — keep the full per-atom coordinate list per residue), then for every pair of distinct chains, find residues with any atom-to-atom distance ≤ cutoff; return `{ cutoff, interface: { <chain>: [<resi>,...] } }` sorted ascending |

### 5. Structure file parsing (backend, no external libraries)

Implement two atom parsers from scratch (regex/string-split, not a real PDB
library):

- **PDB parser**: for each line matching `^ATOM`, extract chain (character at
  index 21), `resSeq` (columns 23–26, `parseInt`), `resn` (columns 18–20,
  trimmed), and `x`/`y`/`z` (columns 31–38, 39–46, 47–54, `parseFloat`,
  0-indexed substring boundaries `30-38`, `38-46`, `46-54` in JS
  `.substring()` terms). Skip lines that fail to parse into valid numbers.
- **mmCIF parser**: scan for `_atom_site.` column-definition blocks (mmCIF
  loops), collect the ordered column name list, then read data rows until a
  blank line / new `_` tag / `loop_` / `#`. Prefer `auth_asym_id` /
  `auth_seq_id` / `auth_comp_id` if present in the column list, falling back
  to `label_asym_id` / `label_seq_id` / `label_comp_id` — different tools
  (AF3, Boltz-2, Chai, ESMFold2) emit mmCIF with slightly different loop
  layouts, and this fallback keeps one parser working across all of them.
  Only keep rows where `group_PDB` is `ATOM` or `HETATM`.

Both parsers produce the same atom shape: `{ chain, resSeq, resn, x, y, z }`.

`groupResidues(atoms)`: bucket atoms by `${chain}:${resSeq}`, each bucket
holding `{ chain, resSeq, coords: [[x,y,z], ...] }`.

`findInterfaceResidues(residues, cutoff)`: bucket residues by chain; for
every unordered pair of distinct chains, for every residue pair across those
two chains, test whether any atom-coordinate pair is within `cutoff` (squared
Euclidean distance comparison, no sqrt needed); if so, record both residues'
`resSeq` as interface hits for their respective chains. Return `{ <chain>:
[sorted resSeq list] }` for every chain that appeared.

### 6. Frontend (`public/index.html`) — single file, dark theme

Build one HTML file containing the login screen, the main app shell, and all
JS logic inline. No external CSS/JS files besides the 3Dmol.js CDN script.

**Visual design** — dark theme, exact tokens:
- Background: `#0f1117` (page), `#1a1f2e` (sidebar/cards), `#0a0d14`
  (3D viewer canvas background)
- Border: `#2d3748`
- Primary accent (buttons, focus rings, active states): `#3b82f6` /
  hover `#2563eb`; "active" pill background `#1e3a5f`, active text `#60a5fa`
- Secondary accent (style buttons, spin/sequence toggle when active):
  `#6366f1` / active bg `#1e1b4b` / active text `#a5b4fc`
- Muted text: `#94a3b8` (labels), `#64748b` (secondary), `#475569` /
  `#2d3748` (very muted / disabled)
- Error red: `#f87171`; success green: `#4ade80`
- Font: system UI stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI',
  sans-serif`); monospace (`'Courier New', monospace`) only for the sequence
  track glyphs
- Chain color defaults (colorblind-safe, Okabe–Ito-derived): Chain A
  structure `#0072B2`, Chain A interface `#56B4E9`; Chain B structure
  `#E69F00`, Chain B interface `#FFD700`; extra chains C/D/E cycle through
  `#a3e635/#fb923c/#c084fc` (structure) and `#76ff03/#ffd600/#e040fb`
  (interface) — these are only fallbacks, not user-editable
- pLDDT confidence bands (AlphaFold DB standard): `> 90` → `#0053D6` (very
  high), `70–90` → `#65CBF3` (confident), `50–70` → `#FFDB13` (low), `< 50` →
  `#FF7D45` (very low)

**Layout**: full-viewport flex row once logged in —
1. **Sidebar** (320px, scrollable): header with app name + logout button;
   "Filter Interactions" section with three cross-filtering `<select>`
   dropdowns (Plant species / Pathogen species / Effector name, each with an
   "— any" empty option); "Matching Interactions (`<count>`)" scrollable list
   of clickable pair rows (each row shows `effectorName ↔
   plantProteinName` as the label and `pathogenSpecies → plantSpecies` as a
   subtitle — **never show the raw internal identifier to the user**, it's
   for API calls only); a metadata detail panel that appears once a pair is
   selected, listing allele/host description/pathogen/plant/PDB
   accession/evidence/experiment type/interaction/mechanism/citation/
   reference, each row only rendered if the field is non-empty; a
   "Prediction Method" row of 5 toggle buttons (order: af3, afm, boltz2,
   esmfold2, chai) that are disabled when that method has zero models for
   the selected pair; a "Model" row of 5 numbered buttons (0–4) disabled per
   availability; a "Display Style" row (Cartoon / Stick / Surface); a pLDDT
   toggle checkbox with a 4-row color-swatch legend that only becomes visible
   when checked (and dims the manual color pickers below while active); a
   "Colors" section with per-chain (A/B) structure + interface color
   `<input type="color">` pickers plus a "Reset to defaults" button; a "Load
   Structure" button (disabled until pair + method + model are all chosen);
   a status message line; and, once a structure is loaded, an "Interface
   Residues" section with a cutoff-Å number input, "Highlight Interface" and
   "Clear Highlight" buttons, and a results readout.
2. **Viewer column** (flex-grow): the 3Dmol.js canvas with a placeholder icon
   + prompt shown before any structure is loaded, a centered loading spinner
   overlay, a floating bottom-right vertical control stack (zoom in / reset
   view / zoom out / toggle spin / clear all labels / toggle sequence panel),
   a floating bottom-left "atom info" card that appears after clicking a
   residue (shows one-letter code, residue name, full amino-acid name,
   residue number, chain), and below the canvas a collapsible "Protein
   Sequences" panel showing each chain's sequence as one-letter codes in a
   monospace horizontal wrapping track, with a residue-number tick every 10
   residues, clickable residues that mirror clicking the same residue in the
   3D view (added/removed as a 3Dmol label + tracked in the same
   `activeLabels` map), and a highlight style for labeled and
   interface-member residues.
3. **Selected-residues panel** (220px, right edge, hidden until at least one
   residue is labeled): grouped by chain, each residue row removable with a
   click, plus a "Clear all" button.

**Auth flow**: JWT stored in `sessionStorage` under key `token` (not
`localStorage` — cleared on tab close is intentional). On page load, if a
token exists, skip the login screen and go straight to the app (no
server-side validation until the first API call fails with 401, at which
point auto-logout and return to the login screen). Login form posts
`{ username, password }` to `/api/login`; Enter key in the password field
submits.

**Core client logic** (implement all of these, matching this exact
behavior):
- On login, initialize the 3Dmol viewer against a `<div id="viewer">` with
  `backgroundColor: '#0a0d14'`, then load filter options and the initial
  (unfiltered) entry list.
- Changing any filter dropdown re-fetches both `/api/metadata/filters` (to
  refresh the *other* dropdowns' options) and `/api/metadata/search` (to
  refresh the entry list), preserving each dropdown's current value if it's
  still a valid option after refresh, else resetting to "any."
- Selecting a pair resets method/model selection, fetches
  `/api/methods/:id`, and re-renders the method button row (only methods
  with ≥1 available model are clickable) and clears the model grid until a
  method is chosen.
- Selecting a method renders the 0–4 model button grid, enabling only the
  indices actually available for that method.
- The "Load Structure" button fetches the raw structure text from
  `/api/structure/:method/:id/:model`, reads the `X-File-Format` response
  header to know whether to call `viewer.addModel(text, 'pdb')` or
  `viewer.addModel(text, 'cif')`, clears any previous model/labels/interface
  state, applies the current display style + color settings, sets up the
  residue click handler, zooms to fit, and kicks off an async sequence fetch
  for the sequence panel.
- `applyStyle()` re-applies coloring from scratch every time style, colors,
  or pLDDT mode changes: if pLDDT mode is on, use 3Dmol's `colorfunc`
  callback reading `atom.b` (the B-factor/pLDDT value) into the 4-band
  palette above, for whichever geometry style (cartoon/stick/sphere) is
  active; otherwise color per-chain using the manual color pickers (chains
  A/B use their pickers, C/D/E cycle through the fallback palette). If
  interface data is currently loaded, re-apply the interface overlay
  afterward (colored cartoon+stick highlight per interface residue in normal
  mode; just revealed stick geometry, still pLDDT-colored, in pLDDT mode) —
  otherwise just render.
- Clicking an atom in the 3D view toggles a floating label at that atom's
  chain+residue (tracked in an `activeLabels` map keyed `"chain:resi"`),
  updates the bottom-left atom-info card, the right-side selected-residues
  panel, and the sequence-panel highlight state, all three in sync. Clicking
  a residue in the sequence panel does the same thing in reverse (finds the
  atom via `viewer.selectedAtoms({chain, resi})` to get coordinates for the
  label).
- "Highlight Interface" fetches the interface endpoint with the current
  cutoff value, stores the result, re-applies styling with the overlay, and
  prints a per-chain residue-count + full residue-list readout. "Clear
  Highlight" drops the stored interface data and re-applies plain styling.
- Escape all user-supplied/metadata-sourced text before inserting into
  `innerHTML` (basic `&<>"'` entity escaping) to avoid XSS from metadata
  content.

### 7. Deployment architecture

```
Internet
   │
   ▼
 nginx (port 80, reverse proxy)  ──►  Node.js/Express (127.0.0.1:3000)
                                            │
                                            reads INPUT_DATA_DIR live,
                                            on every request
```

- nginx config: `listen 80 default_server;` (and `[::]:80`), single
  `location /` block `proxy_pass`-ing to `http://127.0.0.1:3000` with
  standard `Upgrade`/`Connection`/`Host`/`X-Real-IP` proxy headers and
  `client_max_body_size 50M` (structure files, especially raw PDB/mmCIF with
  large MSAs referenced alongside them, can be large).
- systemd unit: `Type=simple`, runs as an unprivileged service user,
  `WorkingDirectory` = app install directory, `ExecStart=/usr/bin/node
  server.js`, `Restart=on-failure`, with `PORT`, `INPUT_DATA_DIR`,
  `ADMIN_PASSWORD`, and `JWT_SECRET` set via `Environment=` lines. **Never
  commit real values for `ADMIN_PASSWORD`/`JWT_SECRET`** — the committed unit
  file template should contain placeholder values only, with a comment
  telling the operator to override them.
- A `setup.sh` install script should: install Node.js LTS + nginx if
  missing, clone the app repo into the install directory, `npm install
  --omit=dev`, template the systemd unit with the real data directory path,
  enable + start the service, install the nginx site config, and reload
  nginx.
- HTTPS: use Certbot (`certbot --nginx -d <hostname>`) once the server has a
  real DNS hostname — **note that Let's Encrypt cannot issue a certificate
  for a bare IP address**, only for a hostname it can validate via HTTP-01 or
  DNS-01 challenge. If the deployment target is only reachable by IP (no
  hostname assigned yet), do not attempt to configure HTTPS — serve
  temporarily over plain HTTP and restrict access at the network/firewall
  layer to known source addresses in the interim, calling this out explicitly
  as a temporary state in your documentation, not a permanent design
  decision.

### 8. Non-functional / operational requirements

- No secrets anywhere in source control: `.env` in `.gitignore`, an
  `.env.example` template with placeholder values, and the systemd unit file
  template committed with placeholder `ADMIN_PASSWORD`/`JWT_SECRET` values
  only.
- Never expose port 3000 directly to the internet — only nginx (or
  equivalent reverse proxy) should be reachable externally.
- All `/api/*` routes except `/api/login` require a valid Bearer JWT.
- Structure/metadata resolution must fail soft (empty array / 404 JSON),
  never throw an unhandled exception that crashes the process — wrap file
  reads and parses in try/catch and return `{ error: err.message }` with a
  5xx status on unexpected errors.

### 9. What "done" looks like

A user can: log in; pick a plant species / pathogen species / effector name
(any combination, cross-filtered so invalid combinations never appear); see
the matching curated interaction pairs; pick one; see which of the 5
prediction methods actually produced a usable structure for that specific
pair (accounting for real-world failed/incomplete runs and the identifier
naming quirks between tools); pick a method and a model index; load the 3D
structure; switch between cartoon/stick/surface rendering; toggle AlphaFold
DB pLDDT confidence coloring on and off; compute and visually highlight the
inter-chain interface at an adjustable distance cutoff; click residues in
either the 3D view or a synced 2D sequence strip to label and track them in
a side panel; and do all of this against real prediction pipeline output on
disk without the backend ever needing to pre-process, cache, or
database-ify the structure files themselves.

**Placeholders to fill in before running this prompt:**
- `<<YOUR_INPUT_DATA_PATH>>` — absolute path on your target server to the
  directory containing `metadata_curated_positive.tsv` and the 5
  `curated_positive_<method>_results/` directories.
- Your own `ADMIN_PASSWORD` and `JWT_SECRET` values (generate a long random
  string for the latter) — set these as environment variables or in the
  systemd unit on the target server, never in source control.
- If you have already discovered identifier-aliasing mismatches in your own
  dataset (see §3), supply the concrete `ID_ALIASES` table entries; otherwise
  ask Claude to derive them by running the normalization-and-diff procedure
  described in §3 against your actual data directories before writing the
  final map.

---PROMPT END---
