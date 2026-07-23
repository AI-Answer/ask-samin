-- Allow anon/authenticated search RPCs that cast to bookedindev.vector.
GRANT USAGE ON SCHEMA bookedindev TO anon, authenticated, service_role;

-- Title + curriculum path participate in FTS ranking (not only chunk body).
CREATE OR REPLACE FUNCTION community_knowledge.search_chunks_rrf_impl(
  query_text text,
  query_embedding bookedindev.vector DEFAULT NULL::bookedindev.vector,
  match_count integer DEFAULT 8,
  rrf_k integer DEFAULT 60,
  filter_source_type text DEFAULT NULL::text,
  filter_curriculum_path text DEFAULT NULL::text
)
RETURNS TABLE(
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
LANGUAGE sql
STABLE
SET search_path TO 'community_knowledge', 'bookedindev', 'extensions', 'public'
AS $function$
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
             order by (
               coalesce(ts_rank_cd(c.search_vector, b.text_query), 0)
               + case
                   when b.text_query @@ to_tsvector('english', coalesce(s.title, ''))
                   then 1.0 else 0
                 end
               + case
                   when b.text_query @@ to_tsvector(
                     'english',
                     coalesce(array_to_string(s.curriculum_path, ' '), '')
                   )
                   then 0.25 else 0
                 end
             ) desc,
             c.id
           ) as rank
    from community_knowledge.chunks c
    join eligible_sources s on s.id = c.source_id
    cross join bounded b
    where b.text_query @@ c.search_vector
       or b.text_query @@ to_tsvector('english', coalesce(s.title, ''))
       or b.text_query @@ to_tsvector(
            'english',
            coalesce(array_to_string(s.curriculum_path, ' '), '')
          )
    order by (
      coalesce(ts_rank_cd(c.search_vector, b.text_query), 0)
      + case
          when b.text_query @@ to_tsvector('english', coalesce(s.title, ''))
          then 1.0 else 0
        end
      + case
          when b.text_query @@ to_tsvector(
            'english',
            coalesce(array_to_string(s.curriculum_path, ' '), '')
          )
          then 0.25 else 0
        end
    ) desc, c.id
    limit least(200, greatest(4, match_count * 4))
  ),
  semantic as (
    select c.id,
           row_number() over (
             order by (c.embedding::bookedindev.vector(384) <=> query_embedding::bookedindev.vector(384)), c.id
           ) as rank
    from community_knowledge.chunks c
    join eligible_sources s on s.id = c.source_id
    where query_embedding is not null and c.embedding is not null
    order by (c.embedding::bookedindev.vector(384) <=> query_embedding::bookedindev.vector(384)), c.id
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
$function$;
