-- Deny by default. The browser never talks to Supabase directly in this design; RLS is defence in depth
-- in case the anon/authenticated keys are ever used against PostgREST. All writes go through the
-- server (service role) via the functions in 0002.
alter table public.vault_profile   enable row level security;
alter table public.nodes           enable row level security;
alter table public.upload_sessions enable row level security;
alter table public.activity_log    enable row level security;
alter table public.usage_snapshots enable row level security;
alter table public.rate_limits     enable row level security;

alter table public.vault_profile   force row level security;
alter table public.nodes           force row level security;
alter table public.upload_sessions force row level security;
alter table public.activity_log    force row level security;
alter table public.usage_snapshots force row level security;
alter table public.rate_limits     force row level security;

-- Owner may READ their own rows. No insert/update/delete policies exist => those are denied.
create policy owner_read on public.vault_profile   for select to authenticated using (owner_id = auth.uid());
create policy owner_read on public.nodes           for select to authenticated using (owner_id = auth.uid());
create policy owner_read on public.upload_sessions for select to authenticated using (owner_id = auth.uid());
create policy owner_read on public.activity_log    for select to authenticated using (owner_id = auth.uid());
create policy owner_read on public.usage_snapshots for select to authenticated using (owner_id = auth.uid());
-- rate_limits: no policy at all => inaccessible to anon/authenticated.

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on public.vault_profile, public.nodes, public.upload_sessions, public.activity_log, public.usage_snapshots to authenticated;
grant all on all tables    in schema public to service_role;
grant execute on all functions in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
-- upload_sessions.b2_upload_id is a server-side secret-ish value: hide it from the authenticated role.
revoke select on public.upload_sessions from authenticated;
grant select (id, owner_id, node_id, size, content_type, multipart, status, expires_at, created_at, finished_at)
  on public.upload_sessions to authenticated;

alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;
