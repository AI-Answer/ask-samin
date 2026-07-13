import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as chatPost } from "../app/api/chat/route";
import { POST as searchPost } from "../app/api/search/route";
import { buildBoundedRecommendationQuery } from "../lib/chat";
import { isEligibleRecommendationChunk } from "../lib/recommendation-eligibility";

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

function request(path: string, body: unknown, identity: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "x-forwarded-for": identity
    },
    body: JSON.stringify(body)
  });
}

describe("public recommendation APIs", () => {
  it("returns intake without sources on a direct first-turn /api/chat call", async () => {
    const response = await chatPost(
      request("/api/chat", { query: "What should I build with Claude Code?" }, "chat-intake-first")
    );
    const payload = (await response.json()) as {
      answer: string;
      sources: unknown[];
      mode: string;
      notice: string;
    };

    expect(response.status).toBe(200);
    expect(payload.mode).toBe("retrieval_only");
    expect(payload.sources).toEqual([]);
    expect(payload.answer).toContain("Goal");
    expect(payload.answer).toContain("Current stage");
    expect(payload.answer).toContain("Tools");
    expect(payload.answer).toContain("Blocker");
    expect(payload.notice).toContain("No search was run");
  });

  it("keeps the first goal and newest intake context inside the query bound", () => {
    const query = buildBoundedRecommendationQuery("latest refinement", [
      { role: "user", content: "Automate client follow-up" },
      { role: "assistant", content: "What are your goal, stage, tools, and blocker?" },
      { role: "user", content: `Testing with Claude. ${"older context ".repeat(180)}` },
      { role: "assistant", content: "What changed?" },
      { role: "user", content: "My newest blocker is getting reliable CRM writes." }
    ]);

    expect(query.length).toBeLessThanOrEqual(2_000);
    expect(query).toContain("Goal: Automate client follow-up");
    expect(query).toContain("My newest blocker is getting reliable CRM writes.");
    expect(query).toContain("latest refinement");
  });

  it("does not let /api/search return Shorts even through a kind override", async () => {
    const response = await searchPost(
      request("/api/search", { query: "AI", kinds: ["short"], limit: 20 }, "search-no-shorts")
    );
    const payload = (await response.json()) as { sources: unknown[] };

    expect(response.status).toBe(200);
    expect(payload.sources).toEqual([]);
  });

  it("gives /api/chat only timed full-video transcript context", async () => {
    const response = await chatPost(
      request(
        "/api/chat",
        {
          query: "Claude Code workflows",
          messages: [
            { role: "user", content: "I want to automate a workflow." },
            { role: "assistant", content: "What stage, tools, and blocker?" },
            { role: "user", content: "Testing, Claude Code, and setup is my blocker." }
          ]
        },
        "chat-no-shorts"
      )
    );
    const payload = (await response.json()) as {
      sources: Array<Parameters<typeof isEligibleRecommendationChunk>[0] & {
        sourceKind: string;
        timestampLabel: string;
        text: string;
      }>;
    };

    expect(response.status).toBe(200);
    expect(payload.sources.length).toBeGreaterThan(0);
    expect(payload.sources.every(isEligibleRecommendationChunk)).toBe(true);
    expect(payload.sources.every((source) => source.sourceKind === "video")).toBe(true);
    expect(payload.sources.every((source) => /^\d+(?::\d{2}){1,2}$/.test(source.timestampLabel))).toBe(
      true
    );
    expect(payload.sources.every((source) => source.text.trim().length > 0)).toBe(true);
  });
});
