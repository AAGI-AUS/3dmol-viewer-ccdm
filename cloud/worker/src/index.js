// PPI viewer API on Cloudflare Workers — the cloud replacement for server.js.
//
// Same routes and response shapes as server.js, so public/index.html works
// against either. What changes is where things come from:
//   login      → Supabase Auth (the browser signs in; we only verify the JWT)
//   metadata   → Supabase table `entries`, read with the caller's own JWT so
//                row-level security decides access, cached briefly per isolate
//   file index → Supabase table `structures` (replaces existsSync on disk)
//   files      → R2 bucket bound as STRUCTURES
//   requests   → POST /api/access-request (CAPTCHA-checked) into
//                `access_requests`; the only route using the service key
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
// One cache per audience. Signed-in users see everything; anonymous demo
// visitors see only what row-level security lets the anon key read (rows with
// entries.demo). The two must never share a cache entry.
const dataCaches = { full: {}, demo: {} };

async function restSelect(env, token, table, select) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?select=${select}`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, Range: '0-9999' },
  });
  if (!r.ok) throw new Error(`Supabase ${table}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function loadData(env, token, audience) {
  const cache = dataCaches[audience];
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

// Public totals for the demo banner ("5 of 147"); see entry_counts() in demo.sql.
let countsCache = { value: null, until: 0 };
async function entryCounts(env) {
  if (countsCache.value && countsCache.until > Date.now()) return countsCache.value;
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/entry_counts`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!r.ok) throw new Error(String(r.status));
    countsCache = { value: await r.json(), until: Date.now() + CACHE_TTL_MS };
  } catch (err) {
    console.error('entry_counts failed', err);
    return countsCache.value || { total: 0, demo: 0 };
  }
  return countsCache.value;
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

// ── Access requests ──────────────────────────────────────────────────────────
// The one write the public can make: a request for an account, stored for you
// to review (see cloud/supabase/access-requests.sql). The CAPTCHA is checked
// here, which is why the insert goes through the Worker with the service key
// rather than straight from the browser. The reply is the same whether the
// address is new, already pending, or already has an account, so the form
// can't be used to find out who has access.
const LIMITS = { name: 200, email: 320, institution: 300, reason: 2000 };

async function handleAccessRequest(request, env) {
  if (!env.TURNSTILE_SECRET || !env.SUPABASE_SERVICE_KEY) return fail(503, 'Access requests are not enabled');
  if (Number(request.headers.get('Content-Length') || 0) > 16_384) return fail(413, 'Request too large');

  let body;
  try { body = await request.json(); } catch { return fail(400, 'Invalid request'); }
  const fields = {};
  for (const [k, max] of Object.entries(LIMITS)) {
    const v = typeof body[k] === 'string' ? body[k].trim() : '';
    if (!v) return fail(400, `Please fill in ${k === 'reason' ? 'why you need access' : k}`);
    if (v.length > max) return fail(400, `${k[0].toUpperCase() + k.slice(1)} is too long`);
    fields[k] = v;
  }
  fields.email = fields.email.toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fields.email)) return fail(400, 'Please enter a valid email address');

  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', String(body.turnstileToken || ''));
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) form.append('remoteip', ip);
  const check = await (await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })).json();
  if (!check.success) return fail(400, 'The verification check failed — please try again');

  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/access_requests`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(fields),
  });
  // 409 = a request from this address is already pending; answer as if new.
  if (!r.ok && r.status !== 409) {
    console.error('access request insert failed', r.status, await r.text());
    return fail(500, 'Could not save your request — please try again later');
  }
  return json({ ok: true });
}

// ── Router ───────────────────────────────────────────────────────────────────
async function handleApi(request, env, url) {
  const parts = url.pathname.split('/').slice(2).map(decodeURIComponent); // after "/api"

  if (parts[0] === 'config' && parts.length === 1) {
    const counts = await entryCounts(env);
    return json({
      demo: counts.demo > 0 ? { count: counts.demo, total: counts.total } : null,
      auth: 'supabase',
      supabaseUrl: env.SUPABASE_URL,
      supabaseAnonKey: env.SUPABASE_ANON_KEY,
      accessRequests: Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET && env.SUPABASE_SERVICE_KEY),
      turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
    }, 200, { 'Cache-Control': 'public, max-age=300' });
  }
  if (parts[0] === 'login') return fail(410, 'Sign in with your email address instead');
  if (parts[0] === 'access-request' && parts.length === 1) {
    if (request.method !== 'POST') return fail(405, 'Method not allowed');
    return handleAccessRequest(request, env);
  }
  if (request.method !== 'GET') return fail(405, 'Method not allowed');

  // No Authorization header at all = a demo visitor: read as the anon role, so
  // the database hands back only the demo interactions. A header that is
  // present but invalid is still a 401 — an expired session shouldn't
  // silently shrink to the demo.
  const auth = request.headers.get('Authorization');
  let token, audience;
  if (auth === null) {
    token = env.SUPABASE_ANON_KEY;
    audience = 'demo';
  } else {
    if (!auth.startsWith('Bearer ')) return fail(401, 'Unauthorized');
    token = auth.slice(7);
    try { await verifyToken(token, env); } catch { return fail(401, 'Invalid or expired token'); }
    audience = 'full';
  }

  const data = await loadData(env, token, audience);
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
    // Shareable demo link: /demo is the same page, which switches itself into
    // demo mode from the path. /demo/ would break the page's relative URLs.
    if (url.pathname === '/demo/') return Response.redirect(`${url.origin}/demo${url.search}`, 301);
    if (url.pathname === '/demo') return env.ASSETS.fetch(new Request(`${url.origin}/`, request));
    return env.ASSETS.fetch(request);
  },
};
