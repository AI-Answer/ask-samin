import { describe, expect, it } from "vitest";

import {
  ATTRIBUTION,
  buildCitationText,
  buildMatchReference,
  buildSnippet,
  formatLocation,
  formatTimestampLabel,
  pickBestResultPerSource,
  selectFetchChunks,
  truncateBody
} from "../src/mcp/reference";
import type { CommunityChunk, SearchResult } from "../src/types";

function searchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "lesson__chunk_0",
    sourceId: "lesson",
    sourceType: "lesson_page",
    sourceTitle: "Welcome",
    canonicalUrl: "https://www.skool.com/claude/classroom/abc",
    curriculumPath: ["Claude Masterclass", "Day 01"],
    content: "Short lesson body",
    score: 1,
    metadata: {},
    matchChunkId: "lesson__chunk_0",
    ...overrides
  };
}

describe("mcp reference helpers", () => {
  it("formats curriculum location and timestamp labels", () => {
    expect(formatLocation(["Claude Masterclass", "Day 01"])).toBe("Claude Masterclass → Day 01");
    expect(formatTimestampLabel(754_000)).toBe("~12:34");
    expect(formatTimestampLabel(3_754_000)).toBe("~1:02:34");
  });

  it("builds short snippets without timestamp prefixes", () => {
    const long = "[12:34] ".concat("word ".repeat(80)).trim();
    const snippet = buildSnippet(long);
    expect(snippet.length).toBeLessThanOrEqual(241);
    expect(snippet.startsWith("[12:34]")).toBe(false);
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("keeps the highest-scoring chunk per source and respects limit", () => {
    const results = pickBestResultPerSource(
      [
        searchResult({ id: "lesson__chunk_0", matchChunkId: "lesson__chunk_0", score: 0.4, content: "weaker" }),
        searchResult({
          id: "lesson__chunk_1",
          matchChunkId: "lesson__chunk_1",
          score: 0.9,
          content: "stronger match"
        }),
        searchResult({ sourceId: "other", id: "other__chunk_0", matchChunkId: "other__chunk_0", score: 0.5 }),
        searchResult({ sourceId: "third", id: "third__chunk_0", matchChunkId: "third__chunk_0", score: 0.2 })
      ],
      2
    );

    expect(results).toHaveLength(2);
    expect(results[0]?.content).toBe("stronger match");
    expect(results[0]?.matchChunkId).toBe("lesson__chunk_1");
  });

  it("demotes Resources companion pages vs teaching lessons", () => {
    const results = pickBestResultPerSource(
      [
        searchResult({
          sourceId: "resources",
          id: "resources__chunk_0",
          matchChunkId: "resources__chunk_0",
          sourceTitle: "🔗 Resources",
          score: 1.0
        }),
        searchResult({
          sourceId: "lesson",
          id: "lesson__chunk_0",
          matchChunkId: "lesson__chunk_0",
          sourceTitle: "📝 Give the bot eyes + a simple strategy",
          score: 0.85
        })
      ],
      2
    );

    expect(results[0]?.sourceId).toBe("lesson");
  });

  it("builds match references with timestamp labels from timed chunks", () => {
    const reference = buildMatchReference({
      chunkId: "lesson__chunk_0",
      curriculumPath: ["Claude Masterclass", "Day 01"],
      startMs: 120_000
    });

    expect(reference.chunkId).toBe("lesson__chunk_0");
    expect(reference.location).toBe("Claude Masterclass → Day 01");
    expect(reference.timestampLabel).toBe("~2:00");
  });

  it("puts Skool URL first in citation text", () => {
    const url = "https://www.skool.com/claude/classroom/lesson";
    const text = buildCitationText({
      title: "MCP Setup",
      url,
      reference: {
        chunkId: "x",
        location: "Claude Masterclass → Day 03",
        timestampLabel: "~5:10"
      },
      body: "Configure the MCP connector."
    });

    expect(text.startsWith(url)).toBe(true);
    expect(text).toContain(`[${ATTRIBUTION}]`);
    expect(text).toContain("Watch around ~5:10");
    expect(text).toContain("Configure the MCP connector.");
    expect(text).toContain(`Open this Skool lesson: ${url}`);
  });

  it("caps fetch bodies and windows around the matched chunk", () => {
    const chunks: CommunityChunk[] = Array.from({ length: 10 }, (_, index) => ({
      id: `lesson__chunk_${index}`,
      sourceId: "lesson",
      chunkIndex: index,
      content: `chunk-${index} ${"x".repeat(100)}`,
      metadata: { timed: true },
      startMs: index * 60_000
    }));

    const selected = selectFetchChunks(chunks[5]!, chunks);
    expect(selected.chunks.map((chunk) => chunk.id)).toEqual([
      "lesson__chunk_3",
      "lesson__chunk_4",
      "lesson__chunk_5",
      "lesson__chunk_6",
      "lesson__chunk_7"
    ]);
    expect(selected.truncated).toBe(true);

    const capped = truncateBody("a".repeat(20_000), 100);
    expect(capped.truncated).toBe(true);
    expect(capped.text).toContain("Truncated");
    expect(capped.text.length).toBeLessThan(20_000);
  });
});
