import { z } from "zod";

import { jsonResponse } from "@/src/http";
import { isIngestAuthorized } from "@/src/ingest/auth";
import { ingestLessons } from "@/src/ingest/run-lessons";
import { consumeRateLimit } from "@/src/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 300;

const lessonSchema = z.object({
  id: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  url: z.string().url().max(2_000),
  curriculumPath: z.array(z.string().trim().min(1)).max(20).optional(),
  html: z.string().max(500_000).optional(),
  markdown: z.string().max(500_000).optional(),
  transcript: z.string().max(500_000).optional(),
  videoLink: z.string().url().max(2_000).optional(),
  videoId: z.string().trim().max(200).optional(),
  publish: z.boolean().optional(),
  groupSlug: z.string().trim().max(100).optional(),
  courseId: z.string().trim().max(100).optional()
});

const ingestBodySchema = z.object({
  lessons: z.array(lessonSchema).min(1).max(150)
});

export async function POST(request: Request): Promise<Response> {
  if (!isIngestAuthorized(request)) {
    return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  }

  const identity = request.headers.get("authorization")?.slice(0, 24) ?? "ingest";
  const rateLimit = consumeRateLimit("ingest", identity, 30, 60_000);
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

  const parsed = ingestBodySchema.safeParse(payload);
  if (!parsed.success) {
    return jsonResponse(
      { error: "Invalid ingest payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const result = await ingestLessons(parsed.data.lessons, { fetchMethod: "api" });
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ingestion failed";
    return jsonResponse({ ok: false, error: message }, { status: 500 });
  }
}
