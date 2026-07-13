create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.sources (
  id text primary key,
  external_id text not null,
  kind text not null check (kind in ('video', 'short', 'community_call', 'document', 'web')),
  title text not null check (char_length(title) > 0),
  canonical_url text not null check (
    char_length(canonical_url) > 0
    and (not is_public or canonical_url ~* '^https?://')
  ),
  thumbnail_url text check (thumbnail_url is null or thumbnail_url ~* '^https?://'),
  description text,
  published_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  transcript_status text not null default 'processing'
    check (transcript_status in ('indexed', 'metadata_only', 'processing', 'failed')),
  segment_count integer not null default 0 check (segment_count >= 0),
  tags text[] not null default '{}',
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, external_id)
);

create table if not exists public.segments (
  id text primary key,
  source_id text not null references public.sources(id) on delete cascade,
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null check (end_ms >= start_ms),
  speaker text,
  raw_text text not null check (char_length(raw_text) > 0),
  normalized_text text not null check (char_length(normalized_text) > 0),
  provenance text not null
    check (provenance in ('transcript', 'creator_export', 'metadata', 'document')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chunks (
  id text primary key,
  source_id text not null references public.sources(id) on delete cascade,
  source_title text not null,
  source_kind text not null check (source_kind in ('video', 'short', 'community_call', 'document', 'web')),
  canonical_url text not null check (
    canonical_url ~* '^https?://' or canonical_url like 'urn:ask-samin:source:%'
  ),
  thumbnail_url text check (thumbnail_url is null or thumbnail_url ~* '^https?://'),
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null check (end_ms >= start_ms),
  text text not null check (char_length(text) > 0),
  provenance text not null
    check (provenance in ('transcript', 'creator_export', 'metadata', 'document')),
  embedding extensions.vector(384),
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(source_title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(text, '')), 'B')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prompts (
  id text primary key,
  name text not null,
  purpose text not null,
  version text not null,
  updated_at date not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  kind text not null,
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  input_count integer not null default 0 check (input_count >= 0),
  evidence jsonb not null default '{}'::jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists sources_public_kind_idx
  on public.sources (is_public, kind, published_at desc);
create index if not exists segments_source_time_idx
  on public.segments (source_id, start_ms, id);
create index if not exists chunks_source_time_idx
  on public.chunks (source_id, start_ms, id);
create index if not exists chunks_search_vector_idx
  on public.chunks using gin (search_vector);
create index if not exists chunks_embedding_hnsw_idx
  on public.chunks using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;
create index if not exists jobs_status_created_idx
  on public.jobs (status, created_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sources_set_updated_at on public.sources;
create trigger sources_set_updated_at
before update on public.sources
for each row execute function public.set_updated_at();

drop trigger if exists segments_set_updated_at on public.segments;
create trigger segments_set_updated_at
before update on public.segments
for each row execute function public.set_updated_at();

drop trigger if exists chunks_set_updated_at on public.chunks;
create trigger chunks_set_updated_at
before update on public.chunks
for each row execute function public.set_updated_at();

create or replace function public.preserve_segment_evidence()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.source_id is distinct from new.source_id
    or old.start_ms is distinct from new.start_ms
    or old.end_ms is distinct from new.end_ms
    or old.speaker is distinct from new.speaker
    or old.raw_text is distinct from new.raw_text
    or old.provenance is distinct from new.provenance then
    raise exception 'Immutable segment evidence fields cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists segments_preserve_evidence on public.segments;
create trigger segments_preserve_evidence
before update on public.segments
for each row execute function public.preserve_segment_evidence();

create or replace function public.ingest_knowledge_bundle(
  p_job_id uuid,
  p_sources jsonb,
  p_segments jsonb,
  p_chunks jsonb,
  p_prompts jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, extensions
as $$
begin
  insert into public.jobs (id, kind, status, input_count)
  values (
    p_job_id,
    'admin_ingest',
    'running',
    jsonb_array_length(coalesce(p_sources, '[]'::jsonb))
      + jsonb_array_length(coalesce(p_segments, '[]'::jsonb))
      + jsonb_array_length(coalesce(p_chunks, '[]'::jsonb))
  );

  insert into public.sources (
    id, external_id, kind, title, canonical_url, thumbnail_url, description,
    published_at, duration_seconds, transcript_status, segment_count, tags, is_public
  )
  select
    row.id, row.external_id, row.kind, row.title, row.canonical_url,
    row.thumbnail_url, row.description, row.published_at, row.duration_seconds,
    row.transcript_status, row.segment_count, coalesce(row.tags, '{}'),
    coalesce(row.is_public, false)
  from jsonb_to_recordset(coalesce(p_sources, '[]'::jsonb)) as row(
    id text, external_id text, kind text, title text, canonical_url text,
    thumbnail_url text, description text, published_at timestamptz,
    duration_seconds integer, transcript_status text, segment_count integer,
    tags text[], is_public boolean
  )
  on conflict (id) do update set
    external_id = excluded.external_id,
    kind = excluded.kind,
    title = excluded.title,
    canonical_url = excluded.canonical_url,
    thumbnail_url = excluded.thumbnail_url,
    description = excluded.description,
    published_at = excluded.published_at,
    duration_seconds = excluded.duration_seconds,
    transcript_status = excluded.transcript_status,
    segment_count = excluded.segment_count,
    tags = excluded.tags,
    is_public = excluded.is_public;

  insert into public.segments (
    id, source_id, start_ms, end_ms, speaker, raw_text, normalized_text,
    provenance, metadata
  )
  select
    row.id, row.source_id, row.start_ms, row.end_ms, row.speaker, row.raw_text,
    row.normalized_text, row.provenance, coalesce(row.metadata, '{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_segments, '[]'::jsonb)) as row(
    id text, source_id text, start_ms integer, end_ms integer, speaker text,
    raw_text text, normalized_text text, provenance text, metadata jsonb
  )
  on conflict (id) do update set
    source_id = excluded.source_id,
    start_ms = excluded.start_ms,
    end_ms = excluded.end_ms,
    speaker = excluded.speaker,
    raw_text = excluded.raw_text,
    normalized_text = excluded.normalized_text,
    provenance = excluded.provenance,
    metadata = excluded.metadata;

  insert into public.chunks (
    id, source_id, source_title, source_kind, canonical_url, thumbnail_url,
    start_ms, end_ms, text, provenance
  )
  select
    row.id, row.source_id, row.source_title, row.source_kind, row.canonical_url,
    row.thumbnail_url, row.start_ms, row.end_ms, row.text, row.provenance
  from jsonb_to_recordset(coalesce(p_chunks, '[]'::jsonb)) as row(
    id text, source_id text, source_title text, source_kind text,
    canonical_url text, thumbnail_url text, start_ms integer, end_ms integer,
    text text, provenance text
  )
  on conflict (id) do update set
    source_id = excluded.source_id,
    source_title = excluded.source_title,
    source_kind = excluded.source_kind,
    canonical_url = excluded.canonical_url,
    thumbnail_url = excluded.thumbnail_url,
    start_ms = excluded.start_ms,
    end_ms = excluded.end_ms,
    text = excluded.text,
    provenance = excluded.provenance,
    embedding = null;

  insert into public.prompts (id, name, purpose, version, updated_at, body)
  select row.id, row.name, row.purpose, row.version, row.updated_at, row.body
  from jsonb_to_recordset(coalesce(p_prompts, '[]'::jsonb)) as row(
    id text, name text, purpose text, version text, updated_at date, body text
  )
  on conflict (id) do update set
    name = excluded.name,
    purpose = excluded.purpose,
    version = excluded.version,
    updated_at = excluded.updated_at,
    body = excluded.body;

  update public.jobs
  set status = 'completed', completed_at = now()
  where id = p_job_id;

  return p_job_id;
end;
$$;

revoke all on function public.ingest_knowledge_bundle(uuid, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_knowledge_bundle(uuid, jsonb, jsonb, jsonb, jsonb)
  to service_role;

comment on function public.ingest_knowledge_bundle is
  'Atomically validates/upserts one admin ingestion bundle and its prompt snapshot.';

create or replace function public.search_chunks_rrf(
  query_text text,
  query_embedding extensions.vector(384) default null,
  match_count integer default 8,
  rrf_k integer default 60
)
returns table (
  id text,
  source_id text,
  source_title text,
  source_kind text,
  canonical_url text,
  thumbnail_url text,
  start_ms integer,
  end_ms integer,
  text text,
  provenance text,
  score double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with bounded as (
    select least(50, greatest(1, match_count)) as wanted,
           greatest(1, rrf_k) as k,
           websearch_to_tsquery('english', coalesce(query_text, '')) as text_query
  ),
  full_text as (
    select c.id,
           row_number() over (
             order by ts_rank_cd(c.search_vector, b.text_query) desc, c.id
           ) as rank
    from public.chunks c
    join public.sources s on s.id = c.source_id and s.is_public
    cross join bounded b
    where b.text_query @@ c.search_vector
    order by ts_rank_cd(c.search_vector, b.text_query) desc, c.id
    limit least(200, greatest(4, match_count * 4))
  ),
  semantic as (
    select c.id,
           row_number() over (order by c.embedding <=> query_embedding, c.id) as rank
    from public.chunks c
    join public.sources s on s.id = c.source_id and s.is_public
    where query_embedding is not null and c.embedding is not null
    order by c.embedding <=> query_embedding, c.id
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
         c.source_title,
         c.source_kind,
         c.canonical_url,
         c.thumbnail_url,
         c.start_ms,
         c.end_ms,
         c.text,
         c.provenance,
         fused.score
  from fused
  join public.chunks c on c.id = fused.id
  cross join bounded b
  order by fused.score desc, c.id
  limit (select wanted from bounded);
$$;

alter table public.sources enable row level security;
alter table public.segments enable row level security;
alter table public.chunks enable row level security;
alter table public.prompts enable row level security;
alter table public.jobs enable row level security;

drop policy if exists "public sources are readable" on public.sources;
create policy "public sources are readable"
on public.sources for select
to anon, authenticated
using (is_public);

drop policy if exists "public source chunks are readable" on public.chunks;
create policy "public source chunks are readable"
on public.chunks for select
to anon, authenticated
using (
  exists (
    select 1 from public.sources
    where sources.id = chunks.source_id and sources.is_public
  )
);

revoke all on public.sources, public.segments, public.chunks, public.prompts, public.jobs
  from anon, authenticated;
grant select on public.sources, public.chunks to anon, authenticated;
grant execute on function public.search_chunks_rrf(text, extensions.vector, integer, integer)
  to anon, authenticated;

comment on table public.segments is
  'Immutable raw evidence cues. Anonymous and authenticated clients have no direct access.';
comment on table public.prompts is
  'Server-managed prompt ledger snapshots. Never accepts prompt text from chat clients.';
comment on function public.search_chunks_rrf is
  'Read-only reciprocal-rank fusion of English FTS and 384-dimensional gte-small vectors; RLS remains in force.';
