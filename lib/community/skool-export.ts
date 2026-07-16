import type { LessonExport } from "@community/ingest/run-lessons";

const MAX_TRANSCRIPT_CHARS = 2_000_000;

interface SkoolTranscriptRecord {
  status?: string;
  transcript_text?: string;
  transcript_chars?: number;
  whisper_needed?: boolean;
  method?: string;
}

interface SkoolResourceRecord {
  type?: string;
  file_id?: string;
  file_name?: string;
  name?: string;
  url?: string;
  link?: string;
}

interface SkoolPageRecord {
  page_id: string;
  title: string;
  url: string;
  course_path?: string[];
  html?: string;
  text?: string;
  desc_raw?: string;
  folder?: string;
  page_type?: string;
  resources?: unknown;
  resources_field?: unknown;
  github_url?: string;
  transcript?: string | SkoolTranscriptRecord | null;
  video?: { url?: string; link?: string; id?: string; external_id?: string } | null;
}

export interface SkoolIngestExport {
  schema_version?: string;
  community?: string;
  course?: { short_id?: string; title?: string };
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

function buildCurriculumPath(page: SkoolPageRecord): string[] | undefined {
  if (page.course_path?.length) return page.course_path;
  if (page.folder?.trim()) return [page.folder.trim()];
  return undefined;
}

function extractGithubUrl(page: SkoolPageRecord): string | undefined {
  if (page.github_url?.trim()) return page.github_url.trim();
  const resources = [page.resources_field, page.resources].flatMap((entry) =>
    Array.isArray(entry) ? entry : []
  ) as SkoolResourceRecord[];
  const github = resources.find((resource) =>
    (resource.url ?? resource.link ?? "").includes("github.com")
  );
  return github?.url ?? github?.link;
}

export function mapSkoolPageToLesson(
  page: SkoolPageRecord,
  defaults: { groupSlug?: string; courseId?: string; courseTitle?: string } = {}
): LessonExport {
  const video = page.video && typeof page.video === "object" ? page.video : {};
  const rawTranscript = transcriptText(page.transcript);
  const curriculumPath = buildCurriculumPath(page);
  const lesson: LessonExport = {
    id: page.page_id.trim(),
    title: page.title.trim(),
    url: page.url.trim(),
    html: (page.html ?? page.text ?? "").trim() || undefined,
    groupSlug: defaults.groupSlug,
    courseId: defaults.courseId,
    publish: true
  };

  if (curriculumPath?.length) {
    lesson.curriculumPath =
      defaults.courseTitle && curriculumPath[0] !== defaults.courseTitle
        ? [defaults.courseTitle, ...curriculumPath]
        : curriculumPath;
  }
  if (page.page_type?.trim()) lesson.pageType = page.page_type.trim();
  if (page.desc_raw?.trim()) lesson.summary = page.desc_raw.trim();
  if (page.resources_field !== undefined) lesson.resources = page.resources_field;
  else if (page.resources !== undefined) lesson.resources = page.resources;
  const githubUrl = extractGithubUrl(page);
  if (githubUrl) lesson.githubUrl = githubUrl;
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
  const courseTitle = exportData.course?.title?.trim();
  return exportData.pages.map((page) =>
    mapSkoolPageToLesson(page, { groupSlug, courseId, courseTitle })
  );
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
