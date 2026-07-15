import { hashContent, htmlToMarkdown, chunkMarkdown, summarizeWhenToUse } from "../chunking/markdown";
import { chunkTranscriptCues, parseTimestampedTranscript } from "../chunking/transcript";
import { buildMediaAssetsFromLesson } from "./media";
import type { CommunityChunk, CommunitySource, MediaAsset, SourceType } from "../types";

export interface NormalizedLessonInput {
  id: string;
  title: string;
  canonicalUrl: string;
  curriculumPath: string[];
  html?: string;
  markdown?: string;
  transcript?: string;
  sourceType?: SourceType;
  videoIds?: string[];
  videoLink?: string;
  videoId?: string;
  author?: string;
  whenToUse?: string;
  groupSlug?: string;
  groupId?: string;
  externalId?: string;
  courseId?: string;
}

export function normalizeLesson(input: NormalizedLessonInput): {
  source: Omit<
    CommunitySource,
    "visibility" | "extractionStatus" | "extractedAt" | "updatedAt" | "lastSeenAt"
  >;
  chunks: CommunityChunk[];
  mediaAssets: MediaAsset[];
} {
  const bodyMarkdown = input.markdown ?? (input.html ? htmlToMarkdown(input.html) : input.transcript ?? "");
  const contentHash = hashContent(bodyMarkdown);
  const sourceType = input.sourceType ?? (input.transcript ? "video" : "lesson_page");
  const whenToUse = input.whenToUse ?? summarizeWhenToUse(input.title, bodyMarkdown);

  const source = {
    id: input.id,
    sourceType,
    title: input.title,
    canonicalUrl: input.canonicalUrl,
    curriculumPath: input.curriculumPath,
    bodyMarkdown,
    videoIds: input.videoIds ?? [],
    author: input.author,
    contentHash,
    whenToUse,
    groupSlug: input.groupSlug,
    groupId: input.groupId,
    externalId: input.externalId ?? input.id,
    courseId: input.courseId
  };

  let chunks: CommunityChunk[];

  if (input.transcript) {
    const cues = parseTimestampedTranscript(input.transcript);
    if (cues.length > 0) {
      chunks = chunkTranscriptCues(cues).map((entry) => ({
        id: `${input.id}__chunk_${entry.chunkIndex}`,
        sourceId: input.id,
        chunkIndex: entry.chunkIndex,
        content: entry.content,
        metadata: { timed: true },
        whenToUse,
        startMs: entry.startMs,
        endMs: entry.endMs
      }));
    } else {
      chunks = chunkMarkdown(input.transcript).map((entry) => ({
        id: `${input.id}__chunk_${entry.chunkIndex}`,
        sourceId: input.id,
        chunkIndex: entry.chunkIndex,
        content: entry.content,
        metadata: { headingPath: entry.headingPath, timed: false },
        whenToUse
      }));
    }
  } else {
    chunks = chunkMarkdown(bodyMarkdown).map((entry) => ({
      id: `${input.id}__chunk_${entry.chunkIndex}`,
      sourceId: input.id,
      chunkIndex: entry.chunkIndex,
      content: entry.content,
      metadata: { headingPath: entry.headingPath, timed: false },
      whenToUse
    }));
  }

  return {
    source,
    chunks,
    mediaAssets: buildMediaAssetsFromLesson({
      sourceId: input.id,
      videoLink: input.videoLink,
      videoId: input.videoId,
      html: input.html
    })
  };
}
