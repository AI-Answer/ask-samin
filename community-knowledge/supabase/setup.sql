-- =============================================================================
-- COMMUNITY KNOWLEDGE — full schema setup for Supabase SQL Editor
-- =============================================================================
--
-- pgvector: auto-detects where <=> operator lives (often `extensions`, even when
-- the extension catalog shows `bookedindev`). Tables go in `community_knowledge`.
--
-- If a previous run failed partway, uncomment this line first, then re-run:
-- drop schema if exists community_knowledge cascade;
--
-- Paste this ENTIRE file into SQL Editor → Run
--
-- AFTER success:
--   1. Settings → API → Exposed schemas → add: community_knowledge
--   2. Fill community-knowledge/.env.local
--   3. npm run seed && npm run embed:backfill
-- =============================================================================

-- PART 1: base schema
-- -----------------------------------------------------------------------------
-- Community knowledge RAG — isolated schema for shared Supabase Postgres (e.g. Bookedin).
-- After running: add "community_knowledge" to Supabase Dashboard → Project Settings → API → Exposed schemas.

-- pgvector is database-wide (one install). On Bookedin Supabase the extension
-- catalog may say `bookedindev`, but <=> / vector_cosine_ops can live in
-- `extensions`. We detect the schema that actually has operators and use it
-- for column types AND function search_path.

create extension if not exists pgcrypto with schema extensions;

do $$
declare
  ext_schema text;
  vector_ops_schema text;
begin
  select n.nspname
  into ext_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'vector';

  if ext_schema is null then
    raise exception 'pgvector not found. Enable it in Dashboard → Database → Extensions → vector.';
  end if;

  -- Prefer schema where pgvector cosine operator is registered (not just ext catalog).
  select ns.nspname
  into vector_ops_schema
  from pg_operator o
  join pg_namespace ns on ns.oid = o.oprnamespace
  join pg_type t1 on t1.oid = o.oprleft
  join pg_type t2 on t2.oid = o.oprright
  where o.oprname = '<=>'
    and t1.typname = 'vector'
    and t2.typname = 'vector'
  order by
    case ns.nspname when ext_schema then 0 when 'extensions' then 1 else 2 end
  limit 1;

  if vector_ops_schema is null then
    vector_ops_schema := ext_schema;
    raise warning 'pgvector <=> operator not found; falling back to extension schema %', ext_schema;
  end if;

  perform set_config(
    'search_path',
    format('community_knowledge, %I, extensions, public', vector_ops_schema),
    false
  );
  perform set_config('community_knowledge.vector_ops_schema', vector_ops_schema, false);

  raise notice 'pgvector extension: %, ops/type schema: %', ext_schema, vector_ops_schema;
end $$;

create schema if not exists community_knowledge;

create table if not exists community_knowledge.raw_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  source_url text not null,
  fetched_at timestamptz not null default now(),
  raw_hash text not null,
  raw_content text not null,
  status text not null default 'fetched'
    check (status in ('fetched', 'normalized', 'skipped', 'failed'))
);

create index if not exists raw_snapshots_url_hash_idx
  on community_knowledge.raw_snapshots (source_url, raw_hash, fetched_at desc);

create table if not exists community_knowledge.sources (
  id text primary key,
  source_type text not null check (source_type in (
    'lesson_page', 'community_post', 'call_recording', 'video',
    'curator_note', 'resource_link'
  )),
  title text not null check (char_length(title) > 0),
  canonical_url text not null check (char_length(canonical_url) > 0),
  curriculum_path text[] not null default '{}',
  body_markdown text not null default '',
  video_ids text[] not null default '{}',
  author text,
  posted_at timestamptz,
  content_hash text not null,
  visibility text not null default 'private'
    check (visibility in ('private', 'published')),
  extraction_status text not null default 'indexed'
    check (extraction_status in ('indexed', 'blocked', 'processing', 'failed')),
  blocked_reason text,
  when_to_use text,
  extracted_at timestamptz not null default now(),
  extraction_model_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists community_knowledge.curriculum_nodes (
  id text primary key,
  parent_id text references community_knowledge.curriculum_nodes(id) on delete cascade,
  title text not null check (char_length(title) > 0),
  slug text not null,
  node_order integer not null default 0,
  node_type text not null check (node_type in ('module', 'lesson')),
  source_id text references community_knowledge.sources(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (parent_id, slug)
);

create index if not exists curriculum_nodes_parent_order_idx
  on community_knowledge.curriculum_nodes (parent_id, node_order, id);

create table if not exists community_knowledge.chunks (
  id text primary key,
  source_id text not null references community_knowledge.sources(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null check (char_length(content) > 0),
  embedding vector(384),
  metadata jsonb not null default '{}'::jsonb,
  when_to_use text,
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(when_to_use, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) stored,
  created_at timestamptz not null default now(),
  unique (source_id, chunk_index)
);

create index if not exists chunks_search_vector_idx
  on community_knowledge.chunks using gin (search_vector);
create index if not exists chunks_embedding_hnsw_idx
  on community_knowledge.chunks using hnsw (embedding vector_cosine_ops)
  where embedding is not null;
create index if not exists chunks_source_idx
  on community_knowledge.chunks (source_id, chunk_index);

create table if not exists community_knowledge.ingestion_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  last_progress_at timestamptz not null default now(),
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed', 'stale')),
  phase text not null default 'crawling'
    check (phase in ('crawling', 'extracting', 'embedding', 'saving')),
  progress_pct numeric(5,2) not null default 0 check (progress_pct >= 0 and progress_pct <= 100),
  error text,
  stats jsonb not null default '{}'::jsonb
);

create index if not exists ingestion_runs_status_idx
  on community_knowledge.ingestion_runs (status, started_at desc);

create table if not exists community_knowledge.query_usage_logs (
  id uuid primary key default extensions.gen_random_uuid(),
  tool_name text not null,
  query_text text,
  client_ip_hash text not null,
  result_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists query_usage_logs_created_idx
  on community_knowledge.query_usage_logs (created_at desc);

create or replace function community_knowledge.set_updated_at()
returns trigger
language plpgsql
set search_path = community_knowledge
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sources_set_updated_at on community_knowledge.sources;
create trigger sources_set_updated_at
before update on community_knowledge.sources
for each row execute function community_knowledge.set_updated_at();

-- Created dynamically so search_path includes the schema where <=> actually lives.
do $$
declare
  vs text;
begin
  vs := current_setting('community_knowledge.vector_ops_schema', true);
  if vs is null then
    raise exception 'community_knowledge.vector_ops_schema not set — run bootstrap block first';
  end if;

  execute format($fn$
create or replace function community_knowledge.search_chunks_rrf_impl(
  query_text text,
  query_embedding vector(384) default null,
  match_count integer default 8,
  rrf_k integer default 60,
  filter_source_type text default null,
  filter_curriculum_path text default null
)
returns table (
  id text,
  source_id text,
  source_type text,
  source_title text,
  canonical_url text,
  curriculum_path text[],
  content text,
  when_to_use text,
  metadata jsonb,
  score double precision
)
language sql
stable
security invoker
set search_path = community_knowledge, %I, extensions, public
as $body$
  with bounded as (
    select least(50, greatest(1, match_count)) as wanted,
           greatest(1, rrf_k) as k,
           websearch_to_tsquery('english', coalesce(query_text, '')) as text_query
  ),
  eligible_sources as (
    select s.*
    from community_knowledge.sources s
    where s.visibility = 'published'
      and s.extraction_status = 'indexed'
      and (filter_source_type is null or s.source_type = filter_source_type)
      and (
        filter_curriculum_path is null
        or filter_curriculum_path = any(s.curriculum_path)
      )
  ),
  full_text as (
    select c.id,
           row_number() over (
             order by ts_rank_cd(c.search_vector, b.text_query) desc, c.id
           ) as rank
    from community_knowledge.chunks c
    join eligible_sources s on s.id = c.source_id
    cross join bounded b
    where b.text_query @@ c.search_vector
    order by ts_rank_cd(c.search_vector, b.text_query) desc, c.id
    limit least(200, greatest(4, match_count * 4))
  ),
  semantic as (
    select c.id,
           row_number() over (
             order by (c.embedding::%1$I.vector(384) <=> query_embedding::%1$I.vector(384)), c.id
           ) as rank
    from community_knowledge.chunks c
    join eligible_sources s on s.id = c.source_id
    where query_embedding is not null and c.embedding is not null
    order by (c.embedding::%1$I.vector(384) <=> query_embedding::%1$I.vector(384)), c.id
    limit least(200, greatest(4, match_count * 4))
  ),
  fused as (
    select ranked.id,
           sum(1.0 / (b.k + ranked.rank))::double precision as score
    from (
      select full_text.id, full_text.rank from full_text
      union all
      select semantic.id, semantic.rank from semantic
    ) ranked
    cross join bounded b
    group by ranked.id
  )
  select c.id,
         c.source_id,
         s.source_type,
         s.title as source_title,
         s.canonical_url,
         s.curriculum_path,
         c.content,
         coalesce(c.when_to_use, s.when_to_use) as when_to_use,
         c.metadata,
         fused.score
  from fused
  join community_knowledge.chunks c on c.id = fused.id
  join eligible_sources s on s.id = c.source_id
  cross join bounded b
  order by fused.score desc, c.id
  limit (select wanted from bounded);
$body$;
$fn$, vs, vs);

  execute format($fn$
create or replace function community_knowledge.search_chunks_rrf(
  query_text text,
  query_embedding vector(384) default null,
  match_count integer default 8,
  rrf_k integer default 60,
  filter_source_type text default null,
  filter_curriculum_path text default null
)
returns table (
  id text,
  source_id text,
  source_type text,
  source_title text,
  canonical_url text,
  curriculum_path text[],
  content text,
  when_to_use text,
  metadata jsonb,
  score double precision
)
language sql
stable
security invoker
set search_path = community_knowledge, %I, extensions, public
as $body$
  select * from community_knowledge.search_chunks_rrf_impl(
    query_text, query_embedding, match_count, rrf_k, filter_source_type, filter_curriculum_path
  );
$body$;
$fn$, vs);
end $$;

do $$
declare
  vs text;
begin
  vs := current_setting('community_knowledge.vector_ops_schema', true);

  execute format($fn$
create or replace function community_knowledge.replace_source_chunks(
  p_source_id text,
  p_chunks jsonb
)
returns integer
language plpgsql
security invoker
set search_path = community_knowledge, %I, extensions, public
as $body$
declare
  inserted_count integer;
begin
  delete from community_knowledge.chunks where source_id = p_source_id;

  insert into community_knowledge.chunks (
    id, source_id, chunk_index, content, embedding, metadata, when_to_use
  )
  select
    row.id,
    p_source_id,
    row.chunk_index,
    row.content,
    case
      when row.embedding is null then null
      else row.embedding::vector(384)
    end,
    coalesce(row.metadata, '{}'::jsonb),
    row.when_to_use
  from jsonb_to_recordset(coalesce(p_chunks, '[]'::jsonb)) as row(
    id text,
    chunk_index integer,
    content text,
    embedding text,
    metadata jsonb,
    when_to_use text
  );

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$body$;
$fn$, vs);
end $$;

-- Public wrappers so PostgREST can invoke RPC without extra schema config.
do $$
declare
  vs text;
begin
  vs := current_setting('community_knowledge.vector_ops_schema', true);

  execute format($fn$
create or replace function public.search_community_chunks_rrf(
  query_text text,
  query_embedding vector(384) default null,
  match_count integer default 8,
  rrf_k integer default 60,
  filter_source_type text default null,
  filter_curriculum_path text default null
)
returns table (
  id text,
  source_id text,
  source_type text,
  source_title text,
  canonical_url text,
  curriculum_path text[],
  content text,
  when_to_use text,
  metadata jsonb,
  score double precision
)
language sql
stable
security invoker
set search_path = community_knowledge, %I, extensions, public
as $body$
  select * from community_knowledge.search_chunks_rrf(
    query_text, query_embedding, match_count, rrf_k, filter_source_type, filter_curriculum_path
  );
$body$;
$fn$, vs);
end $$;

create or replace function public.replace_source_chunks(
  p_source_id text,
  p_chunks jsonb
)
returns integer
language sql
security invoker
set search_path = community_knowledge, public
as $$
  select community_knowledge.replace_source_chunks(p_source_id, p_chunks);
$$;

revoke all on function community_knowledge.replace_source_chunks(text, jsonb)
  from public, anon, authenticated;
grant execute on function community_knowledge.replace_source_chunks(text, jsonb) to service_role;

revoke all on function public.replace_source_chunks(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_source_chunks(text, jsonb) to service_role;

revoke all on function community_knowledge.search_chunks_rrf(
  text, vector, integer, integer, text, text
) from public, anon, authenticated;
grant execute on function community_knowledge.search_chunks_rrf(
  text, vector, integer, integer, text, text
) to anon, authenticated, service_role;

revoke all on function public.search_community_chunks_rrf(
  text, vector, integer, integer, text, text
) from public, anon, authenticated;
grant execute on function public.search_community_chunks_rrf(
  text, vector, integer, integer, text, text
) to anon, authenticated, service_role;

alter table community_knowledge.raw_snapshots enable row level security;
alter table community_knowledge.sources enable row level security;
alter table community_knowledge.chunks enable row level security;
alter table community_knowledge.curriculum_nodes enable row level security;
alter table community_knowledge.ingestion_runs enable row level security;
alter table community_knowledge.query_usage_logs enable row level security;

drop policy if exists "published sources are readable" on community_knowledge.sources;
create policy "published sources are readable"
on community_knowledge.sources for select
to anon, authenticated
using (visibility = 'published' and extraction_status = 'indexed');

drop policy if exists "published source chunks are readable" on community_knowledge.chunks;
create policy "published source chunks are readable"
on community_knowledge.chunks for select
to anon, authenticated
using (
  exists (
    select 1 from community_knowledge.sources
    where sources.id = chunks.source_id
      and sources.visibility = 'published'
      and sources.extraction_status = 'indexed'
  )
);

drop policy if exists "curriculum nodes are readable" on community_knowledge.curriculum_nodes;
create policy "curriculum nodes are readable"
on community_knowledge.curriculum_nodes for select
to anon, authenticated
using (true);

grant usage on schema community_knowledge to anon, authenticated, service_role;
grant select on community_knowledge.sources, community_knowledge.chunks, community_knowledge.curriculum_nodes
  to anon, authenticated;
grant all on all tables in schema community_knowledge to service_role;
grant usage, select on all sequences in schema community_knowledge to service_role;

comment on schema community_knowledge is
  'Isolated community knowledge RAG — safe alongside bookedinprod on shared Supabase Postgres.';
comment on function public.search_community_chunks_rrf is
  'Public wrapper: hybrid FTS + pgvector RRF over published community chunks.';
-- PART 2: extensions
-- -----------------------------------------------------------------------------
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
  'Immutable prior source versions — auto-populated when content_hash changes.';
comment on table community_knowledge.media_assets is
  'Per-source media with provider-specific extractability and transcript status.';

-- ---------------------------------------------------------------------------
-- Service-role write policies (ingestion via PostgREST)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'ingestion_runs', 'raw_snapshots', 'sources', 'chunks',
    'curriculum_nodes', 'media_assets', 'query_usage_logs',
    'source_revisions', 'knowledge_packs'
  ] LOOP
    EXECUTE format('drop policy if exists "service role full access" on community_knowledge.%I', tbl);
    EXECUTE format(
      'create policy "service role full access" on community_knowledge.%I for all to service_role using (true) with check (true)',
      tbl
    );
  END LOOP;
END $$;

-- Expose schema to PostgREST (also add in Dashboard → API → Exposed schemas):
-- ALTER ROLE authenticator SET pgrst.db_schemas TO 'public, storage, graphql_public, hubspoke, community_knowledge';
-- NOTIFY pgrst, 'reload config';
-- NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- VERIFY
-- =============================================================================
select e.extname, n.nspname as extension_schema
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
where e.extname = 'vector';

select ns.nspname as operator_schema, o.oprname
from pg_operator o
join pg_namespace ns on ns.oid = o.oprnamespace
join pg_type t1 on t1.oid = o.oprleft
where o.oprname = '<=>' and t1.typname = 'vector'
limit 1;

select table_schema, table_name
from information_schema.tables
where table_schema = 'community_knowledge'
order by table_name;

select current_setting('community_knowledge.vector_ops_schema', true) as vector_ops_schema_used;
