import { describe, expect, it } from "vitest";

import { decodeEvidenceId, encodeEvidenceId } from "../lib/evidence-id";

describe("anchored MCP evidence IDs", () => {
  it("round-trips reserved and Unicode chunk ID characters", () => {
    const id = encodeEvidenceId("chunk: workshop/日本語 1", 298_960);

    expect(id).toBe("a1:chunk%3A%20workshop%2F%E6%97%A5%E6%9C%AC%E8%AA%9E%201:298960");
    expect(decodeEvidenceId(id)).toEqual({
      chunkId: "chunk: workshop/日本語 1",
      startMs: 298_960
    });
  });

  it("falls back to the legacy chunk ID when encoding cannot anchor safely", () => {
    expect(encodeEvidenceId("chunk_legacy", -1)).toBe("chunk_legacy");
    expect(encodeEvidenceId("chunk_legacy", 1.5)).toBe("chunk_legacy");
    expect(encodeEvidenceId("", 10)).toBe("");
  });

  it.each([
    "chunk_legacy",
    "a1::100",
    "a1:chunk:-1",
    "a1:chunk:1.5",
    "a1:chunk:9007199254740992",
    "a1:%E0%A4%A:100",
    "a1:chunk:100:extra"
  ])("rejects invalid or legacy input without mis-decoding it: %s", (value) => {
    expect(decodeEvidenceId(value)).toBeNull();
  });
});
