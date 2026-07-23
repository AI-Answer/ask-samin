import { createPublicRpcClient, createReadSupabaseClient, createServiceRootClient } from "./db/client";
import { EMBEDDING_DIMENSIONS } from "./types";

const OPENROUTER_EMBED_URL = "https://openrouter.ai/api/v1/embeddings";
const DEFAULT_OPENROUTER_EMBED_MODEL = "openai/text-embedding-3-small";

function parseEmbedding(payload: unknown): number[] | null {
  const candidate =
    Array.isArray(payload) ? payload : (payload as { embedding?: unknown } | null)?.embedding;
  if (!Array.isArray(candidate) || candidate.length !== EMBEDDING_DIMENSIONS) return null;
  if (!candidate.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  return candidate as number[];
}

async function createOpenRouterEmbeddings(texts: string[]): Promise<Array<number[] | null>> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey || texts.length === 0) {
    return texts.map(() => null);
  }

  const model =
    process.env.OPENROUTER_EMBED_MODEL?.trim() || DEFAULT_OPENROUTER_EMBED_MODEL;

  const response = await fetch(OPENROUTER_EMBED_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://ask-samin-ochre.vercel.app",
      "X-Title": "Ask Samin embeddings"
    },
    body: JSON.stringify({
      model,
      input: texts.map((text) => text.slice(0, 8_000)),
      dimensions: EMBEDDING_DIMENSIONS
    })
  });

  if (!response.ok) {
    return texts.map(() => null);
  }

  const payload = (await response.json()) as {
    data?: Array<{ embedding?: unknown; index?: number }>;
  };
  const byIndex = new Map<number, number[]>();
  for (const row of payload.data ?? []) {
    const embedding = parseEmbedding(row);
    if (!embedding) continue;
    const index = typeof row.index === "number" ? row.index : byIndex.size;
    byIndex.set(index, embedding);
  }

  return texts.map((_, index) => byIndex.get(index) ?? null);
}

async function createOpenRouterEmbedding(text: string): Promise<number[] | null> {
  const [embedding] = await createOpenRouterEmbeddings([text]);
  return embedding ?? null;
}

async function createGteSmallEmbedding(text: string): Promise<number[] | null> {
  const client = createServiceRootClient();
  if (!client) return null;

  const functionName = process.env.EMBED_FUNCTION_NAME ?? "gte-small";
  const { data, error } = await client.functions.invoke(functionName, {
    body: { input: text }
  });
  if (error) return null;
  return parseEmbedding(data);
}

/** Prefer OpenRouter 384-d when configured; fall back to Supabase gte-small Edge Function. */
export async function createQueryEmbedding(text: string): Promise<number[] | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (process.env.OPENROUTER_API_KEY?.trim()) {
    const fromOpenRouter = await createOpenRouterEmbedding(trimmed);
    if (fromOpenRouter) return fromOpenRouter;
  }

  return createGteSmallEmbedding(trimmed);
}

export async function createEmbeddingsBatch(texts: string[]): Promise<Array<number[] | null>> {
  if (texts.length === 0) return [];

  if (process.env.OPENROUTER_API_KEY?.trim()) {
    const batchSize = Number(process.env.OPENROUTER_EMBED_BATCH_SIZE ?? 64);
    const size = Number.isFinite(batchSize) && batchSize > 0 ? Math.min(96, Math.floor(batchSize)) : 64;
    const results: Array<number[] | null> = [];
    for (let offset = 0; offset < texts.length; offset += size) {
      const slice = texts.slice(offset, offset + size);
      const embedded = await createOpenRouterEmbeddings(slice);
      // Fall back per-item to gte-small if OpenRouter batch row failed.
      for (let i = 0; i < slice.length; i += 1) {
        results.push(embedded[i] ?? (await createGteSmallEmbedding(slice[i])));
      }
      if (offset + size < texts.length) {
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    }
    return results;
  }

  const results: Array<number[] | null> = [];
  for (const text of texts) {
    results.push(await createGteSmallEmbedding(text));
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
