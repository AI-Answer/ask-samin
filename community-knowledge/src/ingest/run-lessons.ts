import { hashContent } from "../chunking/markdown";
import { normalizeLesson } from "./normalize";
import {
  beginIngestionRun,
  completeRun,
  getExistingContentHash,
  heartbeatRun,
  replaceSourceChunks,
  replaceSourceAssets,
  saveRawSnapshot,
  upsertCurriculumNodes,
  upsertMediaAssets,
  upsertSource
} from "./pipeline";

export interface LessonExport {
  id: string;
  title: string;
  url: string;
  curriculumPath?: string[];
  html?: string;
  markdown?: string;
  transcript?: string;
  videoLink?: string;
  videoId?: string;
  publish?: boolean;
  groupSlug?: string;
  courseId?: string;
  pageKind?: import("../types").PageKind;
  pageType?: string;
  summary?: string;
  resources?: unknown;
  githubUrl?: string;
}

export interface IngestLessonsResult {
  runId: string;
  processed: number;
  skipped: number;
  total: number;
}

export async function ingestLessons(
  lessons: LessonExport[],
  options: { fetchMethod?: string; groupSlug?: string } = {}
): Promise<IngestLessonsResult> {
  if (lessons.length === 0) {
    throw new Error("At least one lesson is required.");
  }

  const groupSlug = options.groupSlug ?? process.env.COMMUNITY_SLUG ?? lessons[0]?.groupSlug;
  const fetchMethod = options.fetchMethod ?? "export";
  const runId = await beginIngestionRun();
  if (!runId) {
    throw new Error("Could not start ingestion run — is Supabase configured?");
  }

  let processed = 0;
  let skipped = 0;

  try {
    for (const lesson of lessons) {
      const rawContent = JSON.stringify(lesson);
      const rawHash = hashContent(rawContent);
      const snapshotId = await saveRawSnapshot({
        sourceUrl: lesson.url,
        rawHash,
        rawContent,
        sourceId: lesson.id,
        provider: "skool",
        fetchMethod,
        contentType: lesson.html ? "html" : lesson.transcript ? "transcript" : "json"
      });

      const normalized = normalizeLesson({
        id: lesson.id,
        title: lesson.title,
        canonicalUrl: lesson.url,
        curriculumPath: lesson.curriculumPath ?? [],
        html: lesson.html,
        markdown: lesson.markdown,
        transcript: lesson.transcript,
        videoLink: lesson.videoLink,
        videoId: lesson.videoId,
        pageKind: lesson.pageKind,
        pageType: lesson.pageType,
        summary: lesson.summary,
        resources: lesson.resources,
        githubUrl: lesson.githubUrl,
        groupSlug,
        externalId: lesson.id,
        courseId: lesson.courseId
      });

      const existingHash = await getExistingContentHash(lesson.id);
      if (existingHash === normalized.source.contentHash) {
        skipped += 1;
        continue;
      }

      const now = new Date().toISOString();
      const source = {
        ...normalized.source,
        visibility: lesson.publish ? ("published" as const) : ("private" as const),
        extractionStatus: "indexed" as const,
        extractedAt: now,
        updatedAt: now,
        lastSeenAt: now,
        rawSnapshotId: snapshotId ?? undefined
      };

      await upsertSource(source, { publish: lesson.publish });
      await upsertMediaAssets(normalized.mediaAssets);
      await replaceSourceAssets(source.id, normalized.sourceAssets);
      await upsertCurriculumNodes(normalized.curriculumNodes);
      await replaceSourceChunks(source.id, normalized.chunks, true, runId);
      processed += 1;

      await heartbeatRun(runId, {
        phase: "saving",
        progressPct: Math.round(((processed + skipped) / lessons.length) * 100),
        stats: { processed, skipped }
      });
    }

    await completeRun(runId, "completed");
    return { runId, processed, skipped, total: lessons.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ingestion failed";
    await completeRun(runId, "failed", message);
    throw error;
  }
}
