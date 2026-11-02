-- LATHISH VAULT: transactional operations. Called ONLY by the server with the service role.
-- Every function takes p_owner and filters by it: service-role access bypasses RLS, so
-- authorization is explicit here AND in the API layer.

create function public.log_event(p_owner uuid, p_category text, p_action text, p_node uuid, p_detail jsonb)
returns void language sql as $$
  insert into public.activity_log(owner_id, category, action, node_id, detail)
  values (p_owner, p_category, p_action, p_node, coalesce(p_detail, '{}'::jsonb));
$$;

create function public.rate_limit_hit(p_key text, p_window_seconds int, p_max int)
returns boolean language plpgsql as $$
declare h int;
begin
  insert into public.rate_limits as r(key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end,
    hits         = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end
  returning hits into h;
  return h <= p_max;
end $$;

create function public.snapshot_usage(p_owner uuid) returns void language sql as $$
  insert into public.usage_snapshots(owner_id, day, used_bytes)
  select owner_id, current_date, used_bytes from public.vault_profile where owner_id = p_owner
  on conflict (owner_id, day) do update set used_bytes = excluded.used_bytes;
$$;

create function public.unique_name(p_owner uuid, p_parent uuid, p_name text, p_exclude uuid default null)
returns text language plpgsql as $$
declare base text; ext text := ''; cand text := p_name; i int := 0; dot int;
begin
  dot := length(p_name) - position('.' in reverse(p_name)) + 1;
  if position('.' in p_name) > 1 and position('.' in reverse(p_name)) > 0 and dot > 1 then
    base := left(p_name, dot - 1); ext := substr(p_name, dot);
  else base := p_name; end if;
  while exists (select 1 from public.nodes where owner_id = p_owner and status = 'active'
                  and parent_id is not distinct from p_parent and lower(name) = lower(cand)
                  and (p_exclude is null or id <> p_exclude)) loop
    i := i + 1;
    cand := left(base, 255 - length(ext) - length(i::text) - 3) || ' (' || i || ')' || ext;
  end loop;
  return cand;
end $$;

create function public.node_json(n public.nodes) returns jsonb language sql stable as $$
  select jsonb_build_object('id', n.id, 'parentId', n.parent_id, 'kind', n.kind, 'name', n.name,
    'size', n.size, 'mimeType', n.mime_type, 'status', n.status, 'favorite', n.favorite,
    'trashedAt', n.trashed_at, 'createdAt', n.created_at, 'updatedAt', n.updated_at);
$$;

create function public.node_path(p_owner uuid, p_id uuid) returns text language sql stable as $$
  with recursive up(id, parent_id, name, depth) as (
    select id, parent_id, name, 0 from public.nodes where id = p_id and owner_id = p_owner
    union all
    select n.id, n.parent_id, n.name, up.depth + 1 from public.nodes n join up on n.id = up.parent_id
    where n.owner_id = p_owner and up.depth < 64)
  select coalesce(string_agg(name, '/' order by depth desc), '') from up;
$$;

-- ---------- quota reservation (atomic) ----------
create function public.reserve_upload(p_owner uuid, p_parent uuid, p_name text, p_size bigint,
  p_content_type text, p_key text, p_multipart boolean, p_part_size bigint, p_part_count int, p_ttl_seconds int)
returns jsonb language plpgsql as $$
declare prof public.vault_profile; nm text; nid uuid; sid uuid; expiry timestamptz;
begin
  -- Row lock serialises ALL concurrent reservations/commits for this owner.
  select * into prof from public.vault_profile where owner_id = p_owner for update;
  if not found then raise exception 'not_found'; end if;
  if p_size <= 0 then raise exception 'invalid_size'; end if;
  if prof.used_bytes + prof.reserved_bytes + p_size > prof.quota_bytes then raise exception 'quota_exceeded'; end if;
  if p_parent is not null and not exists
     (select 1 from public.nodes where id = p_parent and owner_id = p_owner and kind = 'folder' and status = 'active')
  then raise exception 'invalid_parent'; end if;

  nm  := public.unique_name(p_owner, p_parent, p_name);
  expiry := now() + make_interval(secs => p_ttl_seconds);
  insert into public.nodes(owner_id, parent_id, kind, name, size, mime_type, object_key, status)
    values (p_owner, p_parent, 'file', nm, p_size, p_content_type, p_key, 'pending') returning id into nid;
  insert into public.upload_sessions(owner_id, node_id, object_key, size, content_type, multipart, part_size, part_count, expires_at)
    values (p_owner, nid, p_key, p_size, p_content_type, p_multipart, p_part_size, p_part_count, expiry) returning id into sid;
  update public.vault_profile set reserved_bytes = reserved_bytes + p_size where owner_id = p_owner;
  return jsonb_build_object('sessionId', sid, 'nodeId', nid, 'name', nm, 'objectKey', p_key, 'expiresAt', expiry);
end $$;

create function public.set_upload_id(p_owner uuid, p_session uuid, p_upload_id text) returns void language plpgsql as $$
begin
  update public.upload_sessions set b2_upload_id = p_upload_id
   where id = p_session and owner_id = p_owner and status = 'open' and multipart;
  if not found then raise exception 'session_invalid'; end if;
end $$;

create function public.get_upload_session(p_owner uuid, p_session uuid) returns jsonb language plpgsql stable as $$
declare s public.upload_sessions;
begin
  select * into s from public.upload_sessions where id = p_session and owner_id = p_owner;
  if not found then raise exception 'not_found'; end if;
  return jsonb_build_object('id', s.id, 'nodeId', s.node_id, 'objectKey', s.object_key, 'size', s.size,
    'contentType', s.content_type, 'multipart', s.multipart, 'uploadId', s.b2_upload_id,
    'partSize', s.part_size, 'partCount', s.part_count, 'status', s.status,
    'expired', s.expires_at <= now(), 'expiresAt', s.expires_at);
end $$;

-- Commit only after the server verified the stored object. Moves bytes reserved -> used.
create function public.commit_upload(p_owner uuid, p_session uuid, p_actual_size bigint) returns jsonb
language plpgsql as $$
declare prof public.vault_profile; s public.upload_sessions; n public.nodes; nm text;
begin
  select * into prof from public.vault_profile where owner_id = p_owner for update;
  select * into s from public.upload_sessions where id = p_session and owner_id = p_owner for update;
  if not found then raise exception 'not_found'; end if;
  if s.status <> 'open' or s.expires_at <= now() or s.node_id is null then raise exception 'session_invalid'; end if;
  if p_actual_size is distinct from s.size then raise exception 'size_mismatch'; end if;
  select * into n from public.nodes where id = s.node_id and owner_id = p_owner and status = 'pending' for update;
  if not found then raise exception 'session_invalid'; end if;
  nm := public.unique_name(p_owner, n.parent_id, n.name, n.id);   -- re-resolve in case a sibling appeared meanwhile
  update public.nodes set status = 'active', name = nm where id = n.id returning * into n;
  update public.vault_profile set reserved_bytes = reserved_bytes - s.size, used_bytes = used_bytes + s.size where owner_id = p_owner;
  update public.upload_sessions set status = 'committed', finished_at = now() where id = s.id;
  perform public.snapshot_usage(p_owner);
  perform public.log_event(p_owner, 'activity', 'file.uploaded', n.id, jsonb_build_object('name', n.name, 'size', n.size));
  return public.node_json(n);
end $$;

-- Release a reservation (failed/canceled/expired). Idempotent. Returns what the server must clean in B2.
create function public.abort_upload(p_owner uuid, p_session uuid, p_status text default 'aborted') returns jsonb
language plpgsql as $$
declare s public.upload_sessions;
begin
  perform 1 from public.vault_profile where owner_id = p_owner for update;
  select * into s from public.upload_sessions where id = p_session and owner_id = p_owner for update;
  if not found then raise exception 'not_found'; end if;
  if s.status = 'open' then
    update public.vault_profile set reserved_bytes = greatest(reserved_bytes - s.size, 0) where owner_id = p_owner;
    delete from public.nodes where id = s.node_id and status = 'pending';
    update public.upload_sessions set status = p_status, finished_at = now() where id = s.id;
    return jsonb_build_object('released', true, 'objectKey', s.object_key, 'uploadId', s.b2_upload_id, 'multipart', s.multipart);
  end if;
  return jsonb_build_object('released', false, 'objectKey', s.object_key, 'uploadId', s.b2_upload_id,
                            'multipart', s.multipart, 'status', s.status);
end $$;

-- Expire abandoned sessions (cron + lazy). Returns the B2 objects/multipart uploads to clean.
create function public.expire_sessions(p_limit int default 200) returns jsonb language plpgsql as $$
declare r record; acc jsonb := '[]'::jsonb; res jsonb;
begin
  for r in select id, owner_id from public.upload_sessions where status = 'open' and expires_at <= now()
           order by expires_at limit p_limit loop
    res := public.abort_upload(r.owner_id, r.id, 'expired');
    if (res->>'released')::boolean then acc := acc || jsonb_build_array(res); end if;
  end loop;
  return acc;
end $$;

-- ---------- explorer operations ----------
create function public.get_node(p_owner uuid, p_id uuid) returns jsonb language plpgsql stable as $$
declare n public.nodes;
begin
  select * into n from public.nodes where id = p_id and owner_id = p_owner and status <> 'pending';
  if not found then raise exception 'not_found'; end if;
  return public.node_json(n) || jsonb_build_object('objectKey', n.object_key, 'path', public.node_path(p_owner, n.id));
end $$;

create function public.breadcrumbs(p_owner uuid, p_id uuid) returns jsonb language sql stable as $$
  with recursive up(id, parent_id, name, depth) as (
    select id, parent_id, name, 0 from public.nodes where id = p_id and owner_id = p_owner
    union all
    select n.id, n.parent_id, n.name, up.depth + 1 from public.nodes n join up on n.id = up.parent_id
    where n.owner_id = p_owner and up.depth < 64)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by depth desc), '[]'::jsonb) from up;
$$;

create function public.create_folder(p_owner uuid, p_parent uuid, p_name text) returns jsonb language plpgsql as $$
declare n public.nodes;
begin
  if p_parent is not null and not exists
     (select 1 from public.nodes where id = p_parent and owner_id = p_owner and kind = 'folder' and status = 'active')
  then raise exception 'invalid_parent'; end if;
  if exists (select 1 from public.nodes where owner_id = p_owner and status = 'active'
             and parent_id is not distinct from p_parent and lower(name) = lower(p_name)) then raise exception 'name_conflict'; end if;
  insert into public.nodes(owner_id, parent_id, kind, name) values (p_owner, p_parent, 'folder', p_name) returning * into n;
  perform public.log_event(p_owner, 'activity', 'folder.created', n.id, jsonb_build_object('name', n.name));
  return public.node_json(n);
end $$;

create function public.rename_node(p_owner uuid, p_id uuid, p_name text) returns jsonb language plpgsql as $$
declare n public.nodes; old text;
begin
  select * into n from public.nodes where id = p_id and owner_id = p_owner and status = 'active' for update;
  if not found then raise exception 'not_found'; end if;
  if exists (select 1 from public.nodes where owner_id = p_owner and status = 'active' and id <> n.id
             and parent_id is not distinct from n.parent_id and lower(name) = lower(p_name)) then raise exception 'name_conflict'; end if;
  old := n.name;
  update public.nodes set name = p_name where id = n.id returning * into n;
  perform public.log_event(p_owner, 'activity', 'node.renamed', n.id, jsonb_build_object('from', old, 'to', p_name));
  return public.node_json(n);
end $$;

create function public.move_node(p_owner uuid, p_id uuid, p_parent uuid) returns jsonb language plpgsql as $$
declare n public.nodes;
begin
  select * into n from public.nodes where id = p_id and owner_id = p_owner and status = 'active' for update;
  if not found then raise exception 'not_found'; end if;
  if p_parent is not null and not exists
     (select 1 from public.nodes where id = p_parent and owner_id = p_owner and kind = 'folder' and status = 'active')
  then raise exception 'invalid_parent'; end if;
  if exists (select 1 from public.nodes where owner_id = p_owner and status = 'active' and id <> n.id
             and parent_id is not distinct from p_parent and lower(name) = lower(n.name)) then raise exception 'name_conflict'; end if;
  update public.nodes set parent_id = p_parent where id = n.id returning * into n;   -- trigger rejects cycles
  perform public.log_event(p_owner, 'activity', 'node.moved', n.id, jsonb_build_object('name', n.name));
  return public.node_json(n);
end $$;

create function public.set_favorite(p_owner uuid, p_id uuid, p_value boolean) returns jsonb language plpgsql as $$
declare n public.nodes;
begin
  update public.nodes set favorite = p_value where id = p_id and owner_id = p_owner and status = 'active' returning * into n;
  if not found then raise exception 'not_found'; end if;
  return public.node_json(n);
end $$;

-- ---------- trash ----------
create function public.trash_node(p_owner uuid, p_id uuid) returns jsonb language plpgsql as $$
declare n public.nodes;
begin
  select * into n from public.nodes where id = p_id and owner_id = p_owner and status = 'active' for update;
  if not found then raise exception 'not_found'; end if;
  with recursive sub(id) as (
    select id from public.nodes where parent_id = n.id and owner_id = p_owner and status = 'active'
    union all
    select c.id from public.nodes c join sub on c.parent_id = sub.id where c.owner_id = p_owner and c.status = 'active')
  update public.nodes set status = 'trashed', trashed_at = now() where id in (select id from sub);
  update public.nodes set status = 'trashed', trashed_at = now(), trash_root = true,
         original_parent_id = n.parent_id, favorite = false where id = n.id returning * into n;
  perform public.log_event(p_owner, 'activity', 'node.trashed', n.id, jsonb_build_object('name', n.name));
  return public.node_json(n);
end $$;

create function public.restore_node(p_owner uuid, p_id uuid) returns jsonb language plpgsql as $$
declare n public.nodes; target uuid; nm text;
begin
  select * into n from public.nodes where id = p_id and owner_id = p_owner and status = 'trashed' and trash_root for update;
  if not found then raise exception 'not_found'; end if;
  -- Original location if it still exists and is active; otherwise the vault root.
  select id into target from public.nodes
   where id = n.original_parent_id and owner_id = p_owner and kind = 'folder' and status = 'active';
  nm := public.unique_name(p_owner, target, n.name, n.id);
  with recursive sub(id) as (
    select id from public.nodes where parent_id = n.id and owner_id = p_owner and status = 'trashed' and not trash_root
    union all
    select c.id from public.nodes c join sub on c.parent_id = sub.id
     where c.owner_id = p_owner and c.status = 'trashed' and not c.trash_root)
  update public.nodes set status = 'active', trashed_at = null where id in (select id from sub);
  update public.nodes set status = 'active', trashed_at = null, trash_root = false, original_parent_id = null,
         parent_id = target, name = nm where id = n.id returning * into n;
  perform public.log_event(p_owner, 'activity', 'node.restored', n.id, jsonb_build_object('name', n.name));
  return public.node_json(n);
end $$;

create function public.purge_subtree_ids(p_owner uuid, p_root uuid) returns table(id uuid) language sql stable as $$
  with recursive sub(id) as (
    select p_root
    union all
    select c.id from public.nodes c join sub on c.parent_id = sub.id
     where c.owner_id = p_owner and not c.trash_root)   -- items trashed separately are not part of this purge
  select id from sub;
$$;

create function public.trash_roots(p_owner uuid, p_limit int default 25) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(id), '[]'::jsonb) from
    (select id from public.nodes where owner_id = p_owner and status = 'trashed' and trash_root order by trashed_at limit p_limit) t;
$$;

-- Step 1: which B2 objects must be deleted for these trashed roots.
create function public.purge_targets(p_owner uuid, p_ids uuid[]) returns jsonb language plpgsql stable as $$
declare bad int; result jsonb;
begin
  select count(*) into bad from unnest(p_ids) as t(i)
   where not exists (select 1 from public.nodes where id = t.i and owner_id = p_owner and status = 'trashed' and trash_root);
  if bad > 0 then raise exception 'not_found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'objectKey', n.object_key, 'size', n.size)), '[]'::jsonb) into result
    from public.nodes n
   where n.owner_id = p_owner and n.kind = 'file'
     and n.id in (select s.id from unnest(p_ids) as t(rid), lateral public.purge_subtree_ids(p_owner, t.rid) s);
  return result;
end $$;

-- Step 2 (after objects are deleted): remove metadata and release quota.
create function public.purge_commit(p_owner uuid, p_ids uuid[]) returns jsonb language plpgsql as $$
declare ids uuid[]; freed bigint; cnt int;
begin
  perform 1 from public.vault_profile where owner_id = p_owner for update;
  select array_agg(distinct s.id) into ids from unnest(p_ids) as t(rid), lateral public.purge_subtree_ids(p_owner, t.rid) s
   where exists (select 1 from public.nodes where id = t.rid and owner_id = p_owner and status = 'trashed' and trash_root);
  if ids is null then return jsonb_build_object('purged', 0, 'freed', 0); end if;
  -- Separately-trashed items whose parent is being purged are moved to the root (restore target stays valid).
  update public.nodes set parent_id = null where owner_id = p_owner and trash_root and parent_id = any(ids) and not (id = any(ids));
  select coalesce(sum(size) filter (where kind = 'file'), 0), count(*) into freed, cnt
    from public.nodes where id = any(ids) and owner_id = p_owner and status = 'trashed';
  delete from public.nodes where id = any(ids) and owner_id = p_owner and status = 'trashed';
  update public.vault_profile set used_bytes = greatest(used_bytes - freed, 0) where owner_id = p_owner;
  perform public.snapshot_usage(p_owner);
  perform public.log_event(p_owner, 'activity', 'node.purged', null, jsonb_build_object('items', cnt, 'bytes', freed));
  return jsonb_build_object('purged', cnt, 'freed', freed);
end $$;

-- Self-heal: recompute counters from committed rows if they ever drift.
create function public.recompute_usage(p_owner uuid) returns jsonb language plpgsql as $$
declare u bigint; r bigint;
begin
  perform 1 from public.vault_profile where owner_id = p_owner for update;
  select coalesce(sum(size), 0) into u from public.nodes where owner_id = p_owner and kind = 'file' and status in ('active', 'trashed');
  select coalesce(sum(size), 0) into r from public.upload_sessions where owner_id = p_owner and status = 'open';
  update public.vault_profile set used_bytes = u, reserved_bytes = r where owner_id = p_owner;
  return jsonb_build_object('used', u, 'reserved', r);
end $$;

-- ---------- listing / search / summary ----------
create function public.list_nodes(p_owner uuid, p_view text, p_parent uuid, p_q text, p_sort text,
  p_dir text, p_folders_only boolean, p_limit int, p_offset int) returns jsonb language plpgsql stable as $$
declare pat text; items jsonb; total bigint;
begin
  pat := '%' || replace(replace(replace(coalesce(p_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  with base as (
    select n.id from public.nodes n
     where n.owner_id = p_owner
       and case p_view
             when 'trash'     then n.status = 'trashed' and n.trash_root
             when 'recent'    then n.status = 'active' and n.kind = 'file'
             when 'favorites' then n.status = 'active' and n.favorite
             when 'search'    then n.status = 'active' and lower(n.name) like lower(pat) escape '\'
             else n.status = 'active' and n.parent_id is not distinct from p_parent
           end
       and (not p_folders_only or n.kind = 'folder')),
  counted as (select count(*) as c from base),
  ranked as (
    select n.id, row_number() over (order by
       case when p_view = 'recent' then 0 else (n.kind <> 'folder')::int end,
       case when p_view = 'recent' then n.updated_at end desc,
       case when p_view = 'trash' then n.trashed_at end desc,
       case when p_sort = 'name' and p_dir = 'asc'  then lower(n.name) end asc,
       case when p_sort = 'name' and p_dir = 'desc' then lower(n.name) end desc,
       case when p_sort = 'type' and p_dir = 'asc'  then lower(coalesce(substring(n.name from '\.([^.]*)$'), '')) end asc,
       case when p_sort = 'type' and p_dir = 'desc' then lower(coalesce(substring(n.name from '\.([^.]*)$'), '')) end desc,
       case when p_sort = 'size' and p_dir = 'asc'  then n.size end asc,
       case when p_sort = 'size' and p_dir = 'desc' then n.size end desc,
       case when p_sort = 'modified' and p_dir = 'asc'  then n.updated_at end asc,
       case when p_sort = 'modified' and p_dir = 'desc' then n.updated_at end desc,
       lower(n.name)) as rn
    from public.nodes n where n.id in (select id from base))
  select coalesce(jsonb_agg(public.node_json(n) ||
           case when p_view <> 'folder' then jsonb_build_object('path', public.node_path(p_owner, n.id)) else '{}'::jsonb end
           order by r.rn), '[]'::jsonb),
         (select c from counted)
    into items, total
    from ranked r join public.nodes n on n.id = r.id
   where r.rn > p_offset and r.rn <= p_offset + p_limit;
  return jsonb_build_object('items', items, 'total', coalesce(total, 0));
end $$;

create function public.storage_summary(p_owner uuid) returns jsonb language plpgsql stable as $$
declare prof public.vault_profile; result jsonb;
begin
  select * into prof from public.vault_profile where owner_id = p_owner;
  if not found then raise exception 'not_found'; end if;
  select jsonb_build_object(
    'displayName', prof.display_name, 'quotaBytes', prof.quota_bytes, 'usedBytes', prof.used_bytes,
    'reservedBytes', prof.reserved_bytes, 'availableBytes', prof.quota_bytes - prof.used_bytes - prof.reserved_bytes,
    'fileCount',   (select count(*) from public.nodes where owner_id = p_owner and kind = 'file'   and status = 'active'),
    'folderCount', (select count(*) from public.nodes where owner_id = p_owner and kind = 'folder' and status = 'active'),
    'trashCount',  (select count(*) from public.nodes where owner_id = p_owner and status = 'trashed'),
    'trashBytes',  (select coalesce(sum(size), 0) from public.nodes where owner_id = p_owner and status = 'trashed'),
    'byType', (select coalesce(jsonb_agg(jsonb_build_object('type', t, 'count', c, 'bytes', b)), '[]'::jsonb) from (
        select case
          when mime_type like 'image/%' then 'images' when mime_type = 'application/pdf' then 'documents'
          when mime_type like 'text/%' then 'documents' when mime_type like 'video/%' then 'video'
          when mime_type like 'audio/%' then 'audio' when mime_type like 'application/zip%' then 'archives'
          else 'other' end t, count(*) c, coalesce(sum(size), 0) b
        from public.nodes where owner_id = p_owner and kind = 'file' and status in ('active', 'trashed') group by 1) x),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'usedBytes', used_bytes) order by day), '[]'::jsonb)
                from (select * from public.usage_snapshots where owner_id = p_owner order by day desc limit 60) s),
    'uploadsByDay', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'count', c) order by d), '[]'::jsonb) from (
        select created_at::date d, count(*) c from public.activity_log
         where owner_id = p_owner and action = 'file.uploaded' and created_at > now() - interval '14 days' group by 1) u),
    'recentActivity', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'action', action, 'detail', detail, 'at', created_at)
                       order by created_at desc), '[]'::jsonb) from (
        select * from public.activity_log where owner_id = p_owner and category = 'activity' order by created_at desc limit 20) a)
  ) into result;
  return result;
end $$;

create function public.list_events(p_owner uuid, p_category text, p_limit int default 50) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'action', action, 'detail', detail, 'at', created_at)
         order by created_at desc), '[]'::jsonb)
  from (select * from public.activity_log where owner_id = p_owner and category = p_category
        order by created_at desc limit least(p_limit, 200)) e;
$$;

create function public.set_display_name(p_owner uuid, p_name text) returns void language sql as $$
  update public.vault_profile set display_name = p_name where owner_id = p_owner;
$$;
