import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getCatalog } from "../lib/catalog";
import { isEligibleRecommendationChunk } from "../lib/recommendation-eligibility";
import { fuseRankedSources, searchSaminLibrary } from "../lib/search";
import type { KnowledgeChunk } from "../lib/types";

const originalSupabaseUrl = process.env.SUPABASE_URL;
const originalPublicSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterEach(() => {
  if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalSupabaseUrl;
  if (originalPublicSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalPublicSupabaseUrl;
  if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
});

describe("deterministic local search", () => {
  it("returns the same ranked citations for the same query", async () => {
    const catalog = getCatalog();
    const target = catalog.sources.find(
      (source) => source.kind === "video" && source.title.split(/\s+/).length >= 3
    );
    expect(target).toBeDefined();

    const first = await searchSaminLibrary(target!.title, { limit: 5 });
    const second = await searchSaminLibrary(target!.title, { limit: 5 });

    expect(first.mode).toBe("local");
    expect(second).toEqual(first);
    expect(first.sources[0].sourceId).toBe(target!.id);
    expect(first.sources.map((source) => source.citationId)).toEqual(
      first.sources.map((_, index) => `S${index + 1}`)
    );
  });

  it("cannot be bypassed by explicitly requesting Shorts", async () => {
    const catalog = getCatalog();
    const target = catalog.sources.find((source) => source.kind === "short");
    expect(target).toBeDefined();

    const result = await searchSaminLibrary(target!.title, { limit: 10, kinds: ["short"] });
    expect(result.sources).toEqual([]);
    expect(catalog.sources.some((source) => source.kind === "short")).toBe(true);
  });

  it("returns only full videos with exact timed transcript evidence", async () => {
    const result = await searchSaminLibrary("Claude Code workflows", { limit: 20 });

    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.sources.every(isEligibleRecommendationChunk)).toBe(true);
    expect(result.sources.every((source) => source.sourceKind === "video")).toBe(true);
    expect(
      result.sources.every(
        (source) => source.provenance === "transcript" || source.provenance === "creator_export"
      )
    ).toBe(true);
  });

  it("never promotes metadata-only records", async () => {
    const catalog = getCatalog();
    const metadataOnly = catalog.sources.find((source) => source.transcriptStatus === "metadata_only");
    expect(metadataOnly).toBeDefined();

    const result = await searchSaminLibrary(metadataOnly!.title, { limit: 20 });
    expect(result.sources.every(isEligibleRecommendationChunk)).toBe(true);
    expect(result.sources.map((source) => source.sourceId)).not.toContain(metadataOnly!.id);
  });

  it("returns distinct source recommendations instead of repeated chunks from one video", async () => {
    const result = await searchSaminLibrary("Claude Code workflows", { limit: 8 });
    const sourceIds = result.sources.map((source) => source.sourceId);

    expect(new Set(sourceIds).size).toBe(sourceIds.length);
  });

  it.each([
    {
      query: "What is MCP?",
      expectedChunkIds: [
        "chunk_aa2def1fcf35525053",
        "chunk_df5f29c725dfb1c69d"
      ]
    },
    {
      query: "How do I connect or add an MCP in Claude Desktop?",
      expectedChunkIds: ["chunk_f2fbb70dfca2c0fa04"]
    },
    {
      query: "How do I install an MCP in Claude Code?",
      expectedChunkIds: [
        "chunk_a9f629762d3da1766f",
        "chunk_1a8eb8cd8d63e33d0b"
      ]
    }
  ])("ranks verified full-video evidence in the top three for: $query", async ({ query, expectedChunkIds }) => {
    const result = await searchSaminLibrary(query, { limit: 3, kinds: ["video"] });
    const topThreeChunkIds = result.sources.map((source) => source.id);

    expect(result.sources).toHaveLength(3);
    expect(result.sources.every((source) => source.sourceKind === "video")).toBe(true);
    expect(result.sources.some((source) => source.sourceKind === "short")).toBe(false);
    for (const chunkId of expectedChunkIds) {
      expect(topThreeChunkIds).toContain(chunkId);
    }
  });

  it("covers both the definition and the Claude connector step after intake", async () => {
    const result = await searchSaminLibrary(
      "Goal: understand MCP and connect it in Claude\n" +
        "Context and refinements:\n" +
        "Stage: idea\n" +
        "Tools: Claude Desktop\n" +
        "Blocker: I do not know what MCP is or where to add it",
      { limit: 3, kinds: ["video"] }
    );

    expect(result.sources).toHaveLength(3);
    expect(result.sources[0]).toMatchObject({
      id: "chunk_df5f29c725dfb1c69d",
      startMs: 1_730_040,
      timestampLabel: "28:50"
    });
    expect(result.sources[0].text.toLocaleLowerCase()).toContain("model context protocol");
    expect(
      result.sources.some((source) =>
        /\b(?:add custom connector|manage connectors)\b/i.test(source.text)
      )
    ).toBe(true);
    expect(result.sources.every((source) => source.sourceKind === "video")).toBe(true);
  });

  it("does not recommend duplicate uploads with the same normalized title", async () => {
    const result = await searchSaminLibrary("build AI receptionist", { limit: 8 });
    const titles = result.sources.map((source) =>
      source.sourceTitle.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase()
    );

    expect(new Set(titles).size).toBe(titles.length);
  });

  it("returns a bounded empty result for blank internal queries", async () => {
    await expect(searchSaminLibrary("   ", { limit: 100 })).resolves.toEqual({
      query: "",
      mode: "local",
      sources: []
    });
  });
});

describe("hybrid rank fusion", () => {
  const chunk = (id: string, sourceId: string): KnowledgeChunk => ({
    id,
    sourceId,
    sourceTitle: sourceId,
    sourceKind: "video",
    canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
    startMs: 0,
    endMs: 1_000,
    text: id,
    provenance: "transcript"
  });

  it("keeps complete-catalog matches when a sparse remote store returns a hit", () => {
    const localOnly = chunk("local", "source_local");
    const sharedLocal = chunk("shared-local", "source_shared");
    const sharedRemote = chunk("shared-remote", "source_shared");
    const remoteOnly = chunk("remote", "source_remote");
    const remoteShort = {
      ...chunk("remote-short", "source_remote_short"),
      sourceKind: "short" as const
    };
    const remoteMetadata = {
      ...chunk("remote-metadata", "source_remote_metadata"),
      provenance: "metadata" as const
    };

    const fused = fuseRankedSources(
      [
        [
          { chunk: sharedLocal, score: 10 },
          { chunk: localOnly, score: 9 }
        ],
        [
          { chunk: remoteShort, score: 1.1 },
          { chunk: remoteMetadata, score: 1 },
          { chunk: sharedRemote, score: 0.9 },
          { chunk: remoteOnly, score: 0.8 }
        ]
      ],
      10
    );

    expect(fused.map((result) => result.chunk.sourceId)).toEqual([
      "source_shared",
      "source_local",
      "source_remote"
    ]);
  });
});
