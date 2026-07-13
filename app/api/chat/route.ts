import {
  answerFromSaminLibrary,
  buildBoundedRecommendationQuery,
  buildStandaloneIntakeResult,
  hasPriorAssistantIntake
} from "@/lib/chat";
import { checkSameOriginJsonRequest, getRequestIdentity, jsonResponse } from "@/lib/http";
import { consumeRateLimit } from "@/lib/rate-limit";
import { searchSaminLibrary } from "@/lib/search";
import { chatRequestSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const requestCheck = checkSameOriginJsonRequest(request);
  if (!requestCheck.ok) {
    return jsonResponse(
      { error: requestCheck.message },
      { status: requestCheck.status ?? 400 }
    );
  }

  const identity = getRequestIdentity(request);
  const rateLimit = consumeRateLimit("chat", identity, 20);
  if (!rateLimit.allowed) {
    return jsonResponse(
      { error: "Too many chat requests. Please retry shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ error: "Invalid chat request." }, { status: 400 });
  }

  const messages = parsed.data.messages ?? [];
  if (!hasPriorAssistantIntake(messages)) {
    return jsonResponse(buildStandaloneIntakeResult());
  }

  const recommendationQuery = buildBoundedRecommendationQuery(parsed.data.query, messages);
  const search = await searchSaminLibrary(recommendationQuery, { limit: 10 });
  const answer = await answerFromSaminLibrary({
    query: recommendationQuery,
    messages,
    sources: search.sources.slice(0, 10)
  });
  return jsonResponse(answer);
}
