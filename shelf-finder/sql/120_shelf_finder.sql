-- ============================================================================
-- 120_shelf_finder.sql — The Shelf Finder, the free category tool at
-- categorypublishing.com/shelf-finder.
--
-- Runs against the same Supabase project as Smart Publishing Studio and reads
-- its existing public.kdp_categories research (migration 020). It adds no
-- category data of its own.
--
-- IMPORTANT: sales_to_1 / sales_to_10 are private research. Nothing here ever
-- exposes them. The edge function reads them with the service role to order
-- candidates, and only the chosen paths and the plain-English reasons are ever
-- written to a run or returned to a browser.
--
-- Safe to run more than once. Supabase -> SQL Editor -> paste -> Run.
-- ============================================================================

create extension if not exists pgcrypto;

-- ── One row per submission ──────────────────────────────────────────────────
create table if not exists public.shelf_finder_runs (
  id            uuid primary key default gen_random_uuid(),
  token         text not null unique,           -- what the results link carries
  email         text not null,
  first_name    text,
  source        text not null default 'shelf-finder',
  input_kind    text check (input_kind in ('upload','summary')),
  upload_path   text,                           -- in shelf-finder-uploads
  upload_name   text,
  summary       text,
  status        text not null default 'queued'
                check (status in ('queued','running','ready','failed')),
  results       jsonb not null default '[]'::jsonb,  -- [{rank,name,path,why}]
  error         text,
  kit_state     text not null default 'pending'
                check (kit_state in ('pending','subscribed','failed','skipped')),
  ip_hash       text,                           -- for rate limiting, not identity
  expires_at    timestamptz not null default now() + interval '30 days',
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create index if not exists shelf_finder_runs_token_idx   on public.shelf_finder_runs (token);
create index if not exists shelf_finder_runs_email_idx   on public.shelf_finder_runs (lower(email), created_at desc);
create index if not exists shelf_finder_runs_created_idx on public.shelf_finder_runs (created_at desc);
create index if not exists shelf_finder_runs_ip_idx      on public.shelf_finder_runs (ip_hash, created_at desc);

-- Locked down: no policies for anon or authenticated, so the only way in is the
-- reader function below or the service role inside the edge function.
alter table public.shelf_finder_runs enable row level security;

-- ── The only public read path ───────────────────────────────────────────────
-- Takes the token from the emailed link and returns just what the results page
-- renders. No email, no upload path, no ip_hash, and an expired link returns
-- nothing at all.
create or replace function public.get_shelf_results(p_token text)
returns table (first_name text, status text, results jsonb, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.first_name, r.status, r.results, r.created_at
    from public.shelf_finder_runs r
   where r.token = p_token
     and r.expires_at > now()
   limit 1
$$;

revoke all on function public.get_shelf_results(text) from public;
grant execute on function public.get_shelf_results(text) to anon, authenticated;

-- ── Manuscripts ─────────────────────────────────────────────────────────────
-- Private. The browser never touches this bucket directly with the anon key —
-- the edge function hands out a one-time signed upload URL and reads the file
-- back with the service role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shelf-finder-uploads', 'shelf-finder-uploads', false, 26214400,
        array['application/pdf',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/msword','text/plain','text/markdown','application/rtf','text/rtf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No storage policies on purpose: with none, only the service role reaches it.

-- ── Housekeeping ────────────────────────────────────────────────────────────
-- Links die at 30 days, and the manuscript should not outlive the link. Call
-- this from a scheduled job, or by hand now and then.
create or replace function public.purge_expired_shelf_runs()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with gone as (
    delete from public.shelf_finder_runs
     where expires_at < now()
     returning 1
  ) select count(*) into n from gone;
  return n;
end $$;

revoke all on function public.purge_expired_shelf_runs() from public;
