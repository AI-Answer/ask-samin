import { getCatalogChunk, getCatalogChunksForSource, getCatalogSource } from "./catalog";
import { decodeEvidenceId } from "./evidence-id";
import { hasStoredCueStart } from "./search/cue-anchor";
import { createServerSupabaseClient } from "./search/supabase";
import type { KnowledgeChunk, KnowledgeSource } from "./types";

interface SourceRow {
  id: string;
  external_id: string;
  kind: KnowledgeSource["kind"];
  title: string;
  canonical_url: string;
  thumbnail_url: string | null;
  description: string | null;
  published_at: string | null;
  duration_seconds: number | null;
  transcript_status: KnowledgeSource["transcriptStatus"];
  segment_count: number;
  tags: string[] | null;
}

interface ChunkRow {
  id: string;
  source_id: string;
  source_title: string;
  source_kind: KnowledgeChunk["sourceKind"];
  canonical_url: string;
  thumbnail_url: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
  provenance: KnowledgeChunk["provenance"];
}

export interface SourceRecord {
  source: KnowledgeSource;
  chunks: KnowledgeChunk[];
}

export interface EvidenceRecord extends SourceRecord {
  matchedChunkId?: string;
  matchedStartMs?: number;
}

function mapSource(row: SourceRow): KnowledgeSource {
  return {
    id: row.id,
    externalId: row.external_id,
    kind: row.kind,
    title: row.title,
    canonicalUrl: row.canonical_url,
    ...(row.thumbnail_url ? { thumbnailUrl: row.thumbnail_url } : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(row.published_at ? { publishedAt: row.published_at } : {}),
    ...(row.duration_seconds !== null ? { durationSeconds: row.duration_seconds } : {}),
    transcriptStatus: row.transcript_status,
    segmentCount: row.segment_count,
    tags: row.tags ?? []
  };
}

function mapChunk(row: ChunkRow): KnowledgeChunk {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceTitle: row.source_title,
    sourceKind: row.source_kind,
    canonicalUrl: row.canonical_url,
    ...(row.thumbnail_url ? { thumbnailUrl: row.thumbnail_url } : {}),
    startMs: row.start_ms,
    endMs: row.end_ms,
    text: row.text,
    provenance: row.provenance
  };
}

export async function getSaminSource(sourceId: string): Promise<SourceRecord | null> {
  const localSource = getCatalogSource(sourceId);
  if (localSource) {
    return { source: localSource, chunks: getCatalogChunksForSource(sourceId) };
  }

  const client = createServerSupabaseClient();
  if (!client) return null;
  const [{ data: sourceData, error: sourceError }, { data: chunkData, error: chunkError }] =
    await Promise.all([
      client
        .from("sources")
        .select("*")
        .eq("id", sourceId)
        .eq("is_public", true)
        .maybeSingle(),
      client.from("chunks").select("*").eq("source_id", sourceId).order("start_ms")
    ]);

  if (sourceError || chunkError || !sourceData) return null;
  return {
    source: mapSource(sourceData as SourceRow),
    chunks: ((chunkData ?? []) as ChunkRow[]).map(mapChunk)
  };
}

/**
 * Resolve an MCP result ID to its source while retaining the exact matched chunk.
 * Search returns chunk IDs, but source IDs remain accepted for compatibility with
 * clients that cached results from the first release.
 */
export async function getSaminEvidence(resultId: string): Promise<EvidenceRecord | null> {
  const anchored = decodeEvidenceId(resultId);
  const lookupId = anchored?.chunkId ?? resultId;
  const localChunk = getCatalogChunk(lookupId);
  if (localChunk) {
    if (anchored && !hasStoredCueStart(localChunk, anchored.startMs)) return null;
    const source = getCatalogSource(localChunk.sourceId);
    if (!source) return null;
    return {
      source,
      chunks: getCatalogChunksForSource(localChunk.sourceId),
      matchedChunkId: localChunk.id,
      ...(anchored ? { matchedStartMs: anchored.startMs } : {})
    };
  }

  const localSource = getCatalogSource(lookupId);
  if (localSource) {
    if (anchored) return null;
    return { source: localSource, chunks: getCatalogChunksForSource(lookupId) };
  }

  const client = createServerSupabaseClient();
  if (!client) return null;
  const { data: chunkData, error: chunkError } = await client
    .from("chunks")
    .select("*")
    .eq("id", lookupId)
    .maybeSingle();

  if (!chunkError && chunkData) {
    const matchedChunk = mapChunk(chunkData as ChunkRow);
    if (anchored && !hasStoredCueStart(matchedChunk, anchored.startMs)) return null;
    const record = await getSaminSource(matchedChunk.sourceId);
    if (!record) return null;
    return {
      ...record,
      matchedChunkId: matchedChunk.id,
      ...(anchored ? { matchedStartMs: anchored.startMs } : {})
    };
  }

  if (anchored) return null;
  const record = await getSaminSource(lookupId);
  return record ? { ...record } : null;
}
