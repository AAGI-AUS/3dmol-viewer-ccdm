-- PPI viewer — Supabase schema.
-- Both tables are readable by signed-in users only; nothing is writable from
-- the browser. Data is loaded with the service key by cloud/scripts/load-supabase.mjs.

create table if not exists public.entries (
  identifier        text primary key,
  plant_species     text,
  pathogen_species  text,
  effector_name     text,
  data              jsonb not null,          -- the full row as /api/metadata/* returns it
  updated_at        timestamptz not null default now()
);

create table if not exists public.structures (
  identifier  text not null references public.entries(identifier) on delete cascade,
  method      text not null check (method in ('af3', 'afm', 'boltz2', 'chai', 'esmfold2')),
  model       int  not null default 0,
  r2_key      text not null,
  format      text not null check (format in ('pdb', 'cif')),
  bytes       int,
  primary key (identifier, method, model)
);

alter table public.entries    enable row level security;
alter table public.structures enable row level security;

drop policy if exists "signed-in users can read entries" on public.entries;
create policy "signed-in users can read entries"
  on public.entries for select to authenticated using (true);

drop policy if exists "signed-in users can read structures" on public.structures;
create policy "signed-in users can read structures"
  on public.structures for select to authenticated using (true);

revoke all on public.entries, public.structures from anon;
grant select on public.entries, public.structures to authenticated;
