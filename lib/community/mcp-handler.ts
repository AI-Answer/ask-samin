import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

import {
  buildMcpFetchDocument,
  buildMcpSearchResults,
  flattenCurriculumNodes
} from "@community/mcp/evidence";
import {
  browseCurriculum,
  fetchCommunityEvidence,
  listRecentUpdates,
  searchCommunityKnowledge
} from "@community/search";

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
    sourceType: z.string(),
    curriculumPath: z.array(z.string()),
    whenToUse: z.string().optional(),
    timed: z.boolean()
  })
};

function toolResult<T extends object>(payload: T) {
  const json = JSON.stringify(payload);
  return {
    structuredContent: payload as Record<string, unknown>,
    content: [{ type: "text" as const, text: json }]
  };
}

export const communityMcpHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      "search",
      {
        title: "Search community knowledge",
        description:
          "Hybrid search over published Skool lessons, posts, and transcripts. Returns evidence chunks with canonical URLs.",
        inputSchema: {
          query: z.string().trim().min(1).max(2_000),
          limit: z.number().int().min(1).max(20).default(8),
          source_type: z
            .enum([
              "lesson_page",
              "community_post",
              "call_recording",
              "video",
              "curator_note",
              "resource_link"
            ])
            .optional(),
          curriculum_path: z.string().trim().max(500).optional()
        },
        outputSchema: searchOutputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
      },
      async ({ query, limit, source_type, curriculum_path }) => {
        const search = await searchCommunityKnowledge(query, {
          limit,
          sourceType: source_type,
          curriculumPath: curriculum_path
        });
        return toolResult({ results: buildMcpSearchResults(search.results) });
      }
    );

    server.registerTool(
      "fetch",
      {
        title: "Fetch community evidence",
        description: "Fetch the matched chunk plus nearby context from the same source.",
        inputSchema: { id: z.string().trim().min(1).max(200) },
        outputSchema: fetchOutputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
      },
      async ({ id }) => {
        const record = await fetchCommunityEvidence(id);
        if (!record) throw new Error("Evidence not found.");
        return toolResult(buildMcpFetchDocument(record));
      }
    );

    server.registerTool(
      "browse_curriculum",
      {
        title: "Browse curriculum tree",
        description: "Navigate the course curriculum tree by parent node id (omit for roots).",
        inputSchema: { parent_id: z.string().trim().max(200).nullable().optional() },
        outputSchema: {
          nodes: z.array(
            z.object({
              id: z.string(),
              title: z.string(),
              slug: z.string(),
              nodeType: z.string(),
              sourceId: z.string().optional()
            })
          )
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
      },
      async ({ parent_id }) => {
        const nodes = await browseCurriculum(parent_id ?? null);
        return toolResult({ nodes: flattenCurriculumNodes(nodes) });
      }
    );

    server.registerTool(
      "list_recent_updates",
      {
        title: "List recent published updates",
        description: "Recently updated published sources, newest first.",
        inputSchema: { limit: z.number().int().min(1).max(50).default(10) },
        outputSchema: {
          updates: z.array(
            z.object({
              id: z.string(),
              title: z.string(),
              sourceType: z.string(),
              canonicalUrl: httpUrlOutputSchema,
              updatedAt: z.string(),
              curriculumPath: z.array(z.string())
            })
          )
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
      },
      async ({ limit }) => toolResult({ updates: await listRecentUpdates(limit) })
    );
  },
  { serverInfo: { name: "ask-samin", version: "1.0.0" } },
  { maxDuration: 60, verboseLogs: false, disableSse: true, streamableHttpEndpoint: "/mcp" }
);
