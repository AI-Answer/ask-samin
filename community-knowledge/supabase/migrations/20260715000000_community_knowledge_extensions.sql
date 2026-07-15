-- Additive extensions — keeps 20260714000000_community_knowledge.sql intact.
-- Closes: Skool identity, media pipeline, drift/revisions, knowledge packs (phase 4 ready).

-- ---------------------------------------------------------------------------
-- A) Stronger Skool identity on sources
-- ---------------------------------------------------------------------------
alter table community_knowledge.sources
  add column if not exists group_id text,
  add column if not exists group_slug text,
  add column if not exists external_id text,
  add column if not exists course_id text,
  add column if not exists last_seen_at timestamptz,
  add column if not exists removed_at timestamptz,
  add column if not exists raw_snapshot_id uuid references community_knowledge.raw_snapshots(id) on delete set null;

create unique index if not exists sources_group_external_uidx
  on community_knowledge.sources (group_slug, external_id)
  where external_id is not null and group_slug is not null;

create index if not exists sources_last_seen_idx
  on community_knowledge.sources (group_slug, last_seen_at desc nulls last);

comment on column community_knowledge.sources.external_id is
  'Stable Skool lesson/post id — prefer over title for keys.';
comment on column community_knowledge.sources.removed_at is
  'Set when a lesson disappears from crawl; row kept for drift history.';

-- ---------------------------------------------------------------------------
-- raw_snapshots ↔ sources linkage
-- ---------------------------------------------------------------------------
alter table community_knowledge.raw_snapshots
  add column if not exists source_id text references community_knowledge.sources(id) on delete set null,
  add column if not exists provider text,
  add column if not exists fetch_method text,
  add column if not exists content_type text check (
    content_type is null or content_type in ('html', 'json', 'api', 'transcript', 'markdown')
  );

create index if not exists raw_snapshots_source_fetched_idx
  on community_knowledge.raw_snapshots (source_id, fetched_at desc);

-- ---------------------------------------------------------------------------
-- curriculum_nodes — Skool tree (group → course → folder → module → lesson)
-- ---------------------------------------------------------------------------
alter table community_knowledge.curriculum_nodes
  add column if not exists group_slug text,
  add column if not exists course_id text,
  add column if not exists external_id text;

alter table community_knowledge.curriculum_nodes
  drop constraint if exists curriculum_nodes_node_type_check;

alter table community_knowledge.curriculum_nodes
  add constraint curriculum_nodes_node_type_check
  check (node_type in ('group', 'course', 'folder', 'module', 'lesson'));

create index if not exists curriculum_nodes_group_course_idx
  on community_knowledge.curriculum_nodes (group_slug, course_id, node_order);

-- ---------------------------------------------------------------------------
-- chunks — explicit embedding model (384-d gte-small today; full re-embed on change)
-- ---------------------------------------------------------------------------
alter table community_knowledge.chunks
  add column if not exists embedding_model text not null default 'gte-small-384';

comment on column community_knowledge.chunks.embedding_model is
  'Fixed at ingest time. Changing models requires a full re-embed of this corpus.';

-- ---------------------------------------------------------------------------
-- B) media_assets — first-class video/media pipeline
-- ---------------------------------------------------------------------------
create table if not exists community_knowledge.media_assets (
  id text primary key,
  source_id text not null references community_knowledge.sources(id) on delete cascade,
  provider text not null check (provider in (
    'wistia', 'loom', 'youtube', 'skool_native', 'local_ref', 'unknown', 'none'
  )),
  external_id text,
  url text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  fingerprint text,
  extractability text not null default 'pending' check (extractability in (
    'extractable', 'blocked', 'pending', 'unknown'
  )),
  download_status text not null default 'pending' check (download_status in (
    'pending', 'ready', 'failed', 'skipped'
  )),
  transcript_status text not null default 'none' check (transcript_status in (
    'none', 'processing', 'indexed', 'failed', 'blocked'
  )),
  raw_transcript text,
  blocked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists media_assets_source_provider_uidx
  on community_knowledge.media_assets (
    source_id,
    provider,
    coalesce(external_id, ''),
    coalesce(url, '')
  );

create index if not exists media_assets_source_idx
  on community_knowledge.media_assets (source_id, provider);
create index if not exists media_assets_extractability_idx
  on community_knowledge.media_assets (extractability, transcript_status);

drop trigger if exists media_assets_set_updated_at on community_knowledge.media_assets;
create trigger media_assets_set_updated_at
before update on community_knowledge.media_assets
for each row execute function community_knowledge.set_updated_at();

-- ---------------------------------------------------------------------------
-- C) source_revisions — drift history (immutable prior versions)
-- ---------------------------------------------------------------------------
create table if not exists community_knowledge.source_revisions (
  id uuid primary key default extensions.gen_random_uuid(),
  source_id text not null references community_knowledge.sources(id) on delete cascade,
  content_hash text not null,
  raw_snapshot_id uuid references community_knowledge.raw_snapshots(id) on delete set null,
  title text not null,
  curriculum_path text[] not null default '{}',
  body_markdown text not null default '',
  when_to_use text,
  revision_at timestamptz not null default now()
);

create index if not exists source_revisions_source_time_idx
  on community_knowledge.source_revisions (source_id, revision_at desc);

-- ---------------------------------------------------------------------------
-- D) knowledge_packs — derived actionable layer (phase 4; schema ready now)
-- ---------------------------------------------------------------------------
create table if not exists community_knowledge.knowledge_packs (
  id text primary key,
  title text not null check (char_length(title) > 0),
  intent text,
  when_to_use text,
  body_markdown text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published', 'stale', 'archived')),
  built_from_source_ids text[] not null default '{}',
  built_from_hashes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_packs_status_idx
  on community_knowledge.knowledge_packs (status, updated_at desc);

drop trigger if exists knowledge_packs_set_updated_at on community_knowledge.knowledge_packs;
create trigger knowledge_packs_set_updated_at
before update on community_knowledge.knowledge_packs
for each row execute function community_knowledge.set_updated_at();

comment on table community_knowledge.knowledge_packs is
  'Derived playbooks — never mixed into sources/chunks. Packs go stale when upstream source hashes change.';

create or replace function community_knowledge.archive_source_revision()
returns trigger
language plpgsql
set search_path = community_knowledge
as $$
begin
  if tg_op = 'UPDATE' and old.content_hash is distinct from new.content_hash then
    insert into community_knowledge.source_revisions (
      source_id, content_hash, raw_snapshot_id, title, curriculum_path, body_markdown, when_to_use
    ) values (
      old.id, old.content_hash, old.raw_snapshot_id, old.title,
      old.curriculum_path, old.body_markdown, old.when_to_use
    );

    update community_knowledge.knowledge_packs
    set status = 'stale', updated_at = now()
    where status = 'published'
      and old.id = any(built_from_source_ids);
  end if;
  return new;
end;
$$;

drop trigger if exists sources_archive_revision on community_knowledge.sources;
create trigger sources_archive_revision
before update on community_knowledge.sources
for each row execute function community_knowledge.archive_source_revision();

-- ---------------------------------------------------------------------------
-- RLS for new tables
-- ---------------------------------------------------------------------------
alter table community_knowledge.media_assets enable row level security;
alter table community_knowledge.source_revisions enable row level security;
alter table community_knowledge.knowledge_packs enable row level security;

drop policy if exists "published source media is readable" on community_knowledge.media_assets;
create policy "published source media is readable"
on community_knowledge.media_assets for select
to anon, authenticated
using (
  exists (
    select 1 from community_knowledge.sources
    where sources.id = media_assets.source_id
      and sources.visibility = 'published'
      and sources.extraction_status = 'indexed'
  )
);

drop policy if exists "published knowledge packs are readable" on community_knowledge.knowledge_packs;
create policy "published knowledge packs are readable"
on community_knowledge.knowledge_packs for select
to anon, authenticated
using (status = 'published');

grant select on community_knowledge.media_assets, community_knowledge.knowledge_packs
  to anon, authenticated;
grant all on community_knowledge.media_assets,
  community_knowledge.source_revisions,
  community_knowledge.knowledge_packs
  to service_role;

-- Revisions are service-role only (audit trail, not member-facing retrieval yet).
revoke all on community_knowledge.source_revisions from anon, authenticated;

comment on table community_knowledge.source_revisions is
