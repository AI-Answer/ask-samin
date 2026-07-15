import { createServerSupabaseClient, createServiceRootClient } from "../db/client";
import { createEmbeddingsBatch, embeddingToPgVector } from "../embed";
import type { CommunityChunk, CommunitySource, MediaAsset } from "../types";
import { EMBEDDING_MODEL } from "../types";

const STALE_RUN_MS = 30 * 60 * 1000;

export async function beginIngestionRun(): Promise<string | null> {
  const client = createServerSupabaseClient();
  if (!client) return null;

  const { data: staleRuns } = await client
    .from("ingestion_runs")
    .select("id")
    .eq("status", "running")
    .lt("last_progress_at", new Date(Date.now() - STALE_RUN_MS).toISOString());

  if (staleRuns?.length) {
    await client
      .from("ingestion_runs")
      .update({ status: "stale", error: "Heartbeat timeout" })
      .in(
        "id",
        staleRuns.map((run) => run.id)
      );
  }

  const { data, error } = await client
    .from("ingestion_runs")
    .insert({ status: "running", phase: "crawling", progress_pct: 0 })
    .select("id")
    .single();

  return error ? null : data.id;
}

export async function heartbeatRun(
  runId: string,
  update: { phase?: string; progressPct?: number; stats?: Record<string, unknown> }
): Promise<void> {
  const client = createServerSupabaseClient();
  if (!client) return;

  await client
    .from("ingestion_runs")
    .update({
      last_progress_at: new Date().toISOString(),
      ...(update.phase ? { phase: update.phase } : {}),
      ...(update.progressPct !== undefined ? { progress_pct: update.progressPct } : {}),
      ...(update.stats ? { stats: update.stats } : {})
    })
    .eq("id", runId);
}

export async function completeRun(
  runId: string,
  status: "completed" | "failed",
  error?: string
): Promise<void> {
  const client = createServerSupabaseClient();
  if (!client) return;

  await client
    .from("ingestion_runs")
    .update({
      status,
      completed_at: new Date().toISOString(),
      last_progress_at: new Date().toISOString(),
      ...(error ? { error } : {})
    })
    .eq("id", runId);
}

export async function upsertSource(
  source: CommunitySource,
  options: { publish?: boolean } = {}
): Promise<boolean> {
  const client = createServerSupabaseClient();
  if (!client) return false;

  const now = new Date().toISOString();
  const { error } = await client.from("sources").upsert({
    id: source.id,
    source_type: source.sourceType,
    title: source.title,
    canonical_url: source.canonicalUrl,
    curriculum_path: source.curriculumPath,
    body_markdown: source.bodyMarkdown,
    video_ids: source.videoIds,
    author: source.author ?? null,
    posted_at: source.postedAt ?? null,
    content_hash: source.contentHash,
    visibility: options.publish ? "published" : source.visibility,
    extraction_status: source.extractionStatus,
    blocked_reason: source.blockedReason ?? null,
    when_to_use: source.whenToUse ?? null,
    extracted_at: source.extractedAt,
    extraction_model_version: source.extractionModelVersion ?? EMBEDDING_MODEL,
    updated_at: source.updatedAt,
    group_id: source.groupId ?? null,
    group_slug: source.groupSlug ?? null,
    external_id: source.externalId ?? null,
    course_id: source.courseId ?? null,
    last_seen_at: source.lastSeenAt ?? now,
    removed_at: source.removedAt ?? null,
    raw_snapshot_id: source.rawSnapshotId ?? null
  });

  return !error;
}

export async function replaceSourceChunks(
  sourceId: string,
  chunks: CommunityChunk[],
  embed = true,
  runId?: string
): Promise<number> {
  const client = createServerSupabaseClient();
  if (!client) return 0;

  let embeddings: Array<number[] | null> = chunks.map(() => null);
  if (embed) {
    if (runId) await heartbeatRun(runId, { phase: "embedding" });
    const rootClient = createServiceRootClient();
    if (!rootClient) return 0;
    embeddings = await createEmbeddingsBatch(chunks.map((chunk) => chunk.content));
  }

  const payload = chunks.map((chunk, index) => ({
    id: chunk.id,
    chunk_index: chunk.chunkIndex,
    content: chunk.content,
    embedding: embeddings[index] ? embeddingToPgVector(embeddings[index]!) : null,
    embedding_model: EMBEDDING_MODEL,
    metadata: {
      ...chunk.metadata,
      ...(chunk.startMs !== undefined ? { startMs: chunk.startMs, endMs: chunk.endMs } : {})
    },
    when_to_use: chunk.whenToUse ?? null
  }));

  const rpcClient = createServiceRootClient();
  if (!rpcClient) return 0;

  const { data, error } = await rpcClient.rpc("replace_source_chunks", {
    p_source_id: sourceId,
    p_chunks: payload
  });

  return error ? 0 : (data as number);
}

export async function saveRawSnapshot(input: {
  sourceUrl: string;
  rawHash: string;
  rawContent: string;
  status?: string;
  sourceId?: string;
  provider?: string;
  fetchMethod?: string;
  contentType?: string;
}): Promise<string | null> {
  const client = createServerSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("raw_snapshots")
    .insert({
      source_url: input.sourceUrl,
      raw_hash: input.rawHash,
      raw_content: input.rawContent,
      status: input.status ?? "fetched",
      source_id: input.sourceId ?? null,
      provider: input.provider ?? null,
      fetch_method: input.fetchMethod ?? null,
      content_type: input.contentType ?? null
    })
    .select("id")
    .single();

  return error ? null : (data.id as string);
}

export async function upsertMediaAssets(assets: MediaAsset[]): Promise<void> {
  if (assets.length === 0) return;
  const client = createServerSupabaseClient();
  if (!client) return;

  await client.from("media_assets").upsert(
    assets.map((asset) => ({
      id: asset.id,
      source_id: asset.sourceId,
      provider: asset.provider,
      external_id: asset.externalId ?? null,
      url: asset.url ?? null,
      duration_ms: asset.durationMs ?? null,
      fingerprint: asset.fingerprint ?? null,
      extractability: asset.extractability,
      download_status: asset.downloadStatus,
      transcript_status: asset.transcriptStatus,
      raw_transcript: asset.rawTranscript ?? null,
      blocked_reason: asset.blockedReason ?? null
    }))
  );
}

export async function getExistingContentHash(sourceId: string): Promise<string | null> {
  const client = createServerSupabaseClient();
  if (!client) return null;

  const { data } = await client.from("sources").select("content_hash").eq("id", sourceId).maybeSingle();
  return data?.content_hash ?? null;
}
