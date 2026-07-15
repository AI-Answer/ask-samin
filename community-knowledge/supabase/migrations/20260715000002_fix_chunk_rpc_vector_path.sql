-- Fix chunk writes via PostgREST (vector ops schema + service_role grants).
GRANT USAGE ON SCHEMA bookedindev TO service_role;

CREATE OR REPLACE FUNCTION community_knowledge.replace_source_chunks(
  p_source_id text,
  p_chunks jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = community_knowledge, bookedindev, extensions, public
AS $body$
DECLARE
  inserted_count integer;
BEGIN
  DELETE FROM community_knowledge.chunks WHERE source_id = p_source_id;

  INSERT INTO community_knowledge.chunks (
    id, source_id, chunk_index, content, embedding, metadata, when_to_use
  )
  SELECT
    row.id,
    p_source_id,
    row.chunk_index,
    row.content,
    CASE
      WHEN row.embedding IS NULL THEN NULL
      ELSE row.embedding::bookedindev.vector(384)
    END,
    COALESCE(row.metadata, '{}'::jsonb),
    row.when_to_use
  FROM jsonb_to_recordset(COALESCE(p_chunks, '[]'::jsonb)) AS row(
    id text,
    chunk_index integer,
    content text,
    embedding text,
    metadata jsonb,
    when_to_use text
  );

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$body$;

CREATE OR REPLACE FUNCTION public.replace_source_chunks(
  p_source_id text,
  p_chunks jsonb
)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = community_knowledge, bookedindev, extensions, public
AS $$
  SELECT community_knowledge.replace_source_chunks(p_source_id, p_chunks);
$$;

NOTIFY pgrst, 'reload schema';
