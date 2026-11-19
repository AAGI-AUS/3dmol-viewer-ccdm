-- Public demo: a few interactions anyone can open without signing in.
--
-- Which ones is decided by entries.demo — tick or untick it in the Table
-- Editor; the Worker picks the change up within five minutes. Anonymous
-- visitors (the anon key, no user token) can read only demo rows and their
-- structures; everything else still needs a signed-in user. Enforced here by
-- row-level security, not by the Worker.

alter table public.entries add column if not exists demo boolean not null default false;

grant select on public.entries, public.structures to anon;

drop policy if exists "anyone can read demo entries" on public.entries;
create policy "anyone can read demo entries"
  on public.entries for select to anon using (demo);

drop policy if exists "anyone can read demo structures" on public.structures;
create policy "anyone can read demo structures"
  on public.structures for select to anon
  using (exists (select 1 from public.entries e where e.identifier = structures.identifier and e.demo));

-- "5 of 147" on the demo banner: the total is public, the rows are not.
create or replace function public.entry_counts()
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object('total', count(*), 'demo', count(*) filter (where demo))
  from public.entries;
$$;
revoke all on function public.entry_counts() from public;
grant execute on function public.entry_counts() to anon, authenticated;
