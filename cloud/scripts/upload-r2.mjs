#!/usr/bin/env node
// Upload the exported structure files to R2 through the Cloudflare REST API.
// Needs only an API token with "Workers R2 Storage: Edit" — no S3 keys.
//
// Usage: CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… \
//        node upload-r2.mjs <cloud_export dir> [bucket=ppi-structures]

import fs from 'node:fs';
import path from 'node:path';

const exportDir = process.argv[2];
const bucket = process.argv[3] || 'ppi-structures';
const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = process.env;
if (!exportDir || !account || !token) {
  console.error('usage: CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… node upload-r2.mjs <export dir> [bucket]');
  process.exit(1);
}

const structures = JSON.parse(fs.readFileSync(path.join(exportDir, 'structures.json'), 'utf8'));
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/objects/`;
const CONCURRENCY = 8;

async function put(s, attempt = 1) {
  const body = fs.readFileSync(path.join(exportDir, 'structures', s.r2_key));
  const key = s.r2_key.split('/').map(encodeURIComponent).join('/');
  const r = await fetch(base + key, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain; charset=utf-8' },
    body,
  });
  if (r.ok) return;
  if (attempt < 4 && (r.status === 429 || r.status >= 500)) {
    await new Promise(res => setTimeout(res, 1000 * attempt));
    return put(s, attempt + 1);
  }
  throw new Error(`${s.r2_key}: ${r.status} ${await r.text()}`);
}

let next = 0, done = 0;
const failures = [];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < structures.length) {
    const s = structures[next++];
    try { await put(s); } catch (e) { failures.push(e.message); }
    if (++done % 50 === 0 || done === structures.length) console.log(`${done}/${structures.length}`);
  }
}));

if (failures.length) {
  console.error(`${failures.length} uploads failed:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`uploaded ${structures.length} files to r2://${bucket}`);
