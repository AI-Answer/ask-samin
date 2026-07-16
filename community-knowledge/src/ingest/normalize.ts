import { hashContent, htmlToMarkdown, chunkMarkdown, summarizeWhenToUse } from "../chunking/markdown";
import { chunkTranscriptCues, parseTimestampedTranscript } from "../chunking/transcript";
import { buildCurriculumNodes } from "./curriculum-sync";
import { buildMediaAssetsFromLesson } from "./media";
import { inferPageKind } from "./page-kind";
import { assetsSummary, parseSourceAssets } from "./source-assets";
import type { CommunityChunk, CommunitySource, MediaAsset, PageKind, SourceAsset, SourceType } from "../types";

export interface NormalizedLessonInput {
  id: string;
  title: string;
  canonicalUrl: string;
  curriculumPath: string[];
  html?: string;
  markdown?: string;
  transcript?: string;
  sourceType?: SourceType;
  pageKind?: PageKind;
  pageType?: string;
  summary?: string;
  resources?: unknown;
  githubUrl?: string;
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

function buildCatalogChunk(input: {
  id: string;
  title: string;
  curriculumPath: string[];
  bodyMarkdown: string;
  summary?: string;
  pageKind: PageKind;
  assets: SourceAsset[];
  whenToUse: string;
}): CommunityChunk[] {
  const location = input.curriculumPath.length ? input.curriculumPath.join(" → ") : "";
  const content = [
    input.title,
    location ? `Location: ${location}` : "",
    input.summary?.trim(),
    assetsSummary(input.assets) ? `Assets:\n${assetsSummary(input.assets)}` : "",
    input.bodyMarkdown.trim()
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    {
      id: `${input.id}__chunk_0`,
      sourceId: input.id,
      chunkIndex: 0,
      content,
      metadata: { catalog: true, pageKind: input.pageKind },
      whenToUse: input.whenToUse
    }
  ];
}

export function normalizeLesson(input: NormalizedLessonInput): {
  source: Omit<
    CommunitySource,
    "visibility" | "extractionStatus" | "extractedAt" | "updatedAt" | "lastSeenAt"
  >;
  chunks: CommunityChunk[];
  mediaAssets: MediaAsset[];
  sourceAssets: SourceAsset[];
  curriculumNodes: ReturnType<typeof buildCurriculumNodes>;
} {
  const bodyMarkdown = input.markdown ?? (input.html ? htmlToMarkdown(input.html) : "");
  const sourceAssets = parseSourceAssets({
    sourceId: input.id,
    resources: input.resources,
    githubUrl: input.githubUrl,
    videoUrl: input.videoLink
  });
  const pageKind =
    input.pageKind ??
    inferPageKind({
      pageType: input.pageType,
      bodyLength: bodyMarkdown.trim().length,
      hasZip: sourceAssets.some((asset) => asset.assetType === "zip"),
      hasGithub: sourceAssets.some((asset) => asset.assetType === "github") || Boolean(input.githubUrl),
      hasTranscript: Boolean(input.transcript?.trim())
    });
  const contentHash = hashContent(
    JSON.stringify({
      body: bodyMarkdown,
      transcript: input.transcript ?? "",
      pageKind,
      assets: sourceAssets.map((asset) => ({
        assetType: asset.assetType,
        fileId: asset.fileId,
        fileName: asset.fileName,
        url: asset.url
      }))
    })
  );
  const sourceType = input.sourceType ?? (input.transcript ? "video" : "lesson_page");
  const whenToUse = input.whenToUse ?? input.summary?.trim() ?? summarizeWhenToUse(input.title, bodyMarkdown);

  const source = {
    id: input.id,
    sourceType,
    pageKind,
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
        metadata: { timed: true, pageKind },
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
        metadata: { headingPath: entry.headingPath, timed: false, pageKind },
        whenToUse
      }));
    }
  } else {
    const markdownChunks = chunkMarkdown(bodyMarkdown);
    if (markdownChunks.length > 0) {
      chunks = markdownChunks.map((entry) => ({
        id: `${input.id}__chunk_${entry.chunkIndex}`,
        sourceId: input.id,
        chunkIndex: entry.chunkIndex,
        content: entry.content,
        metadata: { headingPath: entry.headingPath, timed: false, pageKind },
        whenToUse
      }));
    } else {
      chunks = buildCatalogChunk({
        id: input.id,
        title: input.title,
        curriculumPath: input.curriculumPath,
        bodyMarkdown,
        summary: input.summary,
        pageKind,
        assets: sourceAssets,
        whenToUse
      });
    }
  }

  return {
    source,
    chunks,
    mediaAssets: buildMediaAssetsFromLesson({
      sourceId: input.id,
      videoLink: input.videoLink,
      videoId: input.videoId,
      html: input.html
    }),
    sourceAssets,
    curriculumNodes: buildCurriculumNodes({
      sourceId: input.id,
      title: input.title,
      curriculumPath: input.curriculumPath,
      groupSlug: input.groupSlug,
      courseId: input.courseId,
      externalId: input.externalId ?? input.id
    })
  };
}
