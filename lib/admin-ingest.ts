import { promptLedger } from "../data/prompts";
import { createHash } from "node:crypto";
import { getCatalog } from "./catalog";
import { createServerSupabaseClient } from "./search/supabase";
import type { KnowledgeChunk, KnowledgeSource } from "./types";

export interface IngestSegment {
  id: string;
  sourceId: string;
  startMs: number;
  endMs: number;
  speaker?: string;
  rawText: string;
  normalizedText?: string;
  provenance: KnowledgeChunk["provenance"];
  metadata?: Record<string, unknown>;
}

export interface AdminIngestPayload {
  mode: "preview" | "persist";
  sources: Array<KnowledgeSource & { isPublic?: boolean }>;
  segments: IngestSegment[];
  chunks: KnowledgeChunk[];
}

export interface SimpleAdminIngestPayload {
  kind: KnowledgeSource["kind"];
  title: string;
  url?: string;
  externalId?: string;
  text?: string;
  persist: boolean;
  isPublic: boolean;
}

export interface IngestPreview {
  valid: boolean;
  counts: { sources: number; segments: number; chunks: number };
  duplicateIds: string[];
  missingSourceIds: string[];
  invalidTimestampIds: string[];
  promptVersions: Array<{ id: string; version: string }>;
}

function duplicateIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates].sort();
}

function stableHash(value: string, length = 18): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function youtubeExternalId(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be") return parsed.pathname.split("/").filter(Boolean)[0];
    if (parsed.hostname.endsWith("youtube.com")) {
      return parsed.searchParams.get("v") ?? parsed.pathname.split("/").filter(Boolean).at(-1);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function timestampMs(hours: string | undefined, minutes: string, seconds: string): number {
  return ((Number(hours ?? 0) * 3_600 + Number(minutes) * 60 + Number(seconds)) * 1_000);
}

function timestampedCues(text: string): Array<{ startMs: number; text: string }> {
  const cuePattern = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})(?:[.,]\d{1,3})?\s+(.+)$/;
  const cues: Array<{ startMs: number; text: string }> = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(cuePattern);
    if (match) {
      cues.push({ startMs: timestampMs(match[1], match[2], match[3]), text: match[4].trim() });
    } else if (cues.length) {
      cues[cues.length - 1].text += ` ${line}`;
    } else {
      cues.push({ startMs: 0, text: line });
    }
  }

  return cues.length ? cues : [{ startMs: 0, text: text.trim() }];
}

export function normalizeSimpleIngest(input: SimpleAdminIngestPayload): AdminIngestPayload {
  const stableIdentity =
    input.externalId ?? youtubeExternalId(input.url) ?? input.url ?? input.title;
  const fingerprint = `${input.kind}\u0000${stableIdentity}`;
  const sourceId = `${input.kind}_${stableHash(fingerprint)}`;
  const externalId = input.externalId ?? youtubeExternalId(input.url) ?? `creator_${stableHash(fingerprint, 24)}`;
  const canonicalUrl = input.url ?? `urn:ask-samin:source:${sourceId}`;
  const cues = input.text ? timestampedCues(input.text) : [];

  const source: KnowledgeSource & { isPublic?: boolean } = {
    id: sourceId,
    externalId,
    kind: input.kind,
    title: input.title,
    canonicalUrl,
    transcriptStatus: cues.length ? "indexed" : "metadata_only",
    segmentCount: cues.length,
    tags: [],
    isPublic: input.isPublic
  };
  const segments: IngestSegment[] = cues.map((cue, index) => {
    const nextStart = cues[index + 1]?.startMs ?? cue.startMs;
    const cueHash = stableHash(`${sourceId}\u0000${cue.startMs}\u0000${cue.text}`);
    return {
      id: `segment_${cueHash}`,
      sourceId,
      startMs: cue.startMs,
      endMs: Math.max(cue.startMs, nextStart),
      rawText: cue.text,
      normalizedText: cue.text.normalize("NFKC").replace(/\s+/g, " ").trim(),
      provenance: input.kind === "document" ? "document" : "creator_export"
    };
  });
  const chunks: KnowledgeChunk[] = (segments.length
    ? segments
    : [
        {
          id: `segment_${stableHash(`${sourceId}\u00000\u0000${input.title}`)}`,
          sourceId,
          startMs: 0,
          endMs: 0,
          rawText: input.title,
          normalizedText: input.title,
          provenance: "metadata" as const
        }
      ]
  ).map((segment) => ({
    id: `chunk_${stableHash(segment.id)}`,
    sourceId,
    sourceTitle: input.title,
    sourceKind: input.kind,
    canonicalUrl,
    startMs: segment.startMs,
    endMs: segment.endMs,
    text: segment.normalizedText ?? segment.rawText,
    provenance: segment.provenance
  }));

  return { mode: input.persist ? "persist" : "preview", sources: [source], segments, chunks };
}

export function previewIngest(payload: AdminIngestPayload): IngestPreview {
  const knownSourceIds = new Set([
    ...getCatalog().sources.map((source) => source.id),
    ...payload.sources.map((source) => source.id)
  ]);
  const missingSourceIds = new Set<string>();
  for (const item of [...payload.segments, ...payload.chunks]) {
    if (!knownSourceIds.has(item.sourceId)) missingSourceIds.add(item.sourceId);
  }
  const invalidTimestampIds = [
    ...payload.segments
      .filter((segment) => segment.endMs < segment.startMs)
      .map((segment) => segment.id),
    ...payload.chunks
      .filter((chunk) => chunk.endMs < chunk.startMs)
      .map((chunk) => chunk.id)
  ].sort();
  const duplicateIdList = [
    ...duplicateIds(payload.sources.map((source) => source.id)),
    ...duplicateIds(payload.segments.map((segment) => segment.id)),
    ...duplicateIds(payload.chunks.map((chunk) => chunk.id))
  ].sort();

  return {
    valid:
      duplicateIdList.length === 0 &&
      missingSourceIds.size === 0 &&
      invalidTimestampIds.length === 0,
    counts: {
      sources: payload.sources.length,
      segments: payload.segments.length,
      chunks: payload.chunks.length
    },
    duplicateIds: duplicateIdList,
    missingSourceIds: [...missingSourceIds].sort(),
    invalidTimestampIds,
    promptVersions: promptLedger.map(({ id, version }) => ({ id, version }))
  };
}

function sourceRow(source: KnowledgeSource & { isPublic?: boolean }) {
  return {
    id: source.id,
    external_id: source.externalId,
    kind: source.kind,
    title: source.title,
    canonical_url: source.canonicalUrl,
    thumbnail_url: source.thumbnailUrl ?? null,
    description: source.description ?? null,
    published_at: source.publishedAt ?? null,
    duration_seconds: source.durationSeconds ?? null,
    transcript_status: source.transcriptStatus,
    segment_count: source.segmentCount,
    tags: source.tags,
    is_public: source.isPublic ?? false
  };
}

function segmentRow(segment: IngestSegment) {
  return {
    id: segment.id,
    source_id: segment.sourceId,
    start_ms: segment.startMs,
    end_ms: segment.endMs,
    speaker: segment.speaker ?? null,
    raw_text: segment.rawText,
    normalized_text: segment.normalizedText ?? segment.rawText,
    provenance: segment.provenance,
    metadata: segment.metadata ?? {}
  };
}

function chunkRow(chunk: KnowledgeChunk) {
  return {
    id: chunk.id,
    source_id: chunk.sourceId,
    source_title: chunk.sourceTitle,
    source_kind: chunk.sourceKind,
    canonical_url: chunk.canonicalUrl,
    thumbnail_url: chunk.thumbnailUrl ?? null,
    start_ms: chunk.startMs,
    end_ms: chunk.endMs,
    text: chunk.text,
    provenance: chunk.provenance
  };
}

export async function persistIngest(payload: AdminIngestPayload): Promise<{ jobId: string }> {
  const client = createServerSupabaseClient();
  if (!client) throw new Error("supabase_not_configured");

  const jobId = crypto.randomUUID();
  const { error } = await client.rpc("ingest_knowledge_bundle", {
    p_job_id: jobId,
    p_sources: payload.sources.map(sourceRow),
    p_segments: payload.segments.map(segmentRow),
    p_chunks: payload.chunks.map(chunkRow),
    p_prompts: promptLedger.map((prompt) => ({
      id: prompt.id,
      name: prompt.name,
      purpose: prompt.purpose,
      version: prompt.version,
      updated_at: prompt.updatedAt,
      body: prompt.body
    }))
  });
  if (error) throw new Error("persist_bundle_transaction_failed");
  return { jobId };
}
