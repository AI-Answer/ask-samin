import type { CitationSource, KnowledgeChunk } from "./types";

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be"
]);

export function formatTimestamp(startMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(startMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function buildTimestampUrl(canonicalUrl: string, startMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(startMs / 1_000));
  if (totalSeconds === 0) return canonicalUrl;

  try {
    const url = new URL(canonicalUrl);
    const hostname = url.hostname.toLowerCase();

    if (YOUTUBE_HOSTS.has(hostname) || hostname.endsWith(".youtube.com")) {
      url.searchParams.set("t", `${totalSeconds}s`);
      return url.toString();
    }

    url.hash = `t=${totalSeconds}`;
    return url.toString();
  } catch {
    return canonicalUrl;
  }
}

export function toCitationSource(
  chunk: KnowledgeChunk,
  score: number,
  zeroBasedIndex: number
): CitationSource {
  return {
    ...chunk,
    citationId: `S${zeroBasedIndex + 1}`,
    score: Number.isFinite(score) ? score : 0,
    timestampUrl: buildTimestampUrl(chunk.canonicalUrl, chunk.startMs),
    timestampLabel: formatTimestamp(chunk.startMs)
  };
}

export function rankCitationSources(
  rankedChunks: Array<{ chunk: KnowledgeChunk; score: number }>,
  limit: number
): CitationSource[] {
  const seen = new Set<string>();
  const unique: Array<{ chunk: KnowledgeChunk; score: number }> = [];

  for (const result of rankedChunks) {
    if (seen.has(result.chunk.id)) continue;
    seen.add(result.chunk.id);
    unique.push(result);
    if (unique.length >= limit) break;
  }

  return unique.map((result, index) => toCitationSource(result.chunk, result.score, index));
}
