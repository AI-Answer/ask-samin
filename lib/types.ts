export type SourceKind = "video" | "short" | "community_call" | "document" | "web";
export type TranscriptStatus = "indexed" | "metadata_only" | "processing" | "failed";

/**
 * A caption cue stored compactly relative to its parent chunk:
 * [start offset ms, duration ms, text start char, text length].
 */
export type TranscriptCuePoint = [number, number, number, number];

export interface KnowledgeSource {
  id: string;
  externalId: string;
  kind: SourceKind;
  title: string;
  canonicalUrl: string;
  thumbnailUrl?: string;
  description?: string;
  publishedAt?: string;
  durationSeconds?: number;
  transcriptStatus: TranscriptStatus;
  segmentCount: number;
  tags: string[];
}

export interface KnowledgeChunk {
  id: string;
  sourceId: string;
  sourceTitle: string;
  sourceKind: SourceKind;
  canonicalUrl: string;
  thumbnailUrl?: string;
  startMs: number;
  endMs: number;
  text: string;
  provenance: "transcript" | "creator_export" | "metadata" | "document";
  cuePoints?: TranscriptCuePoint[];
}

export interface CitationSource extends KnowledgeChunk {
  citationId: string;
  score: number;
  timestampUrl: string;
  timestampLabel: string;
}

export interface CatalogPayload {
  generatedAt: string;
  channel: {
    id: string;
    handle: string;
    title: string;
    description: string;
    canonicalUrl: string;
    avatarUrl: string;
    bannerUrl: string;
  };
  stats: {
    total: number;
    videos: number;
    shorts: number;
    transcriptIndexed: number;
    metadataOnly: number;
  };
  sources: KnowledgeSource[];
  chunks: KnowledgeChunk[];
}

export interface PromptLedgerEntry {
  id: string;
  name: string;
  purpose: string;
  version: string;
  updatedAt: string;
  body: string;
}
