const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production-3dmol-2024';
const AFM_DIR = process.env.AFM_DIR || '/mnt/3dmol/test_data/AFM';
const PORT = process.env.PORT || 3000;

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

// ── Helpers ───────────────────────────────────────────────────────────────────
function getStructureFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => /\.(pdb|cif|mmcif)$/i.test(f));
}

function getModelNumber(filename) {
  // ranked_0, model_0, model_v3_0, etc.
  const m = filename.match(/(?:ranked_|model[_v\d]*_?)(\d+)/i);
  return m ? parseInt(m[1]) : null;
}

function scanPairs() {
  if (!fs.existsSync(AFM_DIR)) return [];
  return fs.readdirSync(AFM_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();
}

function getPairDataDir(pair) {
  // Files live in pair/pair/ (nested) or pair/ (flat fallback)
  const nested = path.join(AFM_DIR, pair, pair);
  return fs.existsSync(nested) ? nested : path.join(AFM_DIR, pair);
}

function getModelsForPair(pair) {
  const dir = getPairDataDir(pair);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter(f => /\.pdb$/i.test(f));
  const models = [];

  for (let i = 0; i <= 4; i++) {
    if (files.includes(`ranked_${i}.pdb`)) {
      models.push({ model: i, file: `ranked_${i}.pdb` });
    } else if (files.includes(`unrelaxed_model_${i + 1}_multimer_v3_pred_0.pdb`)) {
      models.push({ model: i, file: `unrelaxed_model_${i + 1}_multimer_v3_pred_0.pdb` });
    }
  }
  return models;
}

// ── API: protein/pair listing ─────────────────────────────────────────────────
app.get('/api/pairs', requireAuth, (req, res) => {
  try {
    const { search } = req.query;
    let pairs = scanPairs();
    if (search) {
      const q = search.toLowerCase();
      pairs = pairs.filter(p => p.toLowerCase().includes(q));
    }
    res.json({ pairs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: models for a pair ────────────────────────────────────────────────────
app.get('/api/models/:pair', requireAuth, (req, res) => {
  try {
    const models = getModelsForPair(req.params.pair);
    res.json({ models: models.map(m => m.model) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Interface calculation ─────────────────────────────────────────────────────
function parsePdbAtoms(pdbText) {
  const residues = {};
  for (const line of pdbText.split('\n')) {
    if (!/^ATOM/.test(line)) continue;
    const chain  = line[21];
    const resSeq = parseInt(line.substring(22, 26), 10);
    const x = parseFloat(line.substring(30, 38));
    const y = parseFloat(line.substring(38, 46));
    const z = parseFloat(line.substring(46, 54));
    if (isNaN(x) || isNaN(y) || isNaN(z)) continue;
    const key = `${chain}:${resSeq}`;
    if (!residues[key]) residues[key] = { chain, resSeq, coords: [] };
    residues[key].coords.push([x, y, z]);
  }
  return Object.values(residues);
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

app.get('/api/structure/:pair/:model/sequence', requireAuth, (req, res) => {
  try {
    const { pair, model } = req.params;
    const models = getModelsForPair(pair);
    const entry  = models.find(m => m.model === parseInt(model, 10));
    if (!entry) return res.status(404).json({ error: 'Model not found' });

    const pdbText = fs.readFileSync(path.join(getPairDataDir(pair), entry.file), 'utf8');
    const chains  = {};
    for (const line of pdbText.split('\n')) {
      if (!/^ATOM/.test(line)) continue;
      const chain = line[21];
      const resi  = parseInt(line.substring(22, 26).trim(), 10);
      const resn  = line.substring(17, 20).trim();
      if (!chains[chain]) chains[chain] = new Map();
      if (!chains[chain].has(resi)) chains[chain].set(resi, resn);
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

app.get('/api/structure/:pair/:model/interface', requireAuth, (req, res) => {
  try {
    const { pair, model } = req.params;
    const cutoff = Math.min(Math.max(parseFloat(req.query.cutoff) || 10, 1), 30);
    const models = getModelsForPair(pair);
    const entry  = models.find(m => m.model === parseInt(model, 10));
    if (!entry) return res.status(404).json({ error: 'Model not found' });

    const pdbText   = fs.readFileSync(path.join(getPairDataDir(pair), entry.file), 'utf8');
    const residues  = parsePdbAtoms(pdbText);
    const iface     = findInterfaceResidues(residues, cutoff);
    res.json({ cutoff, interface: iface });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: serve structure file ─────────────────────────────────────────────────
app.get('/api/structure/:pair/:model', requireAuth, (req, res) => {
  try {
    const { pair, model } = req.params;
    const models = getModelsForPair(pair);
    const entry = models.find(m => m.model === parseInt(model, 10));
    if (!entry) return res.status(404).json({ error: 'Model not found' });

    const filePath = path.join(getPairDataDir(pair), entry.file);
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('X-File-Format', 'pdb');
    res.sendFile(path.resolve(filePath));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`3Dmol viewer running on http://localhost:${PORT}`);
  console.log(`Reading structures from: ${AFM_DIR}`);
});
