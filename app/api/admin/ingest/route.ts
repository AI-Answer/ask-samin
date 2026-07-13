import { timingSafeEqual } from "node:crypto";

import {
  type AdminIngestPayload,
  normalizeSimpleIngest,
  persistIngest,
  previewIngest
} from "@/lib/admin-ingest";
import { checkSameOriginJsonRequest, getRequestIdentity, jsonResponse } from "@/lib/http";
import { consumeRateLimit } from "@/lib/rate-limit";
import { adminIngestRequestSchema, simpleAdminIngestRequestSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

function tokenMatches(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(receivedBuffer, expectedBuffer);
}

export async function POST(request: Request): Promise<Response> {
  const requestCheck = checkSameOriginJsonRequest(request);
  if (!requestCheck.ok) {
    return jsonResponse(
      { error: requestCheck.message },
      { status: requestCheck.status ?? 400 }
    );
  }

  const configuredToken = process.env.ADMIN_INGEST_TOKEN;
  if (!configuredToken) {
    return jsonResponse({ error: "Admin ingestion is not configured." }, { status: 503 });
  }

  const rateLimit = consumeRateLimit("admin-ingest", getRequestIdentity(request), 10);
  if (!rateLimit.allowed) {
    return jsonResponse(
      { error: "Too many ingestion requests. Please retry shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  if (Buffer.byteLength(configuredToken, "utf8") < 32) {
    return jsonResponse(
      { error: "Admin ingestion token configuration is invalid." },
      { status: 503 }
    );
  }
  const authorization = request.headers.get("authorization") ?? "";
  const receivedToken = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : request.headers.get("x-admin-token") ?? "";
  if (!tokenMatches(receivedToken, configuredToken)) {
    return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, { status: 400 });
  }

  const simpleParsed = simpleAdminIngestRequestSchema.safeParse(body);
  const bulkParsed = simpleParsed.success ? undefined : adminIngestRequestSchema.safeParse(body);
  if (!simpleParsed.success && !bulkParsed?.success) {
    return jsonResponse({ error: "Invalid ingestion payload." }, { status: 400 });
  }

  let payload: AdminIngestPayload;
  if (simpleParsed.success) {
    payload = normalizeSimpleIngest(simpleParsed.data);
  } else if (bulkParsed?.success) {
    payload = bulkParsed.data;
  } else {
    return jsonResponse({ error: "Invalid ingestion payload." }, { status: 400 });
  }

  const preview = previewIngest(payload);
  const source = payload.sources[0];
  if (payload.mode === "preview") {
    return jsonResponse({
      status: "preview",
      message: `Validated ${preview.counts.sources} source and ${preview.counts.chunks} normalized chunks. Nothing was saved.`,
      source,
      chunks: payload.chunks,
      preview
    });
  }
  if (!preview.valid) {
    return jsonResponse(
      { status: "unavailable", message: "Ingestion validation failed.", error: "Ingestion validation failed.", preview },
      { status: 422 }
    );
  }

  try {
    const persisted = await persistIngest(payload);
    return jsonResponse(
      {
        status: "persisted",
        message: `Saved ${preview.counts.sources} source and ${preview.counts.chunks} chunks.`,
        source,
        chunks: payload.chunks,
        ...persisted
      },
      { status: 201 }
    );
  } catch {
    return jsonResponse(
      {
        status: "unavailable",
        message: "The knowledge store is not configured or unavailable; no content was saved.",
        error: "Ingestion persistence failed.",
        source,
        chunks: payload.chunks
      },
      { status: 503 }
    );
  }
}
