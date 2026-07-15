import { createReadSupabaseClient } from "./client";
import type { CommunityChunk, CommunitySource, CurriculumNode, FetchResult, SourceType } from "../types";

function mapSource(row: Record<string, unknown>): CommunitySource {
  return {
    id: row.id as string,
    sourceType: row.source_type as CommunitySource["sourceType"],
    title: row.title as string,
    canonicalUrl: row.canonical_url as string,
    curriculumPath: (row.curriculum_path as string[]) ?? [],
    bodyMarkdown: (row.body_markdown as string) ?? "",
    videoIds: (row.video_ids as string[]) ?? [],
    author: (row.author as string) ?? undefined,
    postedAt: (row.posted_at as string) ?? undefined,
    contentHash: row.content_hash as string,
    visibility: row.visibility as CommunitySource["visibility"],
    extractionStatus: row.extraction_status as CommunitySource["extractionStatus"],
    blockedReason: (row.blocked_reason as string) ?? undefined,
    whenToUse: (row.when_to_use as string) ?? undefined,
    extractedAt: row.extracted_at as string,
    extractionModelVersion: (row.extraction_model_version as string) ?? undefined,
    updatedAt: row.updated_at as string,
    groupSlug: (row.group_slug as string) ?? undefined,
    externalId: (row.external_id as string) ?? undefined,
    courseId: (row.course_id as string) ?? undefined
  };
}

function mapChunk(row: Record<string, unknown>): CommunityChunk {
  const metadata = (row.metadata as Record<string, unknown>) ?? {};
  return {
    id: row.id as string,
    sourceId: row.source_id as string,
    chunkIndex: row.chunk_index as number,
    content: row.content as string,
    metadata,
    whenToUse: (row.when_to_use as string) ?? undefined,
    startMs: typeof metadata.startMs === "number" ? metadata.startMs : undefined,
    endMs: typeof metadata.endMs === "number" ? metadata.endMs : undefined
  };
}

export async function fetchEvidenceFromDb(chunkId: string): Promise<FetchResult | null> {
  const client = createReadSupabaseClient();
  if (!client) return null;

  const { data: chunkRow } = await client.from("chunks").select("*").eq("id", chunkId).maybeSingle();
  if (!chunkRow) return null;

  const chunk = mapChunk(chunkRow);
  const { data: sourceRow } = await client
    .from("sources")
    .select("*")
    .eq("id", chunk.sourceId)
    .eq("visibility", "published")
    .eq("extraction_status", "indexed")
    .maybeSingle();
  if (!sourceRow) return null;

  const { data: nearbyRows } = await client
    .from("chunks")
    .select("*")
    .eq("source_id", chunk.sourceId)
    .order("chunk_index", { ascending: true });

  const nearby = (nearbyRows ?? []).map(mapChunk);
  const index = nearby.findIndex((entry) => entry.id === chunk.id);
  const radius = 1;
  const nearbyChunks =
    index >= 0
      ? nearby.slice(Math.max(0, index - radius), Math.min(nearby.length, index + radius + 1))
      : [chunk];

  return {
    id: chunk.id,
    source: mapSource(sourceRow),
    chunk,
    nearbyChunks
  };
}

export async function browseCurriculumFromDb(parentId: string | null = null): Promise<CurriculumNode[] | null> {
  const client = createReadSupabaseClient();
  if (!client) return null;

  const query = client
    .from("curriculum_nodes")
    .select("*")
    .order("node_order", { ascending: true })
    .order("id", { ascending: true });

  const { data, error } =
    parentId === null ? await query.is("parent_id", null) : await query.eq("parent_id", parentId);
  if (error || !data) return null;

  return data.map((row) => ({
    id: row.id as string,
    parentId: (row.parent_id as string | null) ?? null,
    title: row.title as string,
    slug: row.slug as string,
    order: row.node_order as number,
    nodeType: row.node_type as CurriculumNode["nodeType"],
    sourceId: (row.source_id as string) ?? undefined,
    groupSlug: (row.group_slug as string) ?? undefined,
    courseId: (row.course_id as string) ?? undefined,
    externalId: (row.external_id as string) ?? undefined
  }));
}

export async function listRecentUpdatesFromDb(limit = 10) {
  const client = createReadSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("sources")
    .select("id, title, source_type, canonical_url, updated_at, curriculum_path")
    .eq("visibility", "published")
    .eq("extraction_status", "indexed")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error || !data) return null;

  return data.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    sourceType: row.source_type as SourceType,
    canonicalUrl: row.canonical_url as string,
    updatedAt: row.updated_at as string,
    curriculumPath: (row.curriculum_path as string[]) ?? []
  }));
}
