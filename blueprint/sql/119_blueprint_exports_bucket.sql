-- ============================================================================
-- 119_blueprint_exports_bucket.sql
-- Where finished blueprint PDFs live.
--
-- Separate from blueprint-assets on purpose: exports are large, disposable and
-- regenerated often, so keeping them apart makes them easy to prune later
-- without touching the images a blueprint actually depends on.
--
-- Safe to run more than once. Requires 118 (which defines can_read_blueprint,
-- can_edit_blueprint and blueprint_path_project).
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('blueprint-exports', 'blueprint-exports', false)
on conflict (id) do update set public = false;

-- Paths are "<project_id>/<snapshot_id>.pdf", so the same leading-folder rule
-- as blueprint-assets decides who may see one.
drop policy if exists "blueprint-exports read" on storage.objects;
create policy "blueprint-exports read" on storage.objects
  for select to authenticated
  using (bucket_id = 'blueprint-exports'
         and public.can_read_blueprint(public.blueprint_path_project(name)));

drop policy if exists "blueprint-exports insert" on storage.objects;
create policy "blueprint-exports insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'blueprint-exports'
              and public.can_edit_blueprint(public.blueprint_path_project(name)));

drop policy if exists "blueprint-exports update" on storage.objects;
create policy "blueprint-exports update" on storage.objects
  for update to authenticated
  using (bucket_id = 'blueprint-exports'
         and public.can_edit_blueprint(public.blueprint_path_project(name)))
  with check (bucket_id = 'blueprint-exports'
         and public.can_edit_blueprint(public.blueprint_path_project(name)));

drop policy if exists "blueprint-exports delete" on storage.objects;
create policy "blueprint-exports delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'blueprint-exports'
         and public.can_edit_blueprint(public.blueprint_path_project(name)));

-- Handy: the newest export for each blueprint, for a "download the last PDF"
-- button that does not need to re-render anything.
create or replace view public.blueprint_latest_export as
  select distinct on (project_id)
         project_id, id as snapshot_id, label, pdf_path, created_at
    from public.blueprint_snapshots
   where pdf_path is not null
   order by project_id, created_at desc;

grant select on public.blueprint_latest_export to authenticated;
