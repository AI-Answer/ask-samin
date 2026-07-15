import { isIngestAuthorized } from "@/lib/community/ingest-auth";
import { ingestLessonsSchema } from "@/lib/community/ingest-schema";
import { normalizeIngestBody } from "@/lib/community/skool-export";
import { jsonResponse } from "@/lib/http";
import { consumeRateLimit } from "@/lib/rate-limit";
import { ingestLessons } from "@community/ingest/run-lessons";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  if (!isIngestAuthorized(request)) {
    return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  }

  const identity = request.headers.get("authorization")?.slice(0, 24) ?? "ingest";
  const rateLimit = consumeRateLimit("community-ingest", identity, 30, 60_000);
  if (!rateLimit.allowed) {
    return jsonResponse(
      { error: "Too many ingest requests. Please retry shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, { status: 400 });
  }

  const lessons = normalizeIngestBody(payload);
  if (!lessons) {
    return jsonResponse(
      {
        error: "Invalid ingest payload. Expected { lessons: [...] } or skool_ingest.v1 export with pages[]."
      },
      { status: 400 }
    );
  }

  const parsed = ingestLessonsSchema.safeParse(lessons);
  if (!parsed.success) {
    return jsonResponse(
      { error: "Invalid ingest payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const result = await ingestLessons(parsed.data, { fetchMethod: "api" });
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ingestion failed";
    return jsonResponse({ ok: false, error: message }, { status: 500 });
  }
}
