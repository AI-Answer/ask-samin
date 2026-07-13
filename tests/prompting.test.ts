import { describe, expect, it } from "vitest";

import { buildRetrievalOnlyAnswer, validateGeneratedAnswer } from "../lib/prompting";
import { toCitationSource } from "../lib/citations";

const source = toCitationSource(
  {
    id: "chunk_prompt",
    sourceId: "source_prompt",
    sourceTitle: "Prompt source",
    sourceKind: "video",
    canonicalUrl: "https://www.youtube.com/watch?v=prompt",
    startMs: 12_000,
    endMs: 20_000,
    text: "Evidence text.",
    provenance: "transcript"
  },
  1,
  0
);

describe("prompt and citation enforcement", () => {
  it("uses the exact transparent first-answer opener in retrieval-only mode", () => {
    expect(buildRetrievalOnlyAnswer([source], true)).toMatch(
      /^Hey this is Samin helping you build these things\. I’m an AI guide grounded in Samin’s verified source library, not Samin himself\./
    );
  });

  it("rejects generated answers with unknown labels or URLs", () => {
    expect(
      validateGeneratedAnswer(
        "Hey this is Samin helping you build these things. I’m an AI guide grounded in Samin’s library, not Samin. Use this [S2].",
        [source],
        true
      )
    ).toEqual({ valid: false, reason: "unknown_citation" });

    expect(
      validateGeneratedAnswer(
        "Hey this is Samin helping you build these things. I’m an AI guide grounded in Samin’s library, not Samin. Use this [S1] https://example.com/invented",
        [source],
        true
      )
    ).toEqual({ valid: false, reason: "unknown_url" });
  });

  it("rejects first answers that omit the AI-guide disclosure", () => {
    expect(
      validateGeneratedAnswer(
        "Hey this is Samin helping you build these things. Here is the result [S1].",
        [source],
        true
      )
    ).toEqual({ valid: false, reason: "missing_ai_disclosure" });
  });
});
