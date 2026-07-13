import { checkSameOriginJsonRequest, getRequestIdentity, jsonResponse } from "@/lib/http";
import { consumeRateLimit } from "@/lib/rate-limit";
import { searchSaminLibrary } from "@/lib/search";
import { searchRequestSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const requestCheck = checkSameOriginJsonRequest(request);
  if (!requestCheck.ok) {
    return jsonResponse(
      { error: requestCheck.message },
      { status: requestCheck.status ?? 400 }
    );
  }

  const identity = getRequestIdentity(request);
  const rateLimit = consumeRateLimit("search", identity, 60);
  if (!rateLimit.allowed) {
    return jsonResponse(
      { error: "Too many search requests. Please retry shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = searchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ error: "Invalid search request." }, { status: 400 });
  }

  const result = await searchSaminLibrary(parsed.data.query, {
    ...(parsed.data.limit ? { limit: parsed.data.limit } : {}),
    ...(parsed.data.kinds ? { kinds: parsed.data.kinds } : {})
  });
  return jsonResponse(result);
}
