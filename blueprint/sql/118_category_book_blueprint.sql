-- ============================================================================
-- 118_category_book_blueprint.sql
-- The Category Book Blueprint worksheet at categorypublishing.com/blueprint.
--
-- Runs against the SAME Supabase project as Smart Publishing Studio, so it
-- reuses that project's accounts (public.app_users) and its RLS helpers
-- current_app_user_id() and is_app_admin() from 060. Run 060 first.
--
-- Safe to run more than once. Supabase -> SQL Editor -> paste -> Run.
-- ============================================================================

-- ── 1) One row per client blueprint ─────────────────────────────────────────
-- fields/checks/images are keyed by the worksheet's own data-k, data-chk and
-- image-slot ids, so the page and the row stay in sync without a migration
-- every time a question is reworded.
create table if not exists public.blueprint_projects (
  id                uuid primary key default gen_random_uuid(),
  owner_user_id     uuid not null references public.app_users(id) on delete cascade,
  client_name       text not null default '',
  category_name     text not null default '',
  status            text not null default 'draft'
                    check (status in ('draft','in_progress','delivered','archived')),
  fields            jsonb not null default '{}'::jsonb,  -- data-k        -> text
  checks            jsonb not null default '{}'::jsonb,  -- data-chk key  -> bool
  images            jsonb not null default '{}'::jsonb,  -- slot id       -> storage path
  last_opened_at    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists blueprint_projects_owner_idx
  on public.blueprint_projects (owner_user_id, updated_at desc);

-- ── 2) Version history ──────────────────────────────────────────────────────
-- Every export writes one. Gives you "what did this look like in March", and
-- gives a returning client a stable copy that is not the live draft.
create table if not exists public.blueprint_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.blueprint_projects(id) on delete cascade,
  created_by_user_id uuid references public.app_users(id) on delete set null,
  label              text,
  fields             jsonb not null default '{}'::jsonb,
  checks             jsonb not null default '{}'::jsonb,
  images             jsonb not null default '{}'::jsonb,
  pdf_path           text,
  created_at         timestamptz not null default now()
);

create index if not exists blueprint_snapshots_project_idx
  on public.blueprint_snapshots (project_id, created_at desc);

-- ── 3) Client access (for when clients revisit their own blueprint) ─────────
-- Invited by email, matched at sign-in. Nothing here grants access until that
-- person actually has an account with that email.
create table if not exists public.blueprint_shares (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.blueprint_projects(id) on delete cascade,
  email               text not null,
  access_role         text not null default 'viewer' check (access_role in ('viewer','editor')),
  invited_by_user_id  uuid references public.app_users(id) on delete set null,
  created_at          timestamptz not null default now()
);

create unique index if not exists blueprint_shares_unique_idx
  on public.blueprint_shares (project_id, lower(email));

-- ── 4) Keep updated_at honest ───────────────────────────────────────────────
create or replace function public.blueprint_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists blueprint_projects_touch on public.blueprint_projects;
create trigger blueprint_projects_touch
  before update on public.blueprint_projects
  for each row execute function public.blueprint_touch_updated_at();

-- ── 5) Who can see and change what ──────────────────────────────────────────
-- SECURITY DEFINER so the policies below do not recurse through RLS.
create or replace function public.can_read_blueprint(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select pid is not null and exists (
    select 1 from public.blueprint_projects p
    where p.id = pid and (
      p.owner_user_id = public.current_app_user_id()
      or public.is_app_admin()
      or exists (
        select 1 from public.blueprint_shares s
        where s.project_id = p.id
          and lower(s.email) = lower(coalesce(auth.jwt() ->> 'email',''))
      )
    )
  )
$$;

create or replace function public.can_edit_blueprint(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select pid is not null and exists (
    select 1 from public.blueprint_projects p
    where p.id = pid and (
      p.owner_user_id = public.current_app_user_id()
      or public.is_app_admin()
      or exists (
        select 1 from public.blueprint_shares s
        where s.project_id = p.id
          and lower(s.email) = lower(coalesce(auth.jwt() ->> 'email',''))
          and s.access_role = 'editor'
      )
    )
  )
$$;

grant execute on function public.can_read_blueprint(uuid),
                         public.can_edit_blueprint(uuid) to authenticated;

alter table public.blueprint_projects  enable row level security;
alter table public.blueprint_snapshots enable row level security;
alter table public.blueprint_shares    enable row level security;

drop policy if exists blueprint_projects_select on public.blueprint_projects;
create policy blueprint_projects_select on public.blueprint_projects
  for select to authenticated using (public.can_read_blueprint(id));

drop policy if exists blueprint_projects_insert on public.blueprint_projects;
create policy blueprint_projects_insert on public.blueprint_projects
  for insert to authenticated
  with check (owner_user_id = public.current_app_user_id() or public.is_app_admin());

drop policy if exists blueprint_projects_update on public.blueprint_projects;
create policy blueprint_projects_update on public.blueprint_projects
  for update to authenticated
  using (public.can_edit_blueprint(id)) with check (public.can_edit_blueprint(id));

drop policy if exists blueprint_projects_delete on public.blueprint_projects;
create policy blueprint_projects_delete on public.blueprint_projects
  for delete to authenticated
  using (owner_user_id = public.current_app_user_id() or public.is_app_admin());

drop policy if exists blueprint_snapshots_select on public.blueprint_snapshots;
create policy blueprint_snapshots_select on public.blueprint_snapshots
  for select to authenticated using (public.can_read_blueprint(project_id));

drop policy if exists blueprint_snapshots_insert on public.blueprint_snapshots;
create policy blueprint_snapshots_insert on public.blueprint_snapshots
  for insert to authenticated with check (public.can_edit_blueprint(project_id));

drop policy if exists blueprint_snapshots_delete on public.blueprint_snapshots;
create policy blueprint_snapshots_delete on public.blueprint_snapshots
  for delete to authenticated using (public.can_edit_blueprint(project_id));

-- Only the project owner hands out access.
drop policy if exists blueprint_shares_all on public.blueprint_shares;
create policy blueprint_shares_all on public.blueprint_shares
  for all to authenticated
  using (exists (select 1 from public.blueprint_projects p
                 where p.id = project_id
                   and (p.owner_user_id = public.current_app_user_id() or public.is_app_admin())))
  with check (exists (select 1 from public.blueprint_projects p
                 where p.id = project_id
                   and (p.owner_user_id = public.current_app_user_id() or public.is_app_admin())));

-- ── 6) Storage: the 16 image slots plus exported PDFs ───────────────────────
-- PRIVATE, unlike the studio's episode-audio bucket: this holds unpublished
-- client positioning. The app reads it with signed URLs.
-- Object paths are "<project_id>/slots/<slot-id>.<ext>" and
-- "<project_id>/exports/<timestamp>.pdf" — the leading folder is what the
-- policies below check.
insert into storage.buckets (id, name, public)
values ('blueprint-assets', 'blueprint-assets', false)
on conflict (id) do update set public = false;

create or replace function public.blueprint_path_project(p text)
returns uuid language sql immutable as $$
  select case
    when split_part(p, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p, '/', 1)::uuid
    else null
  end
$$;
grant execute on function public.blueprint_path_project(text) to authenticated;

drop policy if exists "blueprint-assets read" on storage.objects;
create policy "blueprint-assets read" on storage.objects
  for select to authenticated
  using (bucket_id = 'blueprint-assets'
         and public.can_read_blueprint(public.blueprint_path_project(name)));

drop policy if exists "blueprint-assets insert" on storage.objects;
create policy "blueprint-assets insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'blueprint-assets'
              and public.can_edit_blueprint(public.blueprint_path_project(name)));

drop policy if exists "blueprint-assets update" on storage.objects;
create policy "blueprint-assets update" on storage.objects
  for update to authenticated
  using (bucket_id = 'blueprint-assets'
         and public.can_edit_blueprint(public.blueprint_path_project(name)))
  with check (bucket_id = 'blueprint-assets'
         and public.can_edit_blueprint(public.blueprint_path_project(name)));

drop policy if exists "blueprint-assets delete" on storage.objects;
create policy "blueprint-assets delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'blueprint-assets'
         and public.can_edit_blueprint(public.blueprint_path_project(name)));
