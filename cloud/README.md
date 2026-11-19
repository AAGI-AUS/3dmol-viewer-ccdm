# Cloud deployment: Cloudflare + Supabase

The viewer can run without the VM serving it: a Cloudflare Worker serves
`public/` and the API, Supabase handles sign-in and holds the metadata, and the
structure files live in Cloudflare R2. The VM is still where predictions are
produced; it exports the data and pushes it up.

```
Browser ──► Cloudflare Worker "ppi-viewer"
              ├─ static files      public/ (index.html, js/structure.js, legal/)
              ├─ /api/config       which login to use (public)
              ├─ /api/metadata/*   ┐
              ├─ /api/methods/:id  ├─ need a Supabase access token
              └─ /api/structure/*  ┘
                     │                 │
              Supabase Auth +     R2 bucket "ppi-structures"
              Postgres (entries,   <method>/<identifier>/model_0.<pdb|cif>
              structures)
```

* **Sign-in is invite-only.** Public sign-up is turned off in Supabase; people
  get an invite email, follow it, and set a password on the login screen.
* **Row-level security** lets signed-in users read `entries` and `structures`
  and nobody write them from the browser. The Worker reads them with the
  caller's own token, so it holds no service key.
* **Interface and sequence are computed in the browser** (`public/js/structure.js`)
  from the file already loaded in the viewer. The Worker still answers the
  `/interface` and `/sequence` routes for API compatibility, but on the free
  plan's 10 ms CPU limit the larger complexes would fail there.
* `public/index.html` works against both back ends: it asks `/api/config`, and
  falls back to the classic `/api/login` when that route doesn't exist (server.js).

## Layout

| Path | What |
|---|---|
| `export/export-data.mjs` | Runs on the VM. Picks out the one file per (interaction, method) the viewer serves and writes `entries.json` + `structures.json` |
| `supabase/schema.sql` | Tables and row-level security |
| `scripts/load-supabase.mjs` | Upserts the export into Supabase and removes rows no longer exported |
| `scripts/upload-r2.mjs` | Uploads the structure files to R2 via the Cloudflare API |
| `worker/` | The Worker (`wrangler.jsonc`, `src/`) and `test/interface-equivalence.mjs` |

## Updating the data after new predictions

On the VM, with the credentials in the environment:

```bash
cd /mnt/3dmol/cloud_export
node export-data.mjs /mnt/structures-server/input_data /mnt/3dmol/cloud_export
node upload-r2.mjs /mnt/3dmol/cloud_export
node load-supabase.mjs /mnt/3dmol/cloud_export
```

The Worker caches metadata for five minutes, so changes show up within that.

## Deploying code

```bash
cd cloud/worker
npm install
npx wrangler deploy
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` in `wrangler.jsonc` are public values
(the anon key grants nothing until a user signs in). Secrets, set with
`npx wrangler secret put <NAME>`: `SUPABASE_SERVICE_KEY` and `TURNSTILE_SECRET`,
used only by the access-request form.

## Managing users

Supabase dashboard → Authentication → Users → **Invite user**. Remove access by
deleting the user there; their current session ends within an hour.

### Access requests

People without an account can click **No account? Request access** on the
login page and send their name, email, institution and reason. The form has a
Cloudflare Turnstile check; the Worker verifies it and stores the request in
the `access_requests` table (`supabase/access-requests.sql`).

To review: Supabase dashboard → Table Editor → `access_requests`, and set
`status` to `approved` or `rejected`. Approving sends the invite email from
the database itself (trigger + `pg_net`), using the service key and project
URL stored in Supabase Vault as `service_role_key` / `project_url`. If the
service key is ever rotated, update that Vault secret and the Worker secret.
`access_request_invites` shows the invite call's HTTP result for a few hours.

The form only appears when the Worker has `TURNSTILE_SITE_KEY` (var),
`TURNSTILE_SECRET` and `SUPABASE_SERVICE_KEY` (secrets). This is the one
route that uses the service key; nothing else in the Worker does.

**Email:** Supabase's built-in mailer only delivers to members of the
Supabase team and is limited to 2 emails an hour, so invites to outside
applicants need a custom SMTP provider (Authentication → Emails → SMTP).

## Testing

`node worker/test/interface-equivalence.mjs <export>/structures` checks the
interface calculation against the original all-pairs version from server.js
on every exported file. Last run: 694 files × 3 cutoffs, 0 mismatches; worst
case 93 ms vs 2.3 s.
