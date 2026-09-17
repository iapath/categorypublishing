-- ============================================================================
-- 121_enemy_finder.sql — The Enemy Finder, the free tool at
-- categorypublishing.com/enemy-finder.
--
-- The tool itself is stateless: the author's answers and starred names live in
-- their own browser, so nothing here stores what anybody wrote. This one table
-- exists to put a ceiling on a page that spends money without a login, by
-- counting turns per address per hour.
--
-- No email, no answers, no names. Just a hashed address and a clock.
--
-- Safe to run more than once. Supabase -> SQL Editor -> paste -> Run.
-- ============================================================================

create extension if not exists pgcrypto;

-- ── One row per turn taken ──────────────────────────────────────────────────
create table if not exists public.enemy_finder_turns (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid,                      -- groups one author's run, from their browser
  kind        text not null default 'turn'
              check (kind in ('turn','final','sharpen')),
  ip_hash     text,                      -- for rate limiting, not identity
  created_at  timestamptz not null default now()
);

-- The read the edge function makes on every request: this address, this hour.
create index if not exists enemy_finder_turns_ip_idx
  on public.enemy_finder_turns (ip_hash, created_at desc);
create index if not exists enemy_finder_turns_created_idx
  on public.enemy_finder_turns (created_at desc);

-- Locked down: no policies for anon or authenticated, so the only way in is
-- the service role inside the edge function.
alter table public.enemy_finder_turns enable row level security;

-- ── Housekeeping ────────────────────────────────────────────────────────────
-- The throttle only ever looks back one hour, so rows older than a day are
-- dead weight. Call this from a scheduled job, or by hand now and then.
create or replace function public.purge_old_enemy_finder_turns()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with gone as (
    delete from public.enemy_finder_turns
     where created_at < now() - interval '1 day'
     returning 1
  ) select count(*) into n from gone;
  return n;
end $$;

revoke all on function public.purge_old_enemy_finder_turns() from public;
