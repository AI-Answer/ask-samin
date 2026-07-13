import type { KnowledgeChunk } from "./types";

type RecommendationCandidate = Pick<
  KnowledgeChunk,
  "sourceKind" | "canonicalUrl" | "provenance" | "startMs" | "endMs"
>;

function isYouTubeUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === "youtu.be" ||
      hostname === "youtube.com" ||
      hostname.endsWith(".youtube.com")
    );
  } catch {
    return false;
  }
}

/**
 * The one recommendation boundary shared by standalone search, chat, and MCP.
 * Library browsing remains broader, but recommendations require timed transcript
 * evidence from a full-length YouTube video.
 */
export function isEligibleRecommendationChunk(chunk: RecommendationCandidate): boolean {
  const hasTimedEvidence =
    Number.isInteger(chunk.startMs) &&
    chunk.startMs >= 0 &&
    Number.isInteger(chunk.endMs) &&
    chunk.endMs > chunk.startMs;
  const hasTranscriptEvidence =
    chunk.provenance === "transcript" || chunk.provenance === "creator_export";

  return (
    chunk.sourceKind === "video" &&
    isYouTubeUrl(chunk.canonicalUrl) &&
    hasTranscriptEvidence &&
    hasTimedEvidence
  );
}
