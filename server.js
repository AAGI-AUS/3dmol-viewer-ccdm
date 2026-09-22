const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production-3dmol-2024';
const PORT = process.env.PORT || 3000;

const INPUT_DATA_DIR = process.env.INPUT_DATA_DIR || '/mnt/structures-server/input_data';
const METADATA_TSV = process.env.METADATA_TSV || path.join(INPUT_DATA_DIR, 'metadata_curated_positive.tsv');

// ── Users — password set via ADMIN_PASSWORD environment variable ─────────────
const _adminPass = process.env.ADMIN_PASSWORD;
if (!_adminPass) { console.error('ADMIN_PASSWORD env var not set'); process.exit(1); }
const USERS = { admin: bcrypt.hashSync(_adminPass, 10) };

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const hash = USERS[username];
  if (!hash || !bcrypt.compareSync(password, hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, username });
});

// ── Metadata (metadata_curated_positive.tsv) ──────────────────────────────────
const METADATA_COLUMNS = {
  'Identifier': 'identifier',
  'Effector name': 'effectorName',
  'Effector Allele': 'effectorAllele',
  'Plant protein/domain name': 'plantProteinName',
  'PDB (if available)': 'pdb',
  'Pathogen Species': 'pathogenSpecies',
  'Plant species': 'plantSpecies',
  'Reference(s)': 'references',
  'Citation (Harvard style)': 'citation',
  'Evidence of interaction': 'evidenceOfInteraction',
  'Experiment type': 'experimentType',
  'Host protein description': 'hostProteinDescription',
  'Effector-host interaction': 'effectorHostInteraction',
  'Mechanism': 'mechanism',
  'Effector sequence': 'effectorSeq',
  'Plant protein/domain sequence': 'targetSeq',
};

// ── Prediction quality scores ────────────────────────────────────────────────
// Chain A is the effector and chain B is the target (see issue #8), so the raw
// *_A / *_B columns are re-labelled in terms of those roles for the UI. Metrics
// are grouped so the comparison table reads top-down from "how good is the whole
// complex" to "how good is each chain".
const SCORE_GROUPS = [
  { key: 'global',    label: 'Global confidence' },
  { key: 'interface', label: 'Interface quality' },
  { key: 'chains',    label: 'Per-chain & MSA depth' },
];

const SCORE_METRICS = [
  { key: 'pTM',                   group: 'global',    label: 'pTM',                scale: 'unit',  better: 'high', desc: 'Predicted TM-score of the whole complex' },
  { key: 'ipTM',                  group: 'global',    label: 'ipTM',               scale: 'unit',  better: 'high', desc: 'Interface predicted TM-score' },
  { key: 'composite',             group: 'global',    label: '0.8·ipTM + 0.2·pTM', scale: 'unit',  better: 'high', desc: 'AlphaFold ranking score — the usual headline number' },
  { key: 'pdockq',                group: 'interface', label: 'pDockQ',             scale: 'unit',  better: 'high', desc: 'Predicted DockQ score for the interface' },
  { key: 'pdockq2_A',             group: 'interface', label: 'pDockQ2',            sub: 'effector (A)',      scale: 'unit',  better: 'high', desc: 'pDockQ2 computed on chain A, the effector' },
  { key: 'pdockq2_B',             group: 'interface', label: 'pDockQ2',            sub: 'target (B)',        scale: 'unit',  better: 'high', desc: 'pDockQ2 computed on chain B, the target' },
  { key: 'LIS_pep_rec',           group: 'interface', label: 'LIS pep→rec',        sub: 'effector → target', scale: 'unit',  better: 'high', desc: 'Local interaction score, effector onto target' },
  { key: 'LIS_rec_pep',           group: 'interface', label: 'LIS rec→pep',        sub: 'target → effector', scale: 'unit',  better: 'high', desc: 'Local interaction score, target onto effector' },
  { key: 'ipSAE_A_B',             group: 'interface', label: 'ipSAE A→B',          sub: 'effector → target', scale: 'unit',  better: 'high', desc: 'Interface pairwise score, effector onto target' },
  { key: 'ipSAE_B_A',             group: 'interface', label: 'ipSAE B→A',          sub: 'target → effector', scale: 'unit',  better: 'high', desc: 'Interface pairwise score, target onto effector' },
  { key: 'fraction_disorder',     group: 'chains',    label: 'Fraction disorder',  sub: 'lower is better', scale: 'unit',  better: 'low',  desc: 'Fraction of residues predicted disordered — lower is better' },
  { key: 'effector_pTM',          group: 'chains',    label: 'Effector pTM',       sub: 'chain A',  scale: 'unit',  better: 'high' },
  { key: 'effector_unpaired_msa', group: 'chains',    label: 'Effector MSA depth', sub: 'unpaired', scale: 'count', better: 'high' },
  { key: 'effector_paired_msa',   group: 'chains',    label: 'Effector MSA depth', sub: 'paired',   scale: 'count', better: 'high' },
  { key: 'effector_msa_nongap',   group: 'chains',    label: 'Effector MSA depth', sub: 'non-gap',  scale: 'count', better: 'high' },
  { key: 'host_pTM',              group: 'chains',    label: 'Host pTM',           sub: 'chain B',  scale: 'unit',  better: 'high' },
  { key: 'host_unpaired_msa',     group: 'chains',    label: 'Host MSA depth',     sub: 'unpaired', scale: 'count', better: 'high' },
  { key: 'host_paired_msa',       group: 'chains',    label: 'Host MSA depth',     sub: 'paired',   scale: 'count', better: 'high' },
  { key: 'host_msa_nongap',       group: 'chains',    label: 'Host MSA depth',     sub: 'non-gap',  scale: 'count', better: 'high' },
];

// Each method reports a different subset of the metrics above, under its own
// column prefix. Anything absent here is simply not computed for that method,
// and renders as "not available" rather than as a zero.
const METHOD_SCORE_COLUMNS = {
  af3: {
    pTM: 'AF3_pTM', ipTM: 'AF3_ipTM', composite: 'AF3_0.8ipTM+0.2pTM',
    pdockq: 'AF3_pdockq', pdockq2_A: 'AF3_pdockq2_A', pdockq2_B: 'AF3_pdockq2_B',
    LIS_pep_rec: 'AF3_LIS_pep_rec', LIS_rec_pep: 'AF3_LIS_rec_pep',
    ipSAE_A_B: 'AF3_ipSAE_A_B', ipSAE_B_A: 'AF3_ipSAE_B_A',
    fraction_disorder: 'AF3_fraction_disorder',
    effector_pTM: 'AF3_effector_pTM',
    effector_unpaired_msa: 'AF3_effector_unpaired_msa_depth',
    effector_paired_msa: 'AF3_effector_paired_msa_depth',
    host_pTM: 'AF3_host_pTM',
    host_unpaired_msa: 'AF3_host_unpaired_msa_depth',
    host_paired_msa: 'AF3_host_paired_msa_depth',
  },
  afm: {
    pTM: 'AFM_pTM', ipTM: 'AFM_ipTM', composite: 'AFM_0.8ipTM+0.2pTM',
    pdockq: 'AFM_pdockq', pdockq2_A: 'AFM_pdockq2_A', pdockq2_B: 'AFM_pdockq2_B',
    LIS_pep_rec: 'AFM_LIS_pep_rec', LIS_rec_pep: 'AFM_LIS_rec_pep',
    ipSAE_A_B: 'AFM_ipSAE_A_B', ipSAE_B_A: 'AFM_ipSAE_B_A',
    fraction_disorder: 'AFM_fraction_disorder',
    effector_msa_nongap: 'AFM_Effector_msa_depth_nongap',
    host_msa_nongap: 'AFM_Host_msa_depth_nongap',
  },
  boltz2: {
    pTM: 'Boltz_pTM', ipTM: 'Boltz_ipTM', composite: 'Boltz_0.8ipTM+0.2pTM',
    pdockq: 'Boltz_pdockq', pdockq2_A: 'Boltz_pdockq2_A', pdockq2_B: 'Boltz_pdockq2_B',
    LIS_pep_rec: 'Boltz_LIS_pep_rec', LIS_rec_pep: 'Boltz_LIS_rec_pep',
    ipSAE_A_B: 'Boltz_ipSAE_A_B', ipSAE_B_A: 'Boltz_ipSAE_B_A',
    fraction_disorder: 'Boltz_fraction_disorder',
    effector_pTM: 'Boltz_effector_pTM',
    effector_msa_nongap: 'Boltz_Effector_msa_depth_nongap',
    host_pTM: 'Boltz_host_pTM',
    host_msa_nongap: 'Boltz_Host_msa_depth_nongap',
  },
  chai: {
    pTM: 'Chai_pTM', ipTM: 'Chai_ipTM', composite: 'Chai_0.8ipTM+0.2pTM',
    fraction_disorder: 'Chai_fraction_disorder',
    effector_pTM: 'Chai_effector_pTM',
    effector_msa_nongap: 'Chai_Effector_msa_depth_nongap',
    host_pTM: 'Chai_host_pTM',
    host_msa_nongap: 'Chai_Host_msa_depth_nongap',
  },
  esmfold2: {
    pTM: 'esmfold2_pTM', ipTM: 'esmfold2_ipTM', composite: 'esmfold2_0.8ipTM+0.2pTM',
    pdockq: 'esmfold2_pdockq', pdockq2_A: 'esmfold2_pdockq2_A', pdockq2_B: 'esmfold2_pdockq2_B',
    LIS_pep_rec: 'esmfold2_LIS_pep_rec', LIS_rec_pep: 'esmfold2_LIS_rec_pep',
    ipSAE_A_B: 'esmfold2_ipSAE_A_B', ipSAE_B_A: 'esmfold2_ipSAE_B_A',
    fraction_disorder: 'esmfold2_fraction_disorder',
  },
};

// A cell only counts as comparable if it parses as a finite number. Blanks and
// "NA" mean the run failed or the metric was never computed, and issue #12 asks
// for those to be dropped from the comparison rather than shown as a zero.
function parseScore(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s || /^(na|n\/a|nan|none|null|-|\.)$/i.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

function seqLength(seq) {
  const clean = String(seq || '').replace(/\s/g, '');
  return clean.length || null;
}

function extractScores(cols, headerIndex) {
  const scores = {};
  for (const [method, mapping] of Object.entries(METHOD_SCORE_COLUMNS)) {
    const values = {};
    for (const [metric, column] of Object.entries(mapping)) {
      const idx = headerIndex[column];
      if (idx === undefined) continue;
      const v = parseScore(cols[idx]);
      if (v !== null) values[metric] = v;
    }
    if (Object.keys(values).length) scores[method] = values;
  }
  return scores;
}

function loadMetadata() {
  const text = fs.readFileSync(METADATA_TSV, 'utf8');
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  if (!lines.length) return [];
  const header = lines[0].split('\t');
  const colIndex = {};
  const headerIndex = {};
  header.forEach((h, i) => {
    headerIndex[h.trim()] = i;
    const key = METADATA_COLUMNS[h];
    if (key) colIndex[key] = i;
  });
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    const row = {};
    for (const [key, idx] of Object.entries(colIndex)) row[key] = (cols[idx] || '').trim();
    row.scores = extractScores(cols, headerIndex);
    // Only the lengths are useful to the client (they identify which chain is
    // which when a model's chain letters are not A/B), and shipping 147 full
    // sequence pairs to the browser is pure weight — keep the counts, drop the
    // sequences.
    row.effectorSeqLen = seqLength(row.effectorSeq);
    row.targetSeqLen = seqLength(row.targetSeq);
    delete row.effectorSeq;
    delete row.targetSeq;
    if (row.identifier) rows.push(row);
  }
  return rows;
}

let METADATA = [];
try {
  METADATA = loadMetadata();
  console.log(`Loaded ${METADATA.length} metadata rows from ${METADATA_TSV}`);
} catch (err) {
  console.error(`Failed to load metadata TSV (${METADATA_TSV}): ${err.message}`);
}

// Query params may arrive as a single value or (repeated key, e.g.
// ?plantSpecies=A&plantSpecies=B) an array — normalize to an array either way.
function toArray(v) {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

// Cross-filtering: each field's option list is computed from the OTHER two
// currently-selected filters (never from its own), so whatever the user picks
// next is guaranteed to be part of at least one matching row. Each filter
// is now a set of values (multi-select), matched with OR within a field.
app.get('/api/metadata/filters', requireAuth, (req, res) => {
  const plantSpecies = toArray(req.query.plantSpecies);
  const pathogenSpecies = toArray(req.query.pathogenSpecies);
  const effectorName = toArray(req.query.effectorName);
  const rowsExcluding = (excludeField) => METADATA.filter(r => {
    if (excludeField !== 'plantSpecies' && plantSpecies.length && !plantSpecies.includes(r.plantSpecies)) return false;
    if (excludeField !== 'pathogenSpecies' && pathogenSpecies.length && !pathogenSpecies.includes(r.pathogenSpecies)) return false;
    if (excludeField !== 'effectorName' && effectorName.length && !effectorName.includes(r.effectorName)) return false;
    return true;
  });
  const uniq = (rows, key) => [...new Set(rows.map(r => r[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  res.json({
    plantSpecies: uniq(rowsExcluding('plantSpecies'), 'plantSpecies'),
    pathogenSpecies: uniq(rowsExcluding('pathogenSpecies'), 'pathogenSpecies'),
    effectorNames: uniq(rowsExcluding('effectorName'), 'effectorName'),
  });
});

app.get('/api/metadata/search', requireAuth, (req, res) => {
  const plantSpecies = toArray(req.query.plantSpecies);
  const pathogenSpecies = toArray(req.query.pathogenSpecies);
  const effectorName = toArray(req.query.effectorName);
  let rows = METADATA;
  if (plantSpecies.length) rows = rows.filter(r => plantSpecies.includes(r.plantSpecies));
  if (pathogenSpecies.length) rows = rows.filter(r => pathogenSpecies.includes(r.pathogenSpecies));
  if (effectorName.length) rows = rows.filter(r => effectorName.includes(r.effectorName));
  res.json({ entries: rows });
});

// The per-entry numbers already ride along on the metadata rows (row.scores);
// this endpoint just hands the frontend the labels, ordering and scale hints it
// needs to lay the comparison out.
app.get('/api/scores/metrics', requireAuth, (req, res) => {
  res.json({ groups: SCORE_GROUPS, metrics: SCORE_METRICS, methodLabels: METHOD_LABELS });
});

app.get('/api/metadata/entry/:id', requireAuth, (req, res) => {
  const row = METADATA.find(r => r.identifier === req.params.id);
  if (!row) return res.status(404).json({ error: 'Entry not found' });
  res.json(row);
});

// ── Prediction methods — resolve model files per identifier ──────────────────
const METHOD_DIRS = {
  af3: path.join(INPUT_DATA_DIR, 'curated_positive_af3_results'),
  afm: path.join(INPUT_DATA_DIR, 'curated_positive_afm_results'),
  boltz2: path.join(INPUT_DATA_DIR, 'curated_positive_boltz2_results'),
  chai: path.join(INPUT_DATA_DIR, 'curated_positive_chai_results'),
  esmfold2: path.join(INPUT_DATA_DIR, 'curated_positive_esmfold2_results'),
};

const METHOD_LABELS = {
  af3: 'AlphaFold3',
  afm: 'AlphaFold-Multimer',
  boltz2: 'Boltz-2',
  chai: 'Chai-1',
  esmfold2: 'ESMFold2',
};

// AF3 sanitizes special characters out of job names, and the TSV Identifier
// column follows AF3's spelling. AFM/Boltz2/Chai/ESMFold2 were run with the
// literal (unsanitized) name, so their output directories differ for a
// handful of pairs. Map TSV identifier -> actual on-disk name for those four
// tools only; AF3 always matches the TSV identifier directly.
const ID_ALIASES = {
  'AvrBs3_Xanthomonas_campestris_pv._vesicatoria_Caimp1_Capsicum_annuum':
    'AvrBs3_Xanthomonas_campestris_pv._vesicatoria_Caimpα1_Capsicum_annuum',
  'PexRD2_Phytophthora_infestans_MAPKKK_Solanum_tuberosum':
    'PexRD2_Phytophthora_infestans_MAPKKKε_Solanum_tuberosum',
  'Pst15882_Puccinia_striiformisf._sp.tritici_TaMYB50_Triticum_aestivum':
    'Pst15882_Puccinia_striiformis f._sp. tritici_TaMYB50_Triticum_aestivum',
  'SnTox1_Parastagonospora_nodorum_Snn1Snn1-B1_Triticum_aestivum':
    'SnTox1_Parastagonospora_nodorum_Snn1(Snn1-B1)_Triticum_aestivum',
  'VdCE11_Verticillium_dahliae_GhAP1_Gossypium_hirsutum_Arabidopsis_thaliana':
    'VdCE11_Verticillium_dahliae_GhAP1_Gossypium_hirsutum;_Arabidopsis_thaliana',
};
function resolveDiskId(id) {
  return ID_ALIASES[id] || id;
}

// Only model 0 is exposed (issue #21): it is the best-ranked prediction for
// every method that produces several, and the viewer no longer lets the user
// pick between them. AF3/AFM/Chai each wrote five samples to disk; the rest
// are left on disk but never served.
function resolveAf3(id) {
  const f = path.join(METHOD_DIRS.af3, id, 'seed-1_sample-0', `${id}_seed-1_sample-0_model.cif`);
  return fs.existsSync(f) ? [{ model: 0, file: f, format: 'cif' }] : [];
}

function resolveAfm(id) {
  const diskId = resolveDiskId(id);
  const f = path.join(METHOD_DIRS.afm, diskId, diskId, 'ranked_0.pdb');
  return fs.existsSync(f) ? [{ model: 0, file: f, format: 'pdb' }] : [];
}

function resolveBoltz2(id) {
  const diskId = resolveDiskId(id);
  const dir = path.join(METHOD_DIRS.boltz2, `${diskId}.yaml`, `boltz_results_${diskId}`, 'predictions', diskId);
  const f = path.join(dir, `${diskId}_model_0.cif`);
  return fs.existsSync(f) ? [{ model: 0, file: f, format: 'cif' }] : [];
}

function resolveChai(id) {
  const diskId = resolveDiskId(id);
  const f = path.join(METHOD_DIRS.chai, 'models', diskId, 'pred.model_idx_0.cif');
  return fs.existsSync(f) ? [{ model: 0, file: f, format: 'cif' }] : [];
}

function resolveEsmfold2(id) {
  const diskId = resolveDiskId(id);
  const f = path.join(METHOD_DIRS.esmfold2, diskId, `${diskId}_structure.cif`);
  return fs.existsSync(f) ? [{ model: 0, file: f, format: 'cif' }] : [];
}

const RESOLVERS = { af3: resolveAf3, afm: resolveAfm, boltz2: resolveBoltz2, chai: resolveChai, esmfold2: resolveEsmfold2 };

function getModelsFor(method, id) {
  const fn = RESOLVERS[method];
  return fn ? fn(id) : [];
}

function resolveModelEntry(method, id, model) {
  const models = getModelsFor(method, id);
  return models.find(m => m.model === parseInt(model, 10));
}

app.get('/api/methods/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  const methods = {};
  for (const method of Object.keys(METHOD_DIRS)) {
    methods[method] = { label: METHOD_LABELS[method], models: getModelsFor(method, id).map(m => m.model) };
  }
  res.json({ methods });
});

// ── Structure parsing (PDB + mmCIF) ───────────────────────────────────────────
function parsePdbAtoms(pdbText) {
  const atoms = [];
  for (const line of pdbText.split('\n')) {
    if (!/^ATOM/.test(line)) continue;
    const chain = line[21];
    const resSeq = parseInt(line.substring(22, 26), 10);
    const resn = line.substring(17, 20).trim();
    const x = parseFloat(line.substring(30, 38));
    const y = parseFloat(line.substring(38, 46));
    const z = parseFloat(line.substring(46, 54));
    if (isNaN(x) || isNaN(y) || isNaN(z) || isNaN(resSeq)) continue;
    atoms.push({ chain, resSeq, resn, x, y, z });
  }
  return atoms;
}

// Minimal mmCIF _atom_site loop parser — reads whichever column set (auth_* preferred,
// falling back to label_*) the file provides, since AF3/Boltz2/Chai/ESMFold2 all emit
// standard PDBx/mmCIF but with slightly different loop layouts.
function parseCifAtoms(cifText) {
  const lines = cifText.split('\n').map(l => l.trimEnd());
  const atoms = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim().startsWith('_atom_site.')) { i++; continue; }

    const columns = [];
    while (i < lines.length && lines[i].trim().startsWith('_atom_site.')) {
      columns.push(lines[i].trim().slice('_atom_site.'.length));
      i++;
    }
    const colIndex = {};
    columns.forEach((c, idx) => { colIndex[c] = idx; });
    const chainKey = 'auth_asym_id' in colIndex ? 'auth_asym_id' : 'label_asym_id';
    const resSeqKey = 'auth_seq_id' in colIndex ? 'auth_seq_id' : 'label_seq_id';
    const resnKey = 'auth_comp_id' in colIndex ? 'auth_comp_id' : 'label_comp_id';

    while (i < lines.length) {
      const t = lines[i].trim();
      if (t === '' || t.startsWith('_') || t === 'loop_' || t.startsWith('#')) break;
      const parts = t.split(/\s+/);
      if (parts.length >= columns.length) {
        const group = parts[colIndex['group_PDB']];
        if (group === 'ATOM' || group === 'HETATM') {
          const chain = parts[colIndex[chainKey]];
          const resSeq = parseInt(parts[colIndex[resSeqKey]], 10);
          const resn = parts[colIndex[resnKey]];
          const x = parseFloat(parts[colIndex['Cartn_x']]);
          const y = parseFloat(parts[colIndex['Cartn_y']]);
          const z = parseFloat(parts[colIndex['Cartn_z']]);
          if (!isNaN(x) && !isNaN(y) && !isNaN(z) && !isNaN(resSeq)) {
            atoms.push({ chain, resSeq, resn, x, y, z });
          }
        }
      }
      i++;
    }
  }
  return atoms;
}

function parseAtoms(text, format) {
  return format === 'cif' ? parseCifAtoms(text) : parsePdbAtoms(text);
}

function groupResidues(atoms) {
  const map = {};
  for (const a of atoms) {
    const key = `${a.chain}:${a.resSeq}`;
    if (!map[key]) map[key] = { chain: a.chain, resSeq: a.resSeq, coords: [] };
    map[key].coords.push([a.x, a.y, a.z]);
  }
  return Object.values(map);
}

function findInterfaceResidues(residues, cutoff) {
  const cutoff2 = cutoff * cutoff;
  const byChain = {};
  for (const r of residues) {
    if (!byChain[r.chain]) byChain[r.chain] = [];
    byChain[r.chain].push(r);
  }

  const chainIds = Object.keys(byChain).sort();
  const hits = {};
  for (const c of chainIds) hits[c] = new Set();

  for (let i = 0; i < chainIds.length; i++) {
    for (let j = i + 1; j < chainIds.length; j++) {
      const cA = chainIds[i], cB = chainIds[j];
      for (const rA of byChain[cA]) {
        for (const rB of byChain[cB]) {
          let contact = false;
          outer: for (const [ax, ay, az] of rA.coords) {
            for (const [bx, by, bz] of rB.coords) {
              if ((ax-bx)**2 + (ay-by)**2 + (az-bz)**2 <= cutoff2) {
                contact = true; break outer;
              }
            }
          }
          if (contact) { hits[cA].add(rA.resSeq); hits[cB].add(rB.resSeq); }
        }
      }
    }
  }

  const result = {};
  for (const c of chainIds) result[c] = [...hits[c]].sort((a, b) => a - b);
  return result;
}

app.get('/api/structure/:method/:id/:model/sequence', requireAuth, (req, res) => {
  try {
    const { method, id, model } = req.params;
    const entry = resolveModelEntry(method, id, model);
    if (!entry) return res.status(404).json({ error: 'Model not found' });

    const text = fs.readFileSync(entry.file, 'utf8');
    const atoms = parseAtoms(text, entry.format);
    const chains = {};
    for (const a of atoms) {
      if (!chains[a.chain]) chains[a.chain] = new Map();
      if (!chains[a.chain].has(a.resSeq)) chains[a.chain].set(a.resSeq, a.resn);
    }
    const result = {};
    for (const [chain, map] of Object.entries(chains)) {
      result[chain] = [...map.entries()]
        .sort(([a], [b]) => a - b)
        .map(([resi, resn]) => ({ resi, resn }));
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/structure/:method/:id/:model/interface', requireAuth, (req, res) => {
  try {
    const { method, id, model } = req.params;
    const cutoff = Math.min(Math.max(parseFloat(req.query.cutoff) || 10, 1), 30);
    const entry = resolveModelEntry(method, id, model);
    if (!entry) return res.status(404).json({ error: 'Model not found' });

    const text = fs.readFileSync(entry.file, 'utf8');
    const atoms = parseAtoms(text, entry.format);
    const residues = groupResidues(atoms);
    const iface = findInterfaceResidues(residues, cutoff);
    res.json({ cutoff, interface: iface });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: serve structure file ─────────────────────────────────────────────────
app.get('/api/structure/:method/:id/:model', requireAuth, (req, res) => {
  try {
    const { method, id, model } = req.params;
    const entry = resolveModelEntry(method, id, model);
    if (!entry) return res.status(404).json({ error: 'Model not found' });

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('X-File-Format', entry.format);
    res.sendFile(path.resolve(entry.file));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`3Dmol viewer running on http://localhost:${PORT}`);
  console.log(`Reading curated interaction data from: ${INPUT_DATA_DIR}`);
});
