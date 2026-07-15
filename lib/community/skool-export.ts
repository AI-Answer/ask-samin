import type { LessonExport } from "@community/ingest/run-lessons";

const MAX_TRANSCRIPT_CHARS = 2_000_000;

interface SkoolTranscriptRecord {
  status?: string;
  transcript_text?: string;
  transcript_chars?: number;
  whisper_needed?: boolean;
  method?: string;
}

interface SkoolPageRecord {
  page_id: string;
  title: string;
  url: string;
  course_path?: string[];
  html?: string;
  text?: string;
  transcript?: string | SkoolTranscriptRecord | null;
  video?: { url?: string; link?: string; id?: string; external_id?: string } | null;
}

export interface SkoolIngestExport {
  schema_version?: string;
  community?: string;
  course?: { short_id?: string };
  pages: SkoolPageRecord[];
}

function transcriptText(transcript: SkoolPageRecord["transcript"]): string | undefined {
  if (!transcript) return undefined;
  if (typeof transcript === "string") {
    const trimmed = transcript.trim();
    return trimmed || undefined;
  }
  const text = transcript.transcript_text?.trim();
  return text || undefined;
}

function trimTranscript(text: string, pageId: string): string {
  if (text.length <= MAX_TRANSCRIPT_CHARS) return text;
  console.warn(
    `[skool-export] Truncating transcript for ${pageId} from ${text.length} to ${MAX_TRANSCRIPT_CHARS} chars`
  );
  return text.slice(0, MAX_TRANSCRIPT_CHARS);
}

export function mapSkoolPageToLesson(
  page: SkoolPageRecord,
  defaults: { groupSlug?: string; courseId?: string } = {}
): LessonExport {
  const video = page.video && typeof page.video === "object" ? page.video : {};
  const rawTranscript = transcriptText(page.transcript);
  const lesson: LessonExport = {
    id: page.page_id.trim(),
    title: page.title.trim(),
    url: page.url.trim(),
    html: (page.html ?? page.text ?? "").trim() || undefined,
    groupSlug: defaults.groupSlug,
    courseId: defaults.courseId,
    publish: true
  };

  if (page.course_path?.length) {
    lesson.curriculumPath = page.course_path;
  }
  if (rawTranscript) {
    lesson.transcript = trimTranscript(rawTranscript, page.page_id);
  }
  const videoLink = video.url ?? video.link;
  if (videoLink) lesson.videoLink = videoLink;
  const videoId = video.id ?? video.external_id;
  if (videoId) lesson.videoId = videoId;

  return lesson;
}

export function mapSkoolExportToLessons(exportData: SkoolIngestExport): LessonExport[] {
  const groupSlug = exportData.community?.trim();
  const courseId = exportData.course?.short_id?.trim();
  return exportData.pages.map((page) => mapSkoolPageToLesson(page, { groupSlug, courseId }));
}

export function isSkoolIngestExport(body: unknown): body is SkoolIngestExport {
  if (!body || typeof body !== "object") return false;
  const candidate = body as SkoolIngestExport;
  return Array.isArray(candidate.pages) && candidate.pages.length > 0;
}

export function normalizeIngestBody(body: unknown): LessonExport[] | null {
  if (!body || typeof body !== "object") return null;

  const record = body as { lessons?: LessonExport[] } & SkoolIngestExport;
  if (Array.isArray(record.lessons) && record.lessons.length > 0) {
    return record.lessons;
  }
  if (isSkoolIngestExport(record)) {
    return mapSkoolExportToLessons(record);
  }
  return null;
}
