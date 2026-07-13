import { describe, expect, it } from "vitest";

import { getMcpFetchToolDescription, getMcpSearchToolDescription } from "../lib/mcp-contract";

describe("MCP intake-first recommendation contract", () => {
  it("forbids first-turn retrieval and asks for all four intake fields", () => {
    const description = getMcpSearchToolDescription();

    expect(description).toContain("On the first turn, do not call search or fetch");
    expect(description).toContain("goal or desired outcome");
    expect(description).toContain("idea, testing, or running");
    expect(description).toContain("tools they already use");
    expect(description).toContain("main blocker");
  });

  it("requires exact fetch evidence before a tailored recommendation", () => {
    const description = getMcpFetchToolDescription();

    expect(description).toContain("Before recommending any result, call fetch");
    expect(description).toContain("full-length videos backed by timed transcript evidence");
    expect(description).toContain("exact timestamp, concise transcript context");
    expect(description).toContain("specific reason it fits");
    expect(description).toContain("Never recommend from a search snippet alone");
  });
});
