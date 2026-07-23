import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { KnowledgeChunk, SourceKind } from "../types";
import type { RankedChunk } from "./local";

interface SearchRow {
  id: string;
  source_id: string;
  source_title: string;
  source_kind: SourceKind;
  canonical_url: string;
  thumbnail_url: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
  provenance: KnowledgeChunk["provenance"];
  score: number;
}

function getSupabaseEnvironment(): { url: string; serviceRoleKey: string } | undefined {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return undefined;
  return { url, serviceRoleKey };
}

export function isSupabaseSearchConfigured(): boolean {
  return getSupabaseEnvironment() !== undefined;
}

export function createServerSupabaseClient(): SupabaseClient | undefined {
  const environment = getSupabaseEnvironment();
  if (!environment) return undefined;

  return createClient(environment.url, environment.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "X-Client-Info": "ask-samin-server" } }
  });
}

function parseEmbedding(payload: unknown): number[] | null {
  const candidate =
    Array.isArray(payload) ? payload : (payload as { embedding?: unknown } | null)?.embedding;
  if (!Array.isArray(candidate) || candidate.length !== 384) return null;
  if (!candidate.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  return candidate as number[];
}

async function createOpenRouterEmbedding(query: string): Promise<number[] | null> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return null;

  const model =
    process.env.OPENROUTER_EMBED_MODEL?.trim() || "openai/text-embedding-3-small";
  const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://ask-samin-ochre.vercel.app",
      "X-Title": "Ask Samin embeddings"
    },
    body: JSON.stringify({
      model,
      input: query.slice(0, 8_000),
      dimensions: 384
    })
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { data?: Array<{ embedding?: unknown }> };
  return parseEmbedding(payload.data?.[0] ?? null);
}

async function createQueryEmbedding(
  client: SupabaseClient,
  query: string
): Promise<number[] | null> {
  if (process.env.OPENROUTER_API_KEY?.trim()) {
    const fromOpenRouter = await createOpenRouterEmbedding(query);
    if (fromOpenRouter) return fromOpenRouter;
  }

  const { data, error } = await client.functions.invoke(
    process.env.EMBED_FUNCTION_NAME ?? "gte-small",
    { body: { input: query } }
  );
  if (error) return null;
  return parseEmbedding(data);
}

function rowToChunk(row: SearchRow): KnowledgeChunk {
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

export async function searchSupabase(
  query: string,
  options: { limit: number; kinds?: SourceKind[] }
): Promise<RankedChunk[] | null> {
  const client = createServerSupabaseClient();
  if (!client) return null;

  const embedding = await createQueryEmbedding(client, query);
  const candidateLimit = Math.min(80, Math.max(options.limit * 4, options.limit));
  const { data, error } = await client.rpc("search_chunks_rrf", {
    query_text: query,
    query_embedding: embedding,
    match_count: candidateLimit
  });

  if (error || !Array.isArray(data)) return null;
  const allowedKinds = options.kinds?.length ? new Set(options.kinds) : undefined;

  return (data as SearchRow[])
    .filter((row) => !allowedKinds || allowedKinds.has(row.source_kind))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, options.limit)
    .map((row) => ({ chunk: rowToChunk(row), score: row.score }));
}
