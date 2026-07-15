import { getRequestIdentity, jsonResponse } from "@/lib/http";
import { communityMcpHandler } from "@/lib/community/mcp-handler";
import { consumeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "MCP-Session-Id"
};

async function withCors(request: Request): Promise<Response> {
  const rateLimit = consumeRateLimit("mcp", getRequestIdentity(request), 120);
  if (!rateLimit.allowed) {
    const limited = jsonResponse(
      { error: "Too many MCP requests. Please retry shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
    const headers = new Headers(limited.headers);
    for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
    return new Response(limited.body, { status: limited.status, headers });
  }

  const response = await communityMcpHandler(request);
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export { withCors as GET, withCors as POST, withCors as DELETE };
