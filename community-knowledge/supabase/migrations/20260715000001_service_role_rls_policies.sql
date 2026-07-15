-- Service-role write access for ingestion (RLS was enabled without write policies).
-- Also ensure PostgREST exposes community_knowledge (run once per project):
--   ALTER ROLE authenticator SET pgrst.db_schemas TO 'public, storage, graphql_public, hubspoke, community_knowledge';
--   NOTIFY pgrst, 'reload config';
--   NOTIFY pgrst, 'reload schema';
-- Dashboard alternative: Project Settings → API → Exposed schemas → add community_knowledge.

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

NOTIFY pgrst, 'reload schema';
