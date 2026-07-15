import { createServerSupabaseClient, isSupabaseReadConfigured } from "@/src/db/client";
import { jsonResponse } from "@/src/http";

export async function GET(): Promise<Response> {
  const readConfigured = isSupabaseReadConfigured();
  const ingestConfigured = Boolean(createServerSupabaseClient());

  return jsonResponse({
    ok: true,
    mode: readConfigured ? "hybrid" : "local-seed",
    supabaseRead: readConfigured,
    supabaseIngest: ingestConfigured
  });
}
