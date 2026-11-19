// PPI viewer API on Cloudflare Workers — the cloud replacement for server.js.
//
// Same routes and response shapes as server.js, so public/index.html works
// against either. What changes is where things come from:
//   login      → Supabase Auth (the browser signs in; we only verify the JWT)
//   metadata   → Supabase table `entries`, read with the caller's own JWT so
//                row-level security decides access, cached briefly per isolate
//   file index → Supabase table `structures` (replaces existsSync on disk)
//   files      → R2 bucket bound as STRUCTURES
// Anything that is not /api/* is a static asset from public/.

import { createRemoteJWKSet, jwtVerify, decodeProtectedHeader } from 'jose';
import { SCORE_GROUPS, SCORE_METRICS, METHOD_LABELS } from './constants.js';
import { parseAtoms, sequenceByChain, findInterfaceResidues } from '../../../public/js/structure.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

// ── Responses ────────────────────────────────────────────────────────────────
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...extra },
});
const fail = (status, error) => json({ error }, status);

// ── Auth ─────────────────────────────────────────────────────────────────────
// New Supabase projects sign access tokens with an asymmetric key published at
// the JWKS endpoint, which we can check locally. Projects still on the legacy
// shared HS256 secret can't be verified without that secret, so for those we
// ask Supabase Auth itself and cache the answer for a minute.
let jwks = null;
const legacyTokenCache = new Map(); // token -> { user, until }

async function verifyToken(token, env) {
  const issuer = `${env.SUPABASE_URL}/auth/v1`;
  const { alg } = decodeProtectedHeader(token);
  if (alg !== 'HS256') {
    jwks ??= createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: 'authenticated' });
    return { id: payload.sub, email: payload.email };
  }
  const hit = legacyTokenCache.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  const r = await fetch(`${issuer}/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error('rejected by Supabase Auth');
  const u = await r.json();
  const user = { id: u.id, email: u.email };
  if (legacyTokenCache.size > 500) legacyTokenCache.clear();
  legacyTokenCache.set(token, { user, until: Date.now() + 60_000 });
  return user;
}

// ── Data from Supabase ───────────────────────────────────────────────────────
const cache = { entries: null, structures: null, until: 0 };

async function restSelect(env, token, table, select) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?select=${select}`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, Range: '0-9999' },
  });
  if (!r.ok) throw new Error(`Supabase ${table}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function loadData(env, token) {
  if (cache.entries && cache.until > Date.now()) return cache;
  const [entryRows, structureRows] = await Promise.all([
    restSelect(env, token, 'entries', 'data'),
    restSelect(env, token, 'structures', 'identifier,method,model,r2_key,format'),
  ]);
  cache.entries = entryRows.map(r => r.data).sort((a, b) => a.identifier.localeCompare(b.identifier));
  cache.structures = new Map(structureRows.map(s => [`${s.method}|${s.identifier}|${s.model}`, s]));
  cache.until = Date.now() + CACHE_TTL_MS;
  return cache;
}

// ── Metadata routes (logic as in server.js) ──────────────────────────────────
function filterParams(url) {
  const all = k => url.searchParams.getAll(k);
  return { plantSpecies: all('plantSpecies'), pathogenSpecies: all('pathogenSpecies'), effectorName: all('effectorName') };
}

function metadataFilters(entries, f) {
  const rowsExcluding = (exclude) => entries.filter(r => {
    if (exclude !== 'plantSpecies' && f.plantSpecies.length && !f.plantSpecies.includes(r.plantSpecies)) return false;
    if (exclude !== 'pathogenSpecies' && f.pathogenSpecies.length && !f.pathogenSpecies.includes(r.pathogenSpecies)) return false;
    if (exclude !== 'effectorName' && f.effectorName.length && !f.effectorName.includes(r.effectorName)) return false;
    return true;
  });
  const uniq = (rows, key) => [...new Set(rows.map(r => r[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return {
    plantSpecies: uniq(rowsExcluding('plantSpecies'), 'plantSpecies'),
    pathogenSpecies: uniq(rowsExcluding('pathogenSpecies'), 'pathogenSpecies'),
    effectorNames: uniq(rowsExcluding('effectorName'), 'effectorName'),
  };
}

function metadataSearch(entries, f) {
  let rows = entries;
  if (f.plantSpecies.length) rows = rows.filter(r => f.plantSpecies.includes(r.plantSpecies));
  if (f.pathogenSpecies.length) rows = rows.filter(r => f.pathogenSpecies.includes(r.pathogenSpecies));
  if (f.effectorName.length) rows = rows.filter(r => f.effectorName.includes(r.effectorName));
  return { entries: rows };
}

// ── Structure routes ─────────────────────────────────────────────────────────
async function readStructure(env, data, method, id, model) {
  const entry = data.structures.get(`${method}|${id}|${parseInt(model, 10)}`);
  if (!entry) return null;
  const obj = await env.STRUCTURES.get(entry.r2_key);
  if (!obj) return null;
  return { entry, obj };
}

// ── Router ───────────────────────────────────────────────────────────────────
async function handleApi(request, env, url) {
  const parts = url.pathname.split('/').slice(2).map(decodeURIComponent); // after "/api"

  if (parts[0] === 'config' && parts.length === 1) {
    return json({ auth: 'supabase', supabaseUrl: env.SUPABASE_URL, supabaseAnonKey: env.SUPABASE_ANON_KEY },
      200, { 'Cache-Control': 'public, max-age=300' });
  }
  if (parts[0] === 'login') return fail(410, 'Sign in with your email address instead');
  if (request.method !== 'GET') return fail(405, 'Method not allowed');

  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return fail(401, 'Unauthorized');
  const token = auth.slice(7);
  try { await verifyToken(token, env); } catch { return fail(401, 'Invalid or expired token'); }

  const data = await loadData(env, token);
  const [section, a, b, c, d] = parts;

  if (section === 'metadata') {
    if (a === 'filters') return json(metadataFilters(data.entries, filterParams(url)));
    if (a === 'search') return json(metadataSearch(data.entries, filterParams(url)));
    if (a === 'entry' && b) {
      const row = data.entries.find(r => r.identifier === b);
      return row ? json(row) : fail(404, 'Entry not found');
    }
  }

  if (section === 'scores' && a === 'metrics') {
    return json({ groups: SCORE_GROUPS, metrics: SCORE_METRICS, methodLabels: METHOD_LABELS });
  }

  if (section === 'methods' && a) {
    const methods = {};
    for (const [method, label] of Object.entries(METHOD_LABELS)) {
      methods[method] = { label, models: data.structures.has(`${method}|${a}|0`) ? [0] : [] };
    }
    return json({ methods });
  }

  if (section === 'structure' && a && b && c !== undefined) {
    const found = await readStructure(env, data, a, b, c);
    if (!found) return fail(404, 'Model not found');
    const { entry, obj } = found;

    if (d === undefined) {
      return new Response(obj.body, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-File-Format': entry.format,
          'Cache-Control': 'private, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    const atoms = parseAtoms(await obj.text(), entry.format);
    if (d === 'sequence') return json(sequenceByChain(atoms));
    if (d === 'interface') {
      const cutoff = Math.min(Math.max(parseFloat(url.searchParams.get('cutoff')) || 10, 1), 30);
      return json({ cutoff, interface: findInterfaceResidues(atoms, cutoff) });
    }
  }

  return fail(404, 'Not found');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        console.error(err);
        return fail(500, 'Internal error');
      }
    }
    return env.ASSETS.fetch(request);
  },
};
