-- LATHISH VAULT: schema. All tables are RLS-protected (see 0003_rls.sql).
create extension if not exists pg_trgm with schema extensions;

create type public.node_kind   as enum ('file', 'folder');
create type public.node_status as enum ('pending', 'active', 'trashed');

-- One row only (single-owner vault). Holds the authoritative quota counters.
create table public.vault_profile (
  owner_id       uuid primary key references auth.users(id) on delete restrict,
  display_name   text   not null default 'Owner' check (char_length(display_name) between 1 and 60),
  quota_bytes    bigint not null default 1000000000 check (quota_bytes > 0),
  used_bytes     bigint not null default 0 check (used_bytes >= 0),      -- active + trashed committed files
  reserved_bytes bigint not null default 0 check (reserved_bytes >= 0),  -- open upload sessions
  created_at     timestamptz not null default now(),
  constraint within_quota check (used_bytes + reserved_bytes <= quota_bytes)
);
create unique index vault_profile_single_row on public.vault_profile ((true));

create table public.nodes (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references public.vault_profile(owner_id) on delete cascade,
  parent_id          uuid references public.nodes(id),            -- NO ACTION: whole-subtree deletes are one statement
  kind               public.node_kind   not null,
  name               text not null
                       check (char_length(name) between 1 and 255
                              and name !~ '[/\\\x01-\x1f]' and name not in ('.', '..')),
  size               bigint not null default 0 check (size >= 0),
  mime_type          text,
  object_key         text unique,                                  -- server-generated; never derived from name
  status             public.node_status not null default 'active',
  favorite           boolean not null default false,
  trashed_at         timestamptz,
  trash_root         boolean not null default false,               -- the item the user actually deleted
  original_parent_id uuid,                                         -- remembered for restore
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((kind = 'file') = (object_key is not null)),
  check (kind = 'file' or size = 0),
  check ((status = 'trashed') = (trashed_at is not null)),
  check (parent_id is null or parent_id <> id)
);
-- Case-insensitive unique names among ACTIVE siblings.
create unique index nodes_unique_active_name on public.nodes
  (owner_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where status = 'active';
create index nodes_parent_idx   on public.nodes (owner_id, parent_id, status);
create index nodes_status_idx   on public.nodes (owner_id, status, updated_at desc);
create index nodes_fav_idx      on public.nodes (owner_id) where favorite and status = 'active';
create index nodes_name_trgm    on public.nodes using gin (lower(name) extensions.gin_trgm_ops);

-- Parent must be a folder; moves must not create cycles.
create function public.nodes_guard() returns trigger language plpgsql as $$
declare pk public.node_kind; cyc boolean;
begin
  if new.parent_id is not null then
    select kind into pk from public.nodes where id = new.parent_id and owner_id = new.owner_id;
    if pk is distinct from 'folder' then raise exception 'invalid_parent'; end if;
    if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id then
      with recursive up(id, parent_id) as (
        select id, parent_id from public.nodes where id = new.parent_id
        union all
        select n.id, n.parent_id from public.nodes n join up on n.id = up.parent_id)
      select exists (select 1 from up where id = new.id) into cyc;
      if cyc then raise exception 'invalid_parent'; end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger nodes_guard_trg before insert or update on public.nodes
  for each row execute function public.nodes_guard();

create table public.upload_sessions (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.vault_profile(owner_id) on delete cascade,
  node_id       uuid unique references public.nodes(id) on delete set null,
  object_key    text not null unique,
  size          bigint not null check (size > 0),
  content_type  text not null,
  multipart     boolean not null default false,
  b2_upload_id  text,
  part_size     bigint check (part_size is null or part_size > 0),
  part_count    int check (part_count is null or part_count between 1 and 10000),
  status        text not null default 'open' check (status in ('open','committed','aborted','expired')),
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index upload_sessions_open_idx on public.upload_sessions (expires_at) where status = 'open';

-- Combined activity feed + security audit log. Never store secrets, tokens or signed URLs here.
create table public.activity_log (
  id         bigint generated always as identity primary key,
  owner_id   uuid references public.vault_profile(owner_id) on delete cascade,
  category   text not null default 'activity' check (category in ('activity', 'security')),
  action     text not null,
  node_id    uuid,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_log_idx on public.activity_log (owner_id, category, created_at desc);

create table public.usage_snapshots (
  owner_id   uuid not null references public.vault_profile(owner_id) on delete cascade,
  day        date not null,
  used_bytes bigint not null,
  primary key (owner_id, day)
);

create table public.rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  hits         int not null default 0
);
