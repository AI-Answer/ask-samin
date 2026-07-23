import type { LessonExport } from "../ingest/run-lessons";
import { applyCallGlossary } from "./glossary";
import { openRouterChatJson } from "./openrouter";
import { buildCallEnrichUserPrompt, CALL_ENRICH_SYSTEM_PROMPT } from "./prompt";
import {
  callEnrichmentSchema,
  type CallEnrichment,
  type CallSegment
} from "./schema";
import { filterAllowedTools } from "./tools";

const DEFAULT_WINDOW_CHARS = 12_000;
const DEFAULT_MODEL = "google/gemini-3.1-flash-lite";

export interface CallEnrichInput {
  id: string;
  title: string;
  url: string;
  /** Raw or already-timed transcript. */
  transcript: string;
  callDate?: string;
  groupSlug?: string;
  publish?: boolean;
  apiKey?: string;
  model?: string;
  windowChars?: number;
}

export interface CallEnrichResult {
  glossaryReplacements: Array<{ label: string; count: number }>;
  correctedTranscript: string;
  enrichment: CallEnrichment;
  /** Ready for POST /api/ingest { lessons: [...] }. */
  lesson: LessonExport;
  windowCount: number;
}

export interface WhisperSegment {
  start?: number;
  end?: number;
  text?: string;
}

/** Build [mm:ss] lines from Whisper-style JSON segments (immutable raw → timed text). */
export function whisperSegmentsToTimedTranscript(segments: WhisperSegment[]): string {
  const lines: string[] = [];
  for (const segment of segments) {
    const text = segment.text?.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const start = typeof segment.start === "number" ? segment.start : 0;
    const total = Math.max(0, Math.floor(start));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    lines.push(`[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}] ${text}`);
  }
  return lines.join("\n");
}

function splitWindows(text: string, maxChars: number): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  // Prefer paragraph breaks; fall back to single newlines (Whisper line dumps).
  const parts = normalized.includes("\n\n")
    ? normalized.split(/\n{2,}/)
    : normalized.split("\n");

  const windows: string[] = [];
  let buffer = "";

  const flush = () => {
    if (buffer.trim()) windows.push(buffer.trim());
    buffer = "";
  };

  const joiner = normalized.includes("\n\n") ? "\n\n" : "\n";

  for (const part of parts) {
    const next = buffer ? `${buffer}${joiner}${part}` : part;
    if (next.length > maxChars && buffer) {
      flush();
      if (part.length > maxChars) {
        for (let i = 0; i < part.length; i += maxChars) {
          windows.push(part.slice(i, i + maxChars));
        }
        buffer = "";
      } else {
        buffer = part;
      }
      continue;
    }
    buffer = next;
  }
  flush();
  return windows;
}

function sanitizeSegment(segment: CallSegment): CallSegment {
  return {
    ...segment,
    tools: filterAllowedTools(segment.tools ?? [])
  };
}

function mergeEnrichments(parts: CallEnrichment[]): CallEnrichment {
  const topics = new Set<string>();
  const segments: CallSegment[] = [];
  const summaries: string[] = [];

  for (const part of parts) {
    if (part.callSummary.trim()) summaries.push(part.callSummary.trim());
    for (const topic of part.topics) topics.add(topic);
    for (const segment of part.segments) {
      if (segment.kind === "skip") continue;
      segments.push(sanitizeSegment(segment));
    }
  }

  return callEnrichmentSchema.parse({
    callSummary: summaries.join(" ").slice(0, 800) || "Claude Club community call.",
    topics: [...topics].slice(0, 30),
    segments: segments.slice(0, 80)
  });
}

function segmentToMarkdown(segment: CallSegment, index: number): string {
  const tools =
    segment.tools.length > 0 ? `\nTools: ${segment.tools.join(", ")}` : "";
  const when = segment.whenToUse ? `\nWhen to use: ${segment.whenToUse}` : "";
  const ts = segment.timestampLabel ? ` (${segment.timestampLabel})` : "";

  if (segment.kind === "qa") {
    return [
      `### ${index + 1}. ${segment.title}${ts}`,
      segment.question ? `**Member asked:** ${segment.question}` : "",
      `**Samin:** ${segment.answer ?? ""}`,
      tools,
      when
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (segment.kind === "demo") {
    return [
      `### ${index + 1}. Demo — ${segment.title}${ts}`,
      segment.answer ?? "",
      tools,
      when
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `### ${index + 1}. ${segment.title}${ts}`,
    segment.answer ?? "",
    tools,
    when
  ]
    .filter(Boolean)
    .join("\n");
}

export function enrichmentToLesson(
  input: CallEnrichInput,
  correctedTranscript: string,
  enrichment: CallEnrichment
): LessonExport {
  const dateLabel = input.callDate?.trim() || "Community Call";
  const body = [
    `# ${input.title}`,
    "",
    enrichment.callSummary,
    "",
    enrichment.topics.length ? `Topics: ${enrichment.topics.join(", ")}` : "",
    "",
    "## Knowledge from this call",
    "",
    ...enrichment.segments.map((segment, index) => segmentToMarkdown(segment, index)),
    "",
    "## Source",
    "",
    `Open this Claude Club call: ${input.url}`,
    "Compiled from the call transcript at ingest (raw transcript retained for evidence)."
  ]
    .filter((line, index, arr) => !(line === "" && arr[index - 1] === ""))
    .join("\n")
    .trim();

  const summary = [
    enrichment.callSummary,
    enrichment.topics.length ? `Topics: ${enrichment.topics.join(", ")}` : ""
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 10_000);

  return {
    id: input.id,
    title: input.title,
    url: input.url,
    curriculumPath: ["Claude Club Community Calls", dateLabel],
    markdown: body,
    transcript: correctedTranscript,
    summary,
    sourceType: "call_recording",
    pageType: "call_recording",
    groupSlug: input.groupSlug ?? "claude",
    publish: input.publish !== false
  };
}

async function enrichWindow(input: {
  apiKey: string;
  model: string;
  callTitle: string;
  windowIndex: number;
  windowCount: number;
  transcriptWindow: string;
}): Promise<CallEnrichment> {
  const raw = await openRouterChatJson({
    apiKey: input.apiKey,
    model: input.model,
    messages: [
      { role: "system", content: CALL_ENRICH_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildCallEnrichUserPrompt({
          callTitle: input.callTitle,
          windowIndex: input.windowIndex,
          windowCount: input.windowCount,
          transcriptWindow: input.transcriptWindow
        })
      }
    ]
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Model returned non-JSON for window ${input.windowIndex + 1}.`);
  }

  return callEnrichmentSchema.parse(parsed);
}

export async function enrichCallTranscript(input: CallEnrichInput): Promise<CallEnrichResult> {
  const apiKey = input.apiKey ?? process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required for call enrichment.");
  }

  const model =
    input.model?.trim() ||
    process.env.OPENROUTER_CALL_MODEL?.trim() ||
    DEFAULT_MODEL;

  const glossary = applyCallGlossary(input.transcript);
  const windows = splitWindows(glossary.text, input.windowChars ?? DEFAULT_WINDOW_CHARS);
  if (windows.length === 0) {
    throw new Error("Transcript is empty after glossary pass.");
  }

  const parts: CallEnrichment[] = [];
  for (let index = 0; index < windows.length; index += 1) {
    parts.push(
      await enrichWindow({
        apiKey,
        model,
        callTitle: input.title,
        windowIndex: index,
        windowCount: windows.length,
        transcriptWindow: windows[index]!
      })
    );
  }

  const enrichment = mergeEnrichments(parts);
  const lesson = enrichmentToLesson(input, glossary.text, enrichment);

  return {
    glossaryReplacements: glossary.replacements,
    correctedTranscript: glossary.text,
    enrichment,
    lesson,
    windowCount: windows.length
  };
}
