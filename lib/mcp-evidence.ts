import { rankCitationSources } from "./citations";
import { encodeEvidenceId } from "./evidence-id";
import { isEligibleRecommendationChunk } from "./recommendation-eligibility";
import { cueContextAtStart } from "./search/cue-anchor";
import type { EvidenceRecord } from "./source";
import type { CitationSource, KnowledgeChunk } from "./types";

export interface McpSearchResult {
  id: string;
  title: string;
  text: string;
  url: string;
}

export interface McpFetchDocument {
  id: string;
  title: string;
  text: string;
  url: string;
  metadata: {
    kind: string;
    transcriptStatus: string;
    sources: Array<{
      citationId: string;
      timestampLabel: string;
      url: string;
    }>;
  };
}

const CONTEXT_RADIUS = 1;

/** Search remains source-diverse while its IDs identify the exact evidence hit. */
export function buildMcpSearchResults(sources: CitationSource[]): McpSearchResult[] {
  const seenSourceIds = new Set<string>();

  return sources.flatMap((source) => {
    if (
      !source.timestampUrl ||
      !isEligibleRecommendationChunk(source) ||
      seenSourceIds.has(source.sourceId)
    ) {
      return [];
    }
    seenSourceIds.add(source.sourceId);
    return [
      {
        id: encodeEvidenceId(source.id, source.startMs),
        title: source.sourceTitle,
        text: `[${source.timestampLabel}] ${source.text}`,
        url: source.timestampUrl
      }
    ];
  });
}

function selectContext(chunks: KnowledgeChunk[], matchedChunkId?: string): KnowledgeChunk[] {
  const eligibleChunks = chunks.filter(isEligibleRecommendationChunk);
  if (eligibleChunks.length === 0) return [];
  const matchedIndex = matchedChunkId
    ? eligibleChunks.findIndex((chunk) => chunk.id === matchedChunkId)
    : 0;
  if (matchedIndex < 0) return [];

  const start = Math.max(0, matchedIndex - CONTEXT_RADIUS);
  const end = Math.min(eligibleChunks.length, matchedIndex + CONTEXT_RADIUS + 1);
  return eligibleChunks.slice(start, end);
}

/** Build fetch output around the exact search hit, with at most one adjacent chunk per side. */
export function buildMcpFetchDocument(
  resultId: string,
  record: EvidenceRecord
): McpFetchDocument | null {
  if (!record.source.canonicalUrl) return null;

  const matchedChunk = record.matchedChunkId
    ? record.chunks.find((chunk) => chunk.id === record.matchedChunkId)
    : undefined;
  const preciseContext =
    matchedChunk && record.matchedStartMs !== undefined
      ? cueContextAtStart(matchedChunk, record.matchedStartMs)
      : null;
  if (record.matchedStartMs !== undefined && !preciseContext) return null;

  const context = preciseContext
    ? [preciseContext].filter(isEligibleRecommendationChunk)
    : selectContext(record.chunks, record.matchedChunkId);
  if (record.matchedChunkId && context.every((chunk) => chunk.id !== record.matchedChunkId)) {
    return null;
  }

  const citations = rankCitationSources(
    context.map((chunk, index) => ({ chunk, score: 1 / (index + 1) })),
    CONTEXT_RADIUS * 2 + 1
  );
  const matchedCitation = record.matchedChunkId
    ? citations.find((citation) => citation.id === record.matchedChunkId)
    : citations[0];

  if (!matchedCitation) return null;

  return {
    id: resultId,
    title: record.source.title,
    text:
      citations.map((citation) => `[${citation.timestampLabel}] ${citation.text}`).join("\n\n") ||
      record.source.description ||
      record.source.title,
    url: matchedCitation.timestampUrl,
    metadata: {
      kind: record.source.kind,
      transcriptStatus: record.source.transcriptStatus,
      sources: citations.map((citation) => ({
        citationId: citation.citationId,
        timestampLabel: citation.timestampLabel,
        url: citation.timestampUrl
      }))
    }
  };
}
