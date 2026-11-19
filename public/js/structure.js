// Structure parsing and analysis, shared by the browser (index.html imports it
// to compute the interface and sequence locally) and the cloud API Worker.
//
// The parsers are the ones from server.js. findInterfaceResidues returns the
// same answer as the server.js version but buckets atoms into a grid of
// cutoff-sized cells first, so only atoms in neighbouring cells are compared.
// The all-pairs version is O(atoms²) and blows the Workers CPU budget on the
// larger complexes; this one is roughly linear.

export function parsePdbAtoms(pdbText) {
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

export function parseCifAtoms(cifText) {
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

export function parseAtoms(text, format) {
  return format === 'cif' ? parseCifAtoms(text) : parsePdbAtoms(text);
}

export function sequenceByChain(atoms) {
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
  return result;
}

// Residues are keyed by chain:resSeq, as in server.js's groupResidues. Two
// residues on different chains are in contact when any pair of their atoms is
// within `cutoff` Å.
// A residue is "in the interface" once any of its atoms is within the cutoff of
// any atom on another chain, so once both residues of a pair are marked there
// is nothing left to learn from it and the distance check is skipped.
export function findInterfaceResidues(atoms, cutoff) {
  const n = atoms.length;
  const cutoff2 = cutoff * cutoff;
  const chainIds = [...new Set(atoms.map(a => a.chain))].sort();
  const chainIdx = new Map(chainIds.map((c, i) => [c, i]));

  const xs = new Float64Array(n), ys = new Float64Array(n), zs = new Float64Array(n);
  const chainOf = new Int32Array(n), resOf = new Int32Array(n);
  const residueKeys = new Map(); // "chain:resSeq" -> residue index
  const residues = [];           // index -> { chain, resSeq }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  for (let i = 0; i < n; i++) {
    const a = atoms[i];
    xs[i] = a.x; ys[i] = a.y; zs[i] = a.z;
    if (a.x < minX) minX = a.x;
    if (a.y < minY) minY = a.y;
    if (a.z < minZ) minZ = a.z;
    chainOf[i] = chainIdx.get(a.chain);
    const key = `${a.chain}:${a.resSeq}`;
    let r = residueKeys.get(key);
    if (r === undefined) { r = residues.length; residueKeys.set(key, r); residues.push(a); }
    resOf[i] = r;
  }
  const hit = new Uint8Array(residues.length);

  // Bucket atoms into cutoff-sized cells; contacts can only be in the same or
  // an adjacent cell. Cell coordinates are packed into one integer key.
  const cx = new Int32Array(n), cy = new Int32Array(n), cz = new Int32Array(n);
  const SPAN = 1 << 10;
  const grid = new Map();
  for (let i = 0; i < n; i++) {
    cx[i] = Math.floor((xs[i] - minX) / cutoff);
    cy[i] = Math.floor((ys[i] - minY) / cutoff);
    cz[i] = Math.floor((zs[i] - minZ) / cutoff);
    const key = (cx[i] * SPAN + cy[i]) * SPAN + cz[i];
    let bucket = grid.get(key);
    if (!bucket) grid.set(key, bucket = []);
    bucket.push(i);
  }

  for (let i = 0; i < n; i++) {
    const ci = chainOf[i], ri = resOf[i];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const bucket = grid.get(((cx[i] + dx) * SPAN + (cy[i] + dy)) * SPAN + (cz[i] + dz));
      if (!bucket) continue;
      for (let k = 0; k < bucket.length; k++) {
        const j = bucket[k];
        if (chainOf[j] <= ci) continue;              // each cross-chain atom pair once
        const rj = resOf[j];
        if (hit[ri] && hit[rj]) continue;            // nothing new to learn
        const ddx = xs[i] - xs[j], ddy = ys[i] - ys[j], ddz = zs[i] - zs[j];
        if (ddx * ddx + ddy * ddy + ddz * ddz <= cutoff2) { hit[ri] = 1; hit[rj] = 1; }
      }
    }
  }

  const result = {};
  for (const c of chainIds) result[c] = [];
  for (let r = 0; r < residues.length; r++) {
    if (hit[r]) result[residues[r].chain].push(residues[r].resSeq);
  }
  for (const c of chainIds) result[c].sort((x, y) => x - y);
  return result;
}
