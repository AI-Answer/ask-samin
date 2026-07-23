import { describe, expect, it } from "vitest";

import { enrichmentToLesson } from "../src/calls/enrich";
import { applyCallGlossary } from "../src/calls/glossary";
import { callEnrichmentSchema } from "../src/calls/schema";
import { lessonSchema } from "../../lib/community/ingest-schema";

describe("call glossary", () => {
  it("repairs known ASR mishearings before any LLM step", () => {
    const input =
      "salmon said use cloud code with hermese and mcp, then chat gpt via open ai on skool, plus hicks filled";
    const result = applyCallGlossary(input);

    expect(result.text).toContain("Samin");
    expect(result.text).toContain("Claude Code");
    expect(result.text).toContain("Hermes");
    expect(result.text).toContain("MCP");
    expect(result.text).toContain("ChatGPT");
    expect(result.text).toContain("OpenAI");
    expect(result.text).toContain("Skool");
    expect(result.text).toContain("Higgsfield");
    expect(result.replacements.length).toBeGreaterThan(0);
  });
});

describe("call enrichment → ingest lesson", () => {
  it("builds a call_recording lesson that passes ingest schema", () => {
    const enrichment = callEnrichmentSchema.parse({
      callSummary: "Samin walked through Hermes scheduled tasks and answered MCP setup questions.",
      topics: ["Hermes", "MCP", "scheduled tasks"],
      segments: [
        {
          kind: "qa",
          title: "MCP on a VPS",
          question: "How do I keep MCP connected on a VPS?",
          answer: "Samin showed running Claude Code with the Ask Samin MCP connector enabled.",
          tools: ["Claude Code", "MCP"],
          whenToUse: "when a member asks about MCP on a server",
          timestampLabel: "~12:40"
        },
        {
          kind: "demo",
          title: "Hermes scheduled tasks",
          answer: "He opened Hermes and showed creating a scheduled task for weekly review.",
          tools: ["Hermes", "scheduled tasks"],
          whenToUse: "when a member asks how Samin schedules Hermes jobs"
        },
        {
          kind: "skip",
          title: "Hello",
          skipReason: "chitchat"
        }
      ]
    });

    const lesson = enrichmentToLesson(
      {
        id: "call-2026-07-15",
        title: "Community Call — Jul 15",
        url: "https://www.skool.com/claude/classroom/example",
        transcript: "unused here",
        callDate: "2026-07-15"
      },
      "corrected transcript body",
      enrichment
    );

    // skip segments are still in enrichment object; markdown builder includes all non-filtered —
    // enrichmentToLesson maps all segments; filter skips in merge only. Direct parse includes skip.
    // Ensure ingest schema accepts sourceType + body.
    const withoutSkip = {
      ...enrichment,
      segments: enrichment.segments.filter((segment) => segment.kind !== "skip")
    };
    const cleanLesson = enrichmentToLesson(
      {
        id: "call-2026-07-15",
        title: "Community Call — Jul 15",
        url: "https://www.skool.com/claude/classroom/example",
        transcript: "unused",
        callDate: "2026-07-15"
      },
      "corrected transcript body",
      withoutSkip
    );

    const parsed = lessonSchema.safeParse(cleanLesson);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.sourceType).toBe("call_recording");
      expect(parsed.data.curriculumPath?.[0]).toBe("Claude Club Community Calls");
      expect(parsed.data.markdown).toContain("Member asked");
      expect(parsed.data.markdown).toContain("Demo —");
      expect(parsed.data.transcript).toBe("corrected transcript body");
    }

    expect(lesson.title).toBe("Community Call — Jul 15");
  });
});
