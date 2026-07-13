import { describe, expect, it } from "vitest";

import {
  buildTimestampUrl,
  formatTimestamp,
  rankCitationSources,
  toCitationSource
} from "../lib/citations";
import type { KnowledgeChunk } from "../lib/types";

const chunk: KnowledgeChunk = {
  id: "chunk_exact",
  sourceId: "youtube_exact",
  sourceTitle: "Exact source",
  sourceKind: "video",
  canonicalUrl: "https://www.youtube.com/watch?v=abc123",
  startMs: 65_999,
  endMs: 80_000,
  text: "Verified evidence.",
  provenance: "transcript"
};

describe("citation construction", () => {
  it("assigns stable CitationSource IDs and stored fields", () => {
    const citation = toCitationSource(chunk, 0.75, 0);
    expect(citation).toMatchObject({
      id: "chunk_exact",
      sourceId: "youtube_exact",
      citationId: "S1",
      score: 0.75,
      timestampLabel: "1:05",
      timestampUrl: "https://www.youtube.com/watch?v=abc123&t=65s"
    });
  });

  it("deduplicates chunks without creating gaps in citation IDs", () => {
    const citations = rankCitationSources(
      [
        { chunk, score: 3 },
        { chunk, score: 2 },
        { chunk: { ...chunk, id: "chunk_two", startMs: 3_600_000 }, score: 1 }
      ],
      10
    );
    expect(citations.map((citation) => citation.citationId)).toEqual(["S1", "S2"]);
    expect(citations[1].timestampLabel).toBe("1:00:00");
  });
});

describe("timestamp URLs", () => {
  it("preserves canonical zero-time links", () => {
    const url = "https://www.youtube.com/watch?v=abc123";
    expect(buildTimestampUrl(url, 0)).toBe(url);
  });

  it("adds exact whole-second time parameters to YouTube URLs", () => {
    expect(buildTimestampUrl("https://youtu.be/abc123?si=test", 125_900)).toBe(
      "https://youtu.be/abc123?si=test&t=125s"
    );
  });

  it("uses media fragments for non-YouTube sources", () => {
    expect(buildTimestampUrl("https://example.com/call.mp4", 9_999)).toBe(
      "https://example.com/call.mp4#t=9"
    );
  });

  it("formats timestamps deterministically", () => {
    expect(formatTimestamp(-500)).toBe("0:00");
    expect(formatTimestamp(3_661_000)).toBe("1:01:01");
  });
});
