// Checks that the grid-based findInterfaceResidues in public/js/structure.js gives
// exactly the server.js result on every exported structure, and reports timing.
// Usage: node interface-equivalence.mjs <cloud_export/structures dir>

import fs from 'node:fs';
import path from 'node:path';
import { parseAtoms, findInterfaceResidues } from '../../../public/js/structure.js';

// ── server.js reference implementation, verbatim ─────────────────────────────
function groupResidues(atoms) {
  const map = {};
  for (const a of atoms) {
    const key = `${a.chain}:${a.resSeq}`;
    if (!map[key]) map[key] = { chain: a.chain, resSeq: a.resSeq, coords: [] };
    map[key].coords.push([a.x, a.y, a.z]);
  }
  return Object.values(map);
}
function referenceInterface(residues, cutoff) {
  const cutoff2 = cutoff * cutoff;
  const byChain = {};
  for (const r of residues) { if (!byChain[r.chain]) byChain[r.chain] = []; byChain[r.chain].push(r); }
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
              if ((ax-bx)**2 + (ay-by)**2 + (az-bz)**2 <= cutoff2) { contact = true; break outer; }
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

// ── Run ──────────────────────────────────────────────────────────────────────
const root = process.argv[2];
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else files.push(p);
  }
})(root);

let mismatches = 0, refMs = 0, gridMs = 0, worstGrid = 0, worstRef = 0, worstParse = 0, worstFile = "";
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const fmt = f.endsWith('.cif') ? 'cif' : 'pdb';
  let t = performance.now();
  const atoms = parseAtoms(text, fmt);
  const parseMs = performance.now() - t;
  if (parseMs > worstParse) worstParse = parseMs;
  for (const cutoff of [4, 10, 30]) {
    t = performance.now();
    const ref = referenceInterface(groupResidues(atoms), cutoff);
    const rt = performance.now() - t; refMs += rt; if (cutoff === 10 && rt > worstRef) worstRef = rt;
    t = performance.now();
    const got = findInterfaceResidues(atoms.map(a => ({ ...a })), cutoff);
    const g = performance.now() - t;
    gridMs += g;
    if (cutoff === 10 && g > worstGrid) { worstGrid = g; worstFile = f; }
    if (JSON.stringify(ref) !== JSON.stringify(got)) {
      mismatches++;
      console.log(`MISMATCH cutoff=${cutoff} ${f}`);
    }
  }
}
console.log(`files: ${files.length}, comparisons: ${files.length * 3}, mismatches: ${mismatches}`);
console.log(`total time  reference: ${(refMs / 1000).toFixed(1)} s   grid: ${(gridMs / 1000).toFixed(1)} s`);
console.log(`worst reference @10Å: ${worstRef.toFixed(1)} ms; worst grid @10Å: ${worstGrid.toFixed(1)} ms (${path.relative(root, worstFile)}); worst parse: ${worstParse.toFixed(1)} ms`);
