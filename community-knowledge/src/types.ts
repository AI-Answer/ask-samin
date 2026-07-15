export const EMBEDDING_MODEL = "gte-small-384";
export const EMBEDDING_DIMENSIONS = 384;

export type SourceType =
  | "lesson_page"
  | "community_post"
  | "call_recording"
  | "video"
  | "curator_note"
  | "resource_link";

export type SourceVisibility = "private" | "published";
export type ExtractionStatus = "indexed" | "blocked" | "processing" | "failed";

export type MediaProvider =
  | "wistia"
  | "loom"
  | "youtube"
  | "skool_native"
  | "local_ref"
  | "unknown"
  | "none";

export type MediaExtractability = "extractable" | "blocked" | "pending" | "unknown";
export type MediaTranscriptStatus = "none" | "pending" | "ready" | "blocked";
export type MediaDownloadStatus = "pending" | "ready" | "skipped" | "failed";

export interface CommunitySource {
  id: string;
  sourceType: SourceType;
  title: string;
  canonicalUrl: string;
  curriculumPath: string[];
  bodyMarkdown: string;
  videoIds: string[];
  author?: string;
  postedAt?: string;
  contentHash: string;
  visibility: SourceVisibility;
  extractionStatus: ExtractionStatus;
  blockedReason?: string;
  whenToUse?: string;
  extractedAt: string;
  extractionModelVersion?: string;
  updatedAt: string;
  groupId?: string;
  groupSlug?: string;
  externalId?: string;
  courseId?: string;
  lastSeenAt?: string;
  removedAt?: string;
  rawSnapshotId?: string;
}

export interface CommunityChunk {
  id: string;
  sourceId: string;
  chunkIndex: number;
  content: string;
  metadata: Record<string, unknown>;
  whenToUse?: string;
  startMs?: number;
  endMs?: number;
}

export interface CurriculumNode {
  id: string;
  parentId: string | null;
  title: string;
  slug: string;
  order: number;
  nodeType: "group" | "course" | "folder" | "module" | "lesson";
  sourceId?: string;
  groupSlug?: string;
  courseId?: string;
  externalId?: string;
}

export interface MediaAsset {
  id: string;
  sourceId: string;
  provider: MediaProvider;
  externalId?: string;
  url?: string;
  durationMs?: number;
  fingerprint?: string;
  extractability: MediaExtractability;
  downloadStatus: MediaDownloadStatus;
  transcriptStatus: MediaTranscriptStatus;
  rawTranscript?: string;
  blockedReason?: string;
}

export interface SearchResult {
  id: string;
  sourceId: string;
  sourceType: SourceType;
  sourceTitle: string;
  canonicalUrl: string;
  curriculumPath: string[];
  content: string;
  whenToUse?: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface FetchResult {
  id: string;
  source: CommunitySource;
  chunk: CommunityChunk;
  nearbyChunks: CommunityChunk[];
}

export interface CoverageInventoryEntry {
  lessonId: string;
  title: string;
  canonicalUrl: string;
  hasText: boolean;
  videoProvider: MediaProvider;
  extractableNow: boolean;
  blockedReason?: string;
  tier: 1 | 2 | 3 | 4;
}

export interface SeedCatalog {
  generatedAt: string;
  community: { slug: string; title: string };
  sources: CommunitySource[];
  chunks: CommunityChunk[];
  curriculumNodes: CurriculumNode[];
}
