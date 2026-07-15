import { describe, expect, it } from "vitest";

import { chunkMarkdown, htmlToMarkdown } from "../src/chunking/markdown";
import { normalizeLesson } from "../src/ingest/normalize";
import { buildMcpSearchResults } from "../src/mcp/evidence";
import { searchCommunityKnowledge } from "../src/search";

describe("community-knowledge core", () => {
  it("normalizes html lessons into markdown chunks", () => {
    const normalized = normalizeLesson({
      id: "demo",
      title: "Demo",
      canonicalUrl: "https://example.com/demo",
      curriculumPath: ["Module"],
      html: "<h1>Title</h1><p>Body text</p>"
    });

    expect(normalized.chunks.length).toBeGreaterThan(0);
    expect(normalized.source.bodyMarkdown).toContain("Title");
  });

  it("chunks markdown by headings", () => {
    const chunks = chunkMarkdown("# One\n\nAlpha\n\n## Two\n\nBeta");
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("converts basic html to markdown", () => {
    expect(htmlToMarkdown("<p>Hello <strong>world</strong></p>")).toContain("Hello");
  });

  it("finds MCP setup content from seed catalog", async () => {
    const search = await searchCommunityKnowledge("MCP connector Claude", { limit: 5 });
    expect(search.results.length).toBeGreaterThan(0);
    const mcpResults = buildMcpSearchResults(search.results);
    expect(mcpResults.some((result) => /mcp/i.test(result.text))).toBe(true);
  });
});
