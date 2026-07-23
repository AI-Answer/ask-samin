import { z } from "zod";

export const callSegmentKindSchema = z.enum(["qa", "demo", "concept", "skip"]);

export const callSegmentSchema = z.object({
  kind: callSegmentKindSchema,
  /** Short searchable title for this beat. */
  title: z.string().trim().min(1).max(200),
  /** Member question — required for qa, optional otherwise. */
  question: z.string().trim().max(2_000).nullish(),
  /** Samin’s answer / what he explained or showed — required unless skip. */
  answer: z.string().trim().max(4_000).nullish(),
  /** Tools, products, or Club concepts named in this beat. */
  tools: z.array(z.string().trim().min(1).max(80)).max(20).nullish().transform((value) => value ?? []),
  /** When a member should retrieve this beat. */
  whenToUse: z.string().trim().max(300).nullish(),
  /** Timestamp label from the source transcript if present, e.g. ~12:40 or 12:40. */
  timestampLabel: z.string().trim().max(32).nullish(),
  /** Why skip — only for kind=skip. */
  skipReason: z.string().trim().max(200).nullish()
});

export const callEnrichmentSchema = z.object({
  callSummary: z.string().trim().min(1).max(800),
  topics: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  segments: z.array(callSegmentSchema).max(80)
});

export type CallSegment = z.infer<typeof callSegmentSchema>;
export type CallEnrichment = z.infer<typeof callEnrichmentSchema>;

export const CALL_ENRICHMENT_JSON_SHAPE = `{
  "callSummary": "2-4 sentences: what this call covered for Claude Club members",
  "topics": ["short topic tags"],
  "segments": [
    {
      "kind": "qa" | "demo" | "concept" | "skip",
      "title": "short title",
      "question": "member question if kind=qa",
      "answer": "Samin's explanation or what he showed — grounded in the transcript",
      "tools": ["Claude Code", "MCP", "Hermes"],
      "whenToUse": "use when a member asks …",
      "timestampLabel": "~12:40",
      "skipReason": "only if kind=skip"
    }
  ]
}`;
