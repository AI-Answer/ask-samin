import { createPublicRpcClient, createReadSupabaseClient, createServiceRootClient } from "./db/client";
import { EMBEDDING_DIMENSIONS } from "./types";

function parseEmbedding(payload: unknown): number[] | null {
  const candidate =
    Array.isArray(payload) ? payload : (payload as { embedding?: unknown } | null)?.embedding;
  if (!Array.isArray(candidate) || candidate.length !== EMBEDDING_DIMENSIONS) return null;
  if (!candidate.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  return candidate as number[];
}

export async function createQueryEmbedding(text: string): Promise<number[] | null> {
  const client = createServiceRootClient();
  if (!client) return null;

  const functionName = process.env.EMBED_FUNCTION_NAME ?? "gte-small";
  const { data, error } = await client.functions.invoke(functionName, {
    body: { input: text }
  });
  if (error) return null;
  return parseEmbedding(data);
}

export async function createEmbeddingsBatch(texts: string[]): Promise<Array<number[] | null>> {
  const results: Array<number[] | null> = [];
  for (const text of texts) {
    results.push(await createQueryEmbedding(text));
  }
  return results;
}

export function embeddingToPgVector(values: number[]): string {
  return `[${values.join(",")}]`;
}

interface RpcSearchRow {
  id: string;
  source_id: string;
  source_type: string;
  source_title: string;
  canonical_url: string;
  curriculum_path: string[];
  content: string;
  when_to_use: string | null;
  metadata: Record<string, unknown> | null;
  score: number;
}

export async function rpcSearchCommunityChunks(input: {
  queryText: string;
  queryEmbedding: number[] | null;
  matchCount: number;
  filterSourceType?: string;
  filterCurriculumPath?: string;
}): Promise<RpcSearchRow[] | null> {
  const client = createPublicRpcClient();
  if (!client) return null;

  const embedding =
    input.queryEmbedding && input.queryEmbedding.length === EMBEDDING_DIMENSIONS
      ? embeddingToPgVector(input.queryEmbedding)
      : null;

  const { data, error } = await client.rpc("search_community_chunks_rrf", {
    query_text: input.queryText,
    query_embedding: embedding,
    match_count: input.matchCount,
    filter_source_type: input.filterSourceType ?? null,
    filter_curriculum_path: input.filterCurriculumPath ?? null
  });

  if (error || !Array.isArray(data)) return null;
  return data as RpcSearchRow[];
}

export async function logQueryUsage(input: {
  toolName: string;
  queryText?: string;
  clientIpHash: string;
  resultCount: number;
}): Promise<void> {
  const client = createReadSupabaseClient();
  if (!client) return;

  await client.from("query_usage_logs").insert({
    tool_name: input.toolName,
    query_text: input.queryText ?? null,
    client_ip_hash: input.clientIpHash,
    result_count: input.resultCount
  });
}
