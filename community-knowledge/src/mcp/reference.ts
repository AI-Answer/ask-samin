import type { CommunityChunk, SearchResult } from "../types";

export const ATTRIBUTION = "Samin Yasar / Claude Club";

export interface MatchReference {
  chunkId: string;
  location: string;
  timestampLabel?: string;
  heading?: string;
}

const SNIPPET_MAX_CHARS = 240;
export const FETCH_MAX_CHARS = 12_000;
const FETCH_CHUNK_RADIUS = 2;

export function formatTimestampLabel(startMs: number): string {
  const totalSeconds = Math.floor(startMs / 1_000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `~${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `~${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatLocation(curriculumPath: string[]): string {
  return curriculumPath.filter(Boolean).join(" → ");
}

function stripLeadingTimestamp(text: string): string {
  return text.replace(/^\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, "").trim();
}

export function buildSnippet(text: string, maxChars = SNIPPET_MAX_CHARS): string {
  const normalized = stripLeadingTimestamp(text).replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;

  const cut = normalized.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  const trimmed = (lastSpace > 120 ? cut.slice(0, lastSpace) : cut).trim();
  return `${trimmed}…`;
}

export function pickBestResultPerSource(results: SearchResult[], limit?: number): SearchResult[] {
  const best = new Map<string, SearchResult>();

  for (const result of results) {
    const current = best.get(result.sourceId);
    if (!current || result.score > current.score) {
      best.set(result.sourceId, result);
    }
  }

  const sorted = [...best.values()].sort(
    (left, right) => right.score - left.score || left.id.localeCompare(right.id)
  );
  return typeof limit === "number" ? sorted.slice(0, limit) : sorted;
}

export function buildMatchReference(input: {
  chunkId: string;
  curriculumPath: string[];
  startMs?: number;
  headingPath?: string[];
}): MatchReference {
  const headingPath = input.headingPath ?? [];
  const heading = headingPath.length > 0 ? headingPath[headingPath.length - 1] : undefined;
  const timestampLabel =
    typeof input.startMs === "number" ? formatTimestampLabel(input.startMs) : undefined;

  return {
    chunkId: input.chunkId,
    location: formatLocation(input.curriculumPath),
    ...(timestampLabel ? { timestampLabel } : {}),
    ...(heading ? { heading } : {})
  };
}

export function buildMatchReferenceFromSearch(result: SearchResult): MatchReference {
  return buildMatchReference({
    chunkId: result.matchChunkId ?? result.id,
    curriculumPath: result.curriculumPath,
    startMs: result.startMs,
    headingPath: result.headingPath
  });
}

/** Citation block Claude always sees — URL is intentional and unavoidable. */
export function buildCitationText(input: {
  title: string;
  url: string;
  reference: MatchReference;
  body: string;
}): string {
  const lines = [
    `[${ATTRIBUTION}]`,
    input.reference.location
      ? `${input.title} — ${input.reference.location}`
      : input.title,
    input.reference.timestampLabel
      ? `Watch around ${input.reference.timestampLabel}`
      : undefined,
    input.reference.heading ? `Section: ${input.reference.heading}` : undefined,
    input.url,
    "",
    input.body
  ].filter((line): line is string => line !== undefined);

  return lines.join("\n").trim();
}

export function selectFetchChunks(
  preferred: CommunityChunk,
  allChunks: CommunityChunk[],
  maxChars = FETCH_MAX_CHARS
): { chunks: CommunityChunk[]; truncated: boolean } {
  if (allChunks.length === 0) {
    return { chunks: [preferred], truncated: false };
  }

  const index = allChunks.findIndex((chunk) => chunk.id === preferred.id);
  const center = index >= 0 ? index : 0;
  const window = allChunks.slice(
    Math.max(0, center - FETCH_CHUNK_RADIUS),
    Math.min(allChunks.length, center + FETCH_CHUNK_RADIUS + 1)
  );

  const selected: CommunityChunk[] = [];
  let total = 0;
  for (const chunk of window) {
    const next = total + chunk.content.length + (selected.length > 0 ? 2 : 0);
    if (selected.length > 0 && next > maxChars) {
      return { chunks: selected, truncated: true };
    }
    selected.push(chunk);
    total = next;
  }

  const truncated =
    window.length < allChunks.length ||
    (allChunks.length === window.length &&
      allChunks.reduce((sum, chunk) => sum + chunk.content.length, 0) > maxChars);

  return { chunks: selected, truncated };
}

export function truncateBody(text: string, maxChars = FETCH_MAX_CHARS): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const cut = text.slice(0, maxChars);
  const lastBreak = Math.max(cut.lastIndexOf("\n\n"), cut.lastIndexOf("\n"), cut.lastIndexOf(" "));
  const trimmed = (lastBreak > maxChars * 0.6 ? cut.slice(0, lastBreak) : cut).trim();
  return { text: `${trimmed}\n\n[Truncated — open the Skool lesson for the full content.]`, truncated: true };
}
