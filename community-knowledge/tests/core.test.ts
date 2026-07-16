import { describe, expect, it } from "vitest";

import { isIngestAuthorized } from "../src/ingest/auth";
import { chunkMarkdown, htmlToMarkdown } from "../src/chunking/markdown";
import { buildCurriculumNodes } from "../src/ingest/curriculum-sync";
import { inferPageKind } from "../src/ingest/page-kind";
import { normalizeLesson } from "../src/ingest/normalize";
import { parseSourceAssets } from "../src/ingest/source-assets";
import { buildMcpFetchDocument, buildMcpSearchResults } from "../src/mcp/evidence";

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
    expect(normalized.curriculumNodes.length).toBe(1);
  });

  it("creates catalog chunks for asset-only vault pages", () => {
    const normalized = normalizeLesson({
      id: "playwright-skill",
      title: "Playwright Skill",
      canonicalUrl: "https://www.skool.com/claude/classroom/abc",
      curriculumPath: ["Claude Skills Vault", "WEB SKILLS"],
      summary: "Browser automation skill pack",
      resources: [{ type: "zip", file_id: "file-1", file_name: "playwright.zip" }]
    });

    expect(normalized.chunks).toHaveLength(1);
    expect(normalized.chunks[0]?.content).toContain("Location:");
    expect(normalized.chunks[0]?.content).toContain("playwright.zip");
    expect(normalized.source.pageKind).toBe("skill_card");
    expect(normalized.sourceAssets[0]?.assetType).toBe("zip");
  });

  it("builds curriculum nodes from path prefixes", () => {
    const nodes = buildCurriculumNodes({
      sourceId: "lesson-1",
      title: "Playwright Skill",
      curriculumPath: ["Claude Skills Vault", "WEB SKILLS"],
      groupSlug: "claude",
      courseId: "64307591",
      externalId: "lesson-1"
    });

    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.nodeType).toBe("course");
    expect(nodes[1]?.nodeType).toBe("lesson");
    expect(nodes[1]?.sourceId).toBe("lesson-1");
  });

  it("infers page kinds from export hints", () => {
    expect(
      inferPageKind({
        pageType: "skill_card",
        bodyLength: 0,
        hasZip: true,
        hasGithub: false,
        hasTranscript: false
      })
    ).toBe("skill_card");
    expect(
      inferPageKind({
        bodyLength: 50,
        hasZip: false,
        hasGithub: true,
        hasTranscript: false
      })
    ).toBe("asset_pointer");
  });

  it("parses github assets from resources", () => {
    const assets = parseSourceAssets({
      sourceId: "demo",
      resources: [{ url: "https://github.com/org/repo" }]
    });
    expect(assets[0]?.assetType).toBe("github");
  });

  it("chunks markdown by headings", () => {
    const chunks = chunkMarkdown("# One\n\nAlpha\n\n## Two\n\nBeta");
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("converts basic html to markdown", () => {
    expect(htmlToMarkdown("<p>Hello <strong>world</strong></p>")).toContain("Hello");
  });

  it("builds search results as citation text with Skool URL", () => {
    const mcpResults = buildMcpSearchResults([
      {
        id: "lesson__chunk_2",
        sourceId: "lesson",
        sourceType: "video",
        sourceTitle: "MCP Setup",
        canonicalUrl: "https://www.skool.com/claude/classroom/lesson",
        curriculumPath: ["Claude Masterclass", "Day 03"],
        content: "[05:10] ".concat("Configure the MCP connector in Claude Desktop. ".repeat(20)).trim(),
        score: 0.95,
        metadata: { timed: true },
        matchChunkId: "lesson__chunk_2",
        startMs: 310_000
      }
    ]);

    expect(mcpResults[0]?.snippet.length).toBeLessThanOrEqual(241);
    expect(mcpResults[0]?.reference.location).toBe("Claude Masterclass → Day 03");
    expect(mcpResults[0]?.reference.timestampLabel).toBe("~5:10");
    expect(mcpResults[0]?.url).toContain("skool.com");
    expect(mcpResults[0]?.text).toContain("https://www.skool.com/claude/classroom/lesson");
    expect(mcpResults[0]?.text).toContain("Samin Yasar / Claude Club");
    expect(mcpResults[0]?.attribution).toBe("Samin Yasar / Claude Club");
  });

  it("builds fetch documents with assets and full text metadata", () => {
    const normalized = normalizeLesson({
      id: "vault-page",
      title: "Vault Page",
      canonicalUrl: "https://example.com/vault",
      curriculumPath: ["Vault", "Web"],
      resources: [{ file_name: "tool.zip", type: "zip" }]
    });
    const fetched = buildMcpFetchDocument({
      id: normalized.source.id,
      source: {
        ...normalized.source,
        visibility: "published",
        extractionStatus: "indexed",
        extractedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      chunk: normalized.chunks[0]!,
      nearbyChunks: normalized.chunks,
      assets: normalized.sourceAssets
    });

    expect(fetched.sourceId).toBe("vault-page");
    expect(fetched.assets[0]?.fileName).toBe("tool.zip");
    expect(fetched.reference.location).toBe("Vault → Web");
    expect(fetched.text).toContain("https://example.com/vault");
    expect(fetched.metadata.chunkCount).toBe(1);
    expect(fetched.metadata.truncated).toBe(false);
  });
});

describe("ingest auth", () => {
  it("accepts matching bearer token", () => {
    process.env.INGEST_API_KEY = "test-secret";
    const request = new Request("http://localhost/api/ingest", {
      headers: { authorization: "Bearer test-secret" }
    });
    expect(isIngestAuthorized(request)).toBe(true);
    delete process.env.INGEST_API_KEY;
  });

  it("rejects missing or wrong token", () => {
    process.env.INGEST_API_KEY = "test-secret";
    expect(
      isIngestAuthorized(
        new Request("http://localhost/api/ingest", {
          headers: { authorization: "Bearer wrong" }
        })
      )
    ).toBe(false);
    expect(isIngestAuthorized(new Request("http://localhost/api/ingest"))).toBe(false);
    delete process.env.INGEST_API_KEY;
  });
});
