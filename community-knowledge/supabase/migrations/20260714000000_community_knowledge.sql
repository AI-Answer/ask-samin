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
