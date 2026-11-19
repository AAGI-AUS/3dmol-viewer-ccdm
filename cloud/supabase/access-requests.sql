-- Access requests: people without an account apply from the login page.
--
-- Flow: the Worker checks the CAPTCHA and inserts a row here. You review rows
-- in the Supabase Table Editor and set `status` to 'approved' or 'rejected'.
-- Approving sends the Supabase invite email straight from the database (via
-- pg_net), so there is no second step.
--
-- Prerequisite, run once with real values (kept out of this file):
--   select vault.create_secret('<service_role key>', 'service_role_key');
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');

create table if not exists public.access_requests (
  id                 bigint generated always as identity primary key,
  created_at         timestamptz not null default now(),
  name               text not null check (char_length(name) between 1 and 200),
  email              text not null check (char_length(email) between 3 and 320 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  institution        text not null check (char_length(institution) between 1 and 300),
  reason             text not null check (char_length(reason) between 1 and 2000),
  status             text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at        timestamptz,
  invite_request_id  bigint   -- pg_net request id; the HTTP result is in net._http_response
);

-- One open request per address; a repeat while pending is quietly ignored.
create unique index if not exists access_requests_one_pending_per_email
  on public.access_requests (lower(email)) where status = 'pending';

alter table public.access_requests enable row level security;
-- No policies: nobody reads or writes this through the API except the
-- service role (the Worker inserting, and you in the dashboard).
revoke all on public.access_requests from anon, authenticated;
grant select, insert, update on public.access_requests to service_role;

create extension if not exists pg_net with schema extensions;

create or replace function public.access_request_on_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  service_key text;
  project_url text;
begin
  if new.status is distinct from old.status then
    new.reviewed_at := now();
  end if;

  if new.status = 'approved' and old.status is distinct from 'approved' then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    select decrypted_secret into project_url from vault.decrypted_secrets where name = 'project_url';
    if service_key is null or project_url is null then
      raise exception 'access_requests: vault secrets service_role_key / project_url are not set';
    end if;
    new.invite_request_id := net.http_post(
      url     := project_url || '/auth/v1/invite',
      headers := jsonb_build_object(
                   'apikey', service_key,
                   'Authorization', 'Bearer ' || service_key,
                   'Content-Type', 'application/json'),
      body    := jsonb_build_object('email', new.email)
    );
  end if;
  return new;
end;
$$;

revoke all on function public.access_request_on_review() from public, anon, authenticated;

drop trigger if exists access_request_on_review on public.access_requests;
create trigger access_request_on_review
  before update on public.access_requests
  for each row execute function public.access_request_on_review();

-- Did the invite go out? Join the request to pg_net's response log (kept ~6 h).
create or replace view public.access_request_invites
with (security_invoker = true) as
  select r.id, r.email, r.status, r.reviewed_at, resp.status_code, resp.content::text as response
  from public.access_requests r
  left join net._http_response resp on resp.id = r.invite_request_id
  where r.invite_request_id is not null;
revoke all on public.access_request_invites from anon, authenticated;
