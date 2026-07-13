import { describe, expect, it } from "vitest";

import { getCatalog } from "../lib/catalog";
import { encodeEvidenceId } from "../lib/evidence-id";
import { buildMcpFetchDocument, buildMcpSearchResults } from "../lib/mcp-evidence";
import { searchSaminLibrary } from "../lib/search";
import { getSaminEvidence, type EvidenceRecord } from "../lib/source";
import { toCitationSource } from "../lib/citations";
import type { KnowledgeChunk } from "../lib/types";

function makeChunk(index: number): KnowledgeChunk {
  return {
    id: `chunk_${index}`,
    sourceId: "source_long",
    sourceTitle: "A long workshop",
    sourceKind: "video",
    canonicalUrl: "https://www.youtube.com/watch?v=long",
    startMs: index * 60_000,
    endMs: (index + 1) * 60_000,
    text: index === 57 ? "The exact late-chapter evidence." : `Context chapter ${index}.`,
    provenance: "transcript"
  };
}

describe("MCP search-to-fetch evidence integrity", () => {
  it("fetches an exact late search hit instead of truncating to the first chunks", () => {
    const chunks = Array.from({ length: 60 }, (_, index) => makeChunk(index));
    const lateHit = toCitationSource(chunks[57], 12, 0);
    const searchResults = buildMcpSearchResults([lateHit]);
    const record: EvidenceRecord = {
      source: {
        id: "source_long",
        externalId: "long",
        kind: "video",
        title: "A long workshop",
        canonicalUrl: "https://www.youtube.com/watch?v=long",
        transcriptStatus: "indexed",
        segmentCount: chunks.length,
        tags: []
      },
      chunks,
      matchedChunkId: chunks[57].id,
      matchedStartMs: chunks[57].startMs
    };

    const fetched = buildMcpFetchDocument(searchResults[0].id, record);

    expect(searchResults[0].id).toBe(encodeEvidenceId("chunk_57", 57 * 60_000));
    expect(searchResults[0].text).toBe("[57:00] The exact late-chapter evidence.");
    expect(fetched?.id).toBe(searchResults[0].id);
    expect(fetched?.text).toContain("The exact late-chapter evidence.");
    expect(fetched?.text).not.toContain("Context chapter 56.");
    expect(fetched?.text).not.toContain("Context chapter 58.");
    expect(fetched?.text).not.toContain("Context chapter 0.");
    expect(fetched?.metadata.sources).toHaveLength(1);
    expect(fetched?.url).toBe(searchResults[0].url);
  });

  it("keeps legacy chunk IDs compatible with bounded adjacent-chunk fetches", () => {
    const chunks = Array.from({ length: 60 }, (_, index) => makeChunk(index));
    const record: EvidenceRecord = {
      source: {
        id: "source_long",
        externalId: "long",
        kind: "video",
        title: "A long workshop",
        canonicalUrl: "https://www.youtube.com/watch?v=long",
        transcriptStatus: "indexed",
        segmentCount: chunks.length,
        tags: []
      },
      chunks,
      matchedChunkId: chunks[57].id
    };

    const fetched = buildMcpFetchDocument(chunks[57].id, record);

    expect(fetched?.id).toBe("chunk_57");
    expect(fetched?.text).toContain("Context chapter 56.");
    expect(fetched?.text).toContain("The exact late-chapter evidence.");
    expect(fetched?.text).toContain("Context chapter 58.");
    expect(fetched?.metadata.sources).toHaveLength(3);
  });

  it("retains one exact result per distinct source", () => {
    const first = toCitationSource(makeChunk(57), 5, 0);
    const repeatedSource = toCitationSource(makeChunk(58), 4, 1);
    const other = toCitationSource(
      {
        ...makeChunk(3),
        id: "chunk_other",
        sourceId: "source_other",
        sourceTitle: "Another source",
        canonicalUrl: "https://www.youtube.com/watch?v=other"
      },
      3,
      2
    );

    expect(buildMcpSearchResults([first, repeatedSource, other]).map((result) => result.id)).toEqual([
      encodeEvidenceId("chunk_57", 57 * 60_000),
      encodeEvidenceId("chunk_other", 3 * 60_000)
    ]);
  });

  it("rejects Shorts, metadata-only chunks, and non-YouTube videos at the MCP boundary", () => {
    const transcript = toCitationSource(makeChunk(4), 3, 0);
    const short = toCitationSource(
      { ...makeChunk(5), id: "short_chunk", sourceId: "short_source", sourceKind: "short" },
      2,
      1
    );
    const metadata = toCitationSource(
      { ...makeChunk(6), id: "metadata_chunk", sourceId: "metadata_source", provenance: "metadata" },
      1,
      2
    );
    const nonYouTube = toCitationSource(
      {
        ...makeChunk(7),
        id: "external_video_chunk",
        sourceId: "external_video_source",
        canonicalUrl: "https://example.com/video"
      },
      0.5,
      3
    );

    expect(
      buildMcpSearchResults([short, metadata, nonYouTube, transcript]).map((result) => result.id)
    ).toEqual([encodeEvidenceId(transcript.id, transcript.startMs)]);
  });

  it("resolves legacy local chunk and source IDs without an anchored timestamp", async () => {
    const catalog = getCatalog();
    const chunk = catalog.chunks.find(
      (candidate) => candidate.sourceKind === "video" && candidate.provenance === "transcript"
    );
    expect(chunk).toBeDefined();

    const legacyChunk = await getSaminEvidence(chunk!.id);
    const legacySource = await getSaminEvidence(chunk!.sourceId);

    expect(legacyChunk).toMatchObject({ matchedChunkId: chunk!.id });
    expect(legacyChunk?.matchedStartMs).toBeUndefined();
    expect(legacySource?.source.id).toBe(chunk!.sourceId);
    expect(legacySource?.matchedChunkId).toBeUndefined();
    expect(legacySource?.matchedStartMs).toBeUndefined();
  });

  it("anchors What is MCP? to Nl43 at 298960ms and fetches that exact cue context", async () => {
    const search = await searchSaminLibrary("What is MCP?", { limit: 20 });
    const evidence = search.sources.find(
      (source) => source.sourceId === "youtube_Nl43duXzPhM"
    );
    expect(evidence).toBeDefined();
    expect(evidence).toMatchObject({
      id: "chunk_aa2def1fcf35525053",
      startMs: 298_960,
      timestampLabel: "4:58",
      timestampUrl: "https://www.youtube.com/watch?v=Nl43duXzPhM&t=298s"
    });
    expect(evidence!.text).toContain("And an MCP is how Claude connects to the outside world");

    const result = buildMcpSearchResults([evidence!])[0];
    expect(result).toMatchObject({
      id: "a1:chunk_aa2def1fcf35525053:298960",
      url: "https://www.youtube.com/watch?v=Nl43duXzPhM&t=298s"
    });
    expect(result.text).toMatch(/^\[4:58\]/);

    const record = await getSaminEvidence(result.id);
    expect(record).toMatchObject({
      matchedChunkId: "chunk_aa2def1fcf35525053",
      matchedStartMs: 298_960
    });
    const fetched = buildMcpFetchDocument(result.id, record!);

    expect(fetched).toMatchObject({
      id: result.id,
      url: "https://www.youtube.com/watch?v=Nl43duXzPhM&t=298s",
      metadata: {
        sources: [
          {
            citationId: "S1",
            timestampLabel: "4:58",
            url: "https://www.youtube.com/watch?v=Nl43duXzPhM&t=298s"
          }
        ]
      }
    });
    expect(fetched!.text).toMatch(/^\[4:58\]/);
    expect(fetched!.text).toContain("certain tool with MCPs");
    expect(fetched!.text).toContain("And an MCP is how Claude connects to the outside world");
    expect(fetched!.text).toContain("your tools, your apps, your data");
  });
});
