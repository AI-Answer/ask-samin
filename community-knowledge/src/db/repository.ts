import { createReadSupabaseClient, createServerSupabaseClient } from "./client";
import type {
  CommunityChunk,
  CommunitySource,
  CurriculumNode,
  FetchResult,
  PageKind,
  SourceAsset,
  SourceType
} from "../types";

function getDbReadClient() {
  return createReadSupabaseClient() ?? createServerSupabaseClient();
}

function mapSource(row: Record<string, unknown>): CommunitySource {
  return {
    id: row.id as string,
    sourceType: row.source_type as CommunitySource["sourceType"],
    pageKind: (row.page_kind as PageKind | null) ?? undefined,
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

function mapSourceAsset(row: Record<string, unknown>): SourceAsset {
  return {
    id: row.id as string,
    sourceId: row.source_id as string,
    assetType: row.asset_type as SourceAsset["assetType"],
    fileId: (row.file_id as string) ?? undefined,
    fileName: (row.file_name as string) ?? undefined,
    url: (row.url as string) ?? undefined,
    metadata: (row.metadata as Record<string, unknown>) ?? undefined
  };
}

async function listSourceAssets(sourceId: string): Promise<SourceAsset[]> {
  const client = getDbReadClient();
  if (!client) return [];

  const { data } = await client
    .from("source_assets")
    .select("*")
    .eq("source_id", sourceId)
    .order("asset_type", { ascending: true })
    .order("file_name", { ascending: true });

  return (data ?? []).map(mapSourceAsset);
}

export async function getSourceRetrievalMeta(
  sourceIds: string[]
): Promise<Map<string, { pageKind?: PageKind; assets: SourceAsset[] }>> {
  const client = getDbReadClient();
  const meta = new Map<string, { pageKind?: PageKind; assets: SourceAsset[] }>();
  if (!client || sourceIds.length === 0) return meta;

  const uniqueIds = [...new Set(sourceIds)];
  const { data: sources } = await client
    .from("sources")
    .select("id, page_kind")
    .in("id", uniqueIds);
  const { data: assets } = await client.from("source_assets").select("*").in("source_id", uniqueIds);

  for (const id of uniqueIds) {
    meta.set(id, { assets: [] });
  }
  for (const row of sources ?? []) {
    const current = meta.get(row.id as string);
    if (!current) continue;
    current.pageKind = (row.page_kind as PageKind | null) ?? undefined;
  }
  for (const row of assets ?? []) {
    const asset = mapSourceAsset(row);
    const current = meta.get(asset.sourceId);
    if (!current) continue;
    current.assets.push(asset);
  }

  return meta;
}

export async function fetchSourceFromDb(
  sourceId: string,
  preferredChunkId?: string
): Promise<FetchResult | null> {
  const client = getDbReadClient();
  if (!client) return null;

  const { data: sourceRow } = await client
    .from("sources")
    .select("*")
    .eq("id", sourceId)
    .eq("visibility", "published")
    .eq("extraction_status", "indexed")
    .maybeSingle();
  if (!sourceRow) return null;

  const { data: chunkRows } = await client
    .from("chunks")
    .select("*")
    .eq("source_id", sourceId)
    .order("chunk_index", { ascending: true });

  const chunks = (chunkRows ?? []).map(mapChunk);
  const preferredChunk = preferredChunkId
    ? chunks.find((entry) => entry.id === preferredChunkId)
    : undefined;
  const chunk = preferredChunk ??
    chunks[0] ?? {
      id: `${sourceId}__chunk_0`,
      sourceId,
      chunkIndex: 0,
      content: (sourceRow.body_markdown as string) ?? "",
      metadata: { synthetic: true },
      whenToUse: (sourceRow.when_to_use as string) ?? undefined
    };
  const assets = await listSourceAssets(sourceId);

  return {
    id: preferredChunkId ?? sourceId,
    source: mapSource(sourceRow),
    chunk,
    nearbyChunks: chunks.length > 0 ? chunks : [chunk],
    assets
  };
}

export async function fetchEvidenceFromDb(id: string): Promise<FetchResult | null> {
  if (!id.includes("__chunk_")) {
    return fetchSourceFromDb(id);
  }

  const client = getDbReadClient();
  if (!client) return null;

  const { data: chunkRow } = await client.from("chunks").select("source_id").eq("id", id).maybeSingle();
  if (!chunkRow) return null;

  return fetchSourceFromDb(chunkRow.source_id as string, id);
}

export async function browseCurriculumFromDb(parentId: string | null = null): Promise<CurriculumNode[] | null> {
  const client = getDbReadClient();
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
  const client = getDbReadClient();
  if (!client) return null;

  const { data, error } = await client
    .from("sources")
    .select("id, title, source_type, canonical_url, updated_at, curriculum_path, page_kind")
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
    curriculumPath: (row.curriculum_path as string[]) ?? [],
    pageKind: (row.page_kind as PageKind | null) ?? undefined
  }));
}
