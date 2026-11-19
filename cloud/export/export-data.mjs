#!/usr/bin/env node
// Export the data the viewer actually serves into a small, upload-ready tree.
//
// Runs on the VM next to the raw prediction output. Of the ~713 GB under
// INPUT_DATA_DIR the viewer only ever reads one structure file per
// (interaction, method) — model 0, see issue #21 — plus the metadata TSV. This
// script resolves those files with the same rules as server.js, copies them to
// OUT_DIR/structures/<method>/<identifier>/model_0.<ext>, and writes:
//
//   OUT_DIR/entries.json     metadata rows, shaped exactly as server.js serves them
//   OUT_DIR/structures.json  one row per uploaded file (identifier, method, model, r2_key, format, bytes)
//
// Usage: node export-data.mjs [INPUT_DATA_DIR] [OUT_DIR]

import fs from 'node:fs';
import path from 'node:path';

const INPUT_DATA_DIR = process.argv[2] || process.env.INPUT_DATA_DIR || '/mnt/structures-server/input_data';
const OUT_DIR = process.argv[3] || process.env.OUT_DIR || '/mnt/3dmol/cloud_export';
const METADATA_TSV = process.env.METADATA_TSV || path.join(INPUT_DATA_DIR, 'metadata_curated_positive.tsv');

// ── Metadata (kept in step with server.js) ────────────────────────────────────
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

const maxDefined = (...vals) => {
  const present = vals.filter(v => v !== undefined);
  return present.length ? Math.max(...present) : undefined;
};
const firstDefined = (...vals) => vals.find(v => v !== undefined);

function deriveCombinedScores(values) {
  const derived = {
    LIS: maxDefined(values.LIS_pep_rec, values.LIS_rec_pep),
    ipSAE: maxDefined(values.ipSAE_A_B, values.ipSAE_B_A),
    msa_depth_effector: firstDefined(values.effector_msa_nongap, values.effector_unpaired_msa),
    msa_depth_host: firstDefined(values.host_msa_nongap, values.host_unpaired_msa),
  };
  for (const [key, v] of Object.entries(derived)) if (v !== undefined) values[key] = v;
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
    deriveCombinedScores(values);
    if (Object.keys(values).length) scores[method] = values;
  }
  return scores;
}

function loadMetadata(text) {
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
    row.effectorSeqLen = seqLength(row.effectorSeq);
    row.targetSeqLen = seqLength(row.targetSeq);
    delete row.effectorSeq;
    delete row.targetSeq;
    if (row.identifier) rows.push(row);
  }
  return rows;
}

// ── Model file resolution (kept in step with server.js) ──────────────────────
const METHOD_DIRS = {
  af3: path.join(INPUT_DATA_DIR, 'curated_positive_af3_results'),
  afm: path.join(INPUT_DATA_DIR, 'curated_positive_afm_results'),
  boltz2: path.join(INPUT_DATA_DIR, 'curated_positive_boltz2_results'),
  chai: path.join(INPUT_DATA_DIR, 'curated_positive_chai_results'),
  esmfold2: path.join(INPUT_DATA_DIR, 'curated_positive_esmfold2_results'),
};

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
const diskIdOf = id => ID_ALIASES[id] || id;

const RESOLVERS = {
  af3: id => ({ file: path.join(METHOD_DIRS.af3, id, 'seed-1_sample-0', `${id}_seed-1_sample-0_model.cif`), format: 'cif' }),
  afm: id => { const d = diskIdOf(id); return { file: path.join(METHOD_DIRS.afm, d, d, 'ranked_0.pdb'), format: 'pdb' }; },
  boltz2: id => { const d = diskIdOf(id); return { file: path.join(METHOD_DIRS.boltz2, `${d}.yaml`, `boltz_results_${d}`, 'predictions', d, `${d}_model_0.cif`), format: 'cif' }; },
  chai: id => { const d = diskIdOf(id); return { file: path.join(METHOD_DIRS.chai, 'models', d, 'pred.model_idx_0.cif'), format: 'cif' }; },
  esmfold2: id => { const d = diskIdOf(id); return { file: path.join(METHOD_DIRS.esmfold2, d, `${d}_structure.cif`), format: 'cif' }; },
};

// ── Run ──────────────────────────────────────────────────────────────────────
const entries = loadMetadata(fs.readFileSync(METADATA_TSV, 'utf8'));
const structures = [];
const missing = [];
let totalBytes = 0;

for (const entry of entries) {
  const id = entry.identifier;
  for (const [method, resolve] of Object.entries(RESOLVERS)) {
    const { file, format } = resolve(id);
    if (!fs.existsSync(file)) { missing.push(`${method}\t${id}`); continue; }
    const r2Key = `${method}/${id}/model_0.${format}`;
    const dest = path.join(OUT_DIR, 'structures', r2Key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
    const bytes = fs.statSync(dest).size;
    totalBytes += bytes;
    structures.push({ identifier: id, method, model: 0, r2_key: r2Key, format, bytes });
  }
}

fs.writeFileSync(path.join(OUT_DIR, 'entries.json'), JSON.stringify(entries));
fs.writeFileSync(path.join(OUT_DIR, 'structures.json'), JSON.stringify(structures));
fs.writeFileSync(path.join(OUT_DIR, 'missing.tsv'), missing.join('\n') + '\n');

console.log(`entries:    ${entries.length}`);
console.log(`structures: ${structures.length} files, ${(totalBytes / 1e6).toFixed(1)} MB`);
console.log(`missing:    ${missing.length} (method, identifier) pairs with no model file — see missing.tsv`);
