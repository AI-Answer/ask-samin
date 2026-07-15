import { isSupabaseReadConfigured } from "@/src/db/client";
import { jsonResponse } from "@/src/http";

export async function GET(): Promise<Response> {
  return jsonResponse({
    ok: true,
    mode: isSupabaseReadConfigured() ? "hybrid" : "local-seed"
  });
}
