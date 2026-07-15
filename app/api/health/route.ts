import { promptLedger } from "@/data/prompts";
import { getCatalog } from "@/lib/catalog";
import { getIngestApiKey } from "@/lib/community/ingest-auth";
import { jsonResponse } from "@/lib/http";
import { isSupabaseSearchConfigured } from "@/lib/search/supabase";
import { createServerSupabaseClient, isSupabaseReadConfigured } from "@community/db/client";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const catalog = getCatalog();
  return jsonResponse({
    status: "ok",
    catalog: { generatedAt: catalog.generatedAt, ...catalog.stats },
    retrieval: {
      local: true,
      supabaseConfigured: isSupabaseSearchConfigured(),
      recommendations: {
        intakeRequired: true,
        sourcePolicy: "full_videos_only",
        timestampPolicy: "exact_timed_cue",
        shorts: "browse_only"
      }
    },
    community: {
      ingestConfigured: Boolean(getIngestApiKey() && createServerSupabaseClient()),
      readConfigured: isSupabaseReadConfigured(),
      ingestPath: "/api/ingest",
      mcpPath: "/mcp/community"
    },
    mcp: {
      endpoint: "/mcp",
      hosts: ["chatgpt", "claude"],
      mode: "read_only_retrieval"
    },
    generation: {
      standalone: "retrieval_only",
      consumerInference: "signed_in_mcp_host",
      modelTokens: "handled_by_chatgpt_or_claude"
    },
    prompts: promptLedger.map(({ id, version }) => ({ id, version })),
    rateLimit: {
      mode: "bounded_in_memory_fallback",
      multiInstanceRequirement: "Configure a shared Redis or KV limiter before horizontal scaling."
    }
  });
}
