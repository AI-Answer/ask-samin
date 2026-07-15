#!/usr/bin/env tsx
import { readFile } from "node:fs/promises";

import { hashContent } from "../src/chunking/markdown";
import { normalizeLesson } from "../src/ingest/normalize";
import {
  beginIngestionRun,
  completeRun,
  getExistingContentHash,
  heartbeatRun,
  replaceSourceChunks,
  saveRawSnapshot,
  upsertMediaAssets,
  upsertSource
} from "../src/ingest/pipeline";

interface LessonExport {
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
}

async function main(): Promise<void> {
  const inputPath = process.argv[2] ?? "data/inventory/lessons-export.json";
  const lessons = JSON.parse(await readFile(inputPath, "utf8")) as LessonExport[];
  const groupSlug = process.env.COMMUNITY_SLUG ?? lessons[0]?.groupSlug;
  const runId = await beginIngestionRun();
  if (!runId) {
    console.error("Could not start ingestion run — is Supabase configured?");
    process.exit(1);
  }

  let processed = 0;
  let skipped = 0;

  for (const lesson of lessons) {
    const rawContent = JSON.stringify(lesson);
    const rawHash = hashContent(rawContent);
    const snapshotId = await saveRawSnapshot({
      sourceUrl: lesson.url,
      rawHash,
      rawContent,
      sourceId: lesson.id,
      provider: "skool",
      fetchMethod: "export",
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
    await replaceSourceChunks(source.id, normalized.chunks, true, runId);
    processed += 1;

    await heartbeatRun(runId, {
      phase: "saving",
      progressPct: Math.round(((processed + skipped) / lessons.length) * 100),
      stats: { processed, skipped }
    });
  }

  await completeRun(runId, "completed");
  console.log(JSON.stringify({ processed, skipped, total: lessons.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
