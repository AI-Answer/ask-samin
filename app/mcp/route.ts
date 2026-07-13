import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

import { getRequestIdentity, jsonResponse } from "@/lib/http";
import { getMcpFetchToolDescription, getMcpSearchToolDescription } from "@/lib/mcp-contract";
import { buildMcpFetchDocument, buildMcpSearchResults } from "@/lib/mcp-evidence";
import { consumeRateLimit } from "@/lib/rate-limit";
import { searchSaminLibrary } from "@/lib/search";
import { getSaminEvidence } from "@/lib/source";

export const runtime = "nodejs";
export const maxDuration = 60;

const searchToolDescription = getMcpSearchToolDescription();
const fetchToolDescription = getMcpFetchToolDescription();

const httpUrlOutputSchema = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
});

const searchOutputSchema = {
  results: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      text: z.string(),
      url: httpUrlOutputSchema
    })
  )
};

const fetchOutputSchema = {
  id: z.string(),
  title: z.string(),
  text: z.string(),
  url: httpUrlOutputSchema,
  metadata: z.object({
    kind: z.string(),
    transcriptStatus: z.string(),
    sources: z.array(
      z.object({
        citationId: z.string(),
        timestampLabel: z.string(),
        url: httpUrlOutputSchema
      })
    )
  })
};

function toolResult<T extends object>(payload: T) {
  const json = JSON.stringify(payload);
  return {
    structuredContent: payload as Record<string, unknown>,
    content: [{ type: "text" as const, text: json }]
  };
}

async function runSearch(query: string) {
  const search = await searchSaminLibrary(query, { limit: 10 });
  return { results: buildMcpSearchResults(search.sources) };
}

async function runFetch(id: string) {
  const record = await getSaminEvidence(id);
  const document = record ? buildMcpFetchDocument(id, record) : null;
  if (!document) {
    throw new Error("Source not found.");
  }
  return document;
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "search",
      {
        title: "Search Samin's source library",
        description: searchToolDescription,
        inputSchema: { query: z.string().trim().min(1).max(2_000) },
        outputSchema: searchOutputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
      },
      async ({ query }) => toolResult(await runSearch(query))
    );

    server.registerTool(
      "fetch",
      {
        title: "Fetch a Samin library source",
        description: fetchToolDescription,
        inputSchema: { id: z.string().trim().min(1).max(200) },
        outputSchema: fetchOutputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
      },
      async ({ id }) => toolResult(await runFetch(id))
    );

    server.registerTool(
      "search_samin_library",
      {
        title: "Search Samin's library",
        description: searchToolDescription,
        inputSchema: {
          query: z.string().trim().min(1).max(2_000),
          limit: z.number().int().min(1).max(20).default(10)
        },
        outputSchema: searchOutputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
      },
      async ({ query, limit }) => {
        const payload = await runSearch(query);
        return toolResult({ results: payload.results.slice(0, limit) });
      }
    );

    server.registerTool(
      "get_samin_source",
      {
        title: "Get a Samin source",
        description: fetchToolDescription,
        inputSchema: { id: z.string().trim().min(1).max(200) },
        outputSchema: fetchOutputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
      },
      async ({ id }) => toolResult(await runFetch(id))
    );
  },
  { serverInfo: { name: "ask-samin-library", version: "1.0.0" } },
  { maxDuration: 60, verboseLogs: false, disableSse: true }
);

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
  const response = await handler(request);
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export { withCors as GET, withCors as POST, withCors as DELETE };
