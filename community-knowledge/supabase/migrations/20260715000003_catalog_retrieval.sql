-- Lesson-centric retrieval: page_kind, downloadable assets, curriculum sync support.

alter table community_knowledge.sources
  add column if not exists page_kind text check (
    page_kind is null or page_kind in (
      'lesson_page', 'skill_card', 'asset_pointer', 'prompt_playbook', 'concept_lesson'
    )
  );

comment on column community_knowledge.sources.page_kind is
  'Skool page shape — drives chunking and MCP location hints (distinct from source_type).';

create table if not exists community_knowledge.source_assets (
  id text primary key,
  source_id text not null references community_knowledge.sources(id) on delete cascade,
  asset_type text not null check (asset_type in ('zip', 'github', 'url', 'video')),
  file_id text,
  file_name text,
  url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists source_assets_source_idx
  on community_knowledge.source_assets (source_id, asset_type);

alter table community_knowledge.source_assets enable row level security;

drop policy if exists "source assets are readable" on community_knowledge.source_assets;
create policy "source assets are readable"
on community_knowledge.source_assets for select
using (true);

drop policy if exists "service role full access" on community_knowledge.source_assets;
create policy "service role full access"
on community_knowledge.source_assets for all to service_role
using (true) with check (true);

grant select on community_knowledge.source_assets to anon, authenticated;

NOTIFY pgrst, 'reload schema';
