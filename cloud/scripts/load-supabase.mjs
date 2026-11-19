#!/usr/bin/env node
// Load entries.json and structures.json from the export into Supabase, and
// remove rows that are no longer in the export. Safe to re-run after every
// new export.
//
// Usage: SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node load-supabase.mjs <cloud_export dir>

import fs from 'node:fs';
import path from 'node:path';

const exportDir = process.argv[2];
const { SUPABASE_URL: url, SUPABASE_SERVICE_KEY: key } = process.env;
if (!exportDir || !url || !key) {
  console.error('usage: SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node load-supabase.mjs <export dir>');
  process.exit(1);
}

const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const read = f => JSON.parse(fs.readFileSync(path.join(exportDir, f), 'utf8'));

async function rest(method, pathAndQuery, body, prefer) {
  const r = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    method,
    headers: prefer ? { ...headers, Prefer: prefer } : headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${method} ${pathAndQuery}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

const inList = vals => `(${vals.map(v => `"${String(v).replace(/"/g, '\\"')}"`).join(',')})`;

const entries = read('entries.json').map(e => ({
  identifier: e.identifier,
  plant_species: e.plantSpecies || null,
  pathogen_species: e.pathogenSpecies || null,
  effector_name: e.effectorName || null,
  data: e,
  updated_at: new Date().toISOString(),
}));
const structures = read('structures.json');

await rest('POST', 'entries?on_conflict=identifier', entries, 'resolution=merge-duplicates,return=minimal');
await rest('POST', 'structures?on_conflict=identifier,method,model', structures, 'resolution=merge-duplicates,return=minimal');

// Drop what the export no longer contains.
const existing = await rest('GET', 'structures?select=identifier,method,model');
const wanted = new Set(structures.map(s => `${s.identifier}|${s.method}|${s.model}`));
let removed = 0;
for (const s of existing) {
  if (wanted.has(`${s.identifier}|${s.method}|${s.model}`)) continue;
  await rest('DELETE', `structures?identifier=eq.${encodeURIComponent(s.identifier)}&method=eq.${s.method}&model=eq.${s.model}`);
  removed++;
}
const ids = entries.map(e => e.identifier);
await rest('DELETE', `entries?identifier=not.in.${encodeURIComponent(inList(ids))}`);

console.log(`entries: ${entries.length} upserted; structures: ${structures.length} upserted, ${removed} removed`);
