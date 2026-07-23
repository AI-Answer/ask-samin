import type { LessonExport } from "@community/ingest/run-lessons";
import type { PageKind } from "@community/types";

const MAX_TRANSCRIPT_CHARS = 2_000_000;
const MAX_SUMMARY_CHARS = 10_000;

const PAGE_KIND_VALUES = new Set<PageKind>([
  "lesson_page",
  "skill_card",
  "asset_pointer",
  "prompt_playbook",
  "concept_lesson"
]);

interface SkoolTimedChunk {
  chunk_index?: number;
  source_start_s?: number;
  source_end_s?: number;
  lesson_local_start_s?: number;
  lesson_local_end_s?: number;
  text?: string;
}

interface SkoolTranscriptRecord {
  status?: string;
  transcript_text?: string;
  transcript_chars?: number;
  whisper_needed?: boolean;
  method?: string;
  timed_chunks?: SkoolTimedChunk[];
}

interface SkoolResourceRecord {
  type?: string;
  title?: string;
  file_id?: string;
  file_name?: string;
  name?: string;
  url?: string;
  link?: string;
  content_type?: string;
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
  page_kind?: string;
  resources?: unknown;
  resources_field?: unknown;
  assets?: SkoolResourceRecord[];
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

function formatCueTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function timedChunksToBracketedTranscript(chunks: SkoolTimedChunk[]): string | undefined {
  const lines: string[] = [];
  for (const chunk of chunks) {
    const text = chunk.text?.trim();
    if (!text) continue;
    const start =
      typeof chunk.lesson_local_start_s === "number"
        ? chunk.lesson_local_start_s
        : typeof chunk.source_start_s === "number"
          ? chunk.source_start_s
          : 0;
    lines.push(`[${formatCueTimestamp(start)}] ${text}`);
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

function transcriptText(transcript: SkoolPageRecord["transcript"]): string | undefined {
  if (!transcript) return undefined;
  if (typeof transcript === "string") {
    const trimmed = transcript.trim();
    return trimmed || undefined;
  }
  if (Array.isArray(transcript.timed_chunks) && transcript.timed_chunks.length > 0) {
    const bracketed = timedChunksToBracketedTranscript(transcript.timed_chunks);
    if (bracketed) return bracketed;
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

function parseJsonResourceBlob(raw: unknown): SkoolResourceRecord[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter((entry): entry is SkoolResourceRecord => Boolean(entry) && typeof entry === "object");
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "[]") return [];
    try {
      return parseJsonResourceBlob(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  return [];
}

function resolveResources(page: SkoolPageRecord): unknown {
  if (Array.isArray(page.assets) && page.assets.length > 0) {
    return page.assets.map((asset) => ({
      type: asset.type,
      title: asset.title,
      file_id: asset.file_id,
      file_name: asset.file_name ?? asset.name,
      name: asset.name ?? asset.title,
      url: asset.url ?? asset.link,
      link: asset.link ?? asset.url
    }));
  }
  const fromField = parseJsonResourceBlob(page.resources_field);
  if (fromField.length > 0) return fromField;
  const fromResources = parseJsonResourceBlob(page.resources);
  if (fromResources.length > 0) return fromResources;
  return undefined;
}

function extractGithubUrl(page: SkoolPageRecord): string | undefined {
  if (page.github_url?.trim()) return page.github_url.trim();
  const resources = parseJsonResourceBlob(page.assets ?? page.resources_field ?? page.resources);
  const github = resources.find((resource) =>
    (resource.url ?? resource.link ?? "").includes("github.com")
  );
  const url = github?.url ?? github?.link;
  if (!url) return undefined;
  try {
    return new URL(url).toString();
  } catch {
    return undefined;
  }
}

function resolvePageKind(page: SkoolPageRecord): PageKind | undefined {
  const candidates = [page.page_kind, page.page_type]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (PAGE_KIND_VALUES.has(candidate as PageKind)) {
      return candidate as PageKind;
    }
  }

  if (candidates.includes("catalog_item")) {
    const resources = resolveResources(page);
    const list = Array.isArray(resources) ? (resources as SkoolResourceRecord[]) : [];
    if (
      list.some(
        (resource) =>
          resource.type === "zip" ||
          (resource.file_name ?? resource.name ?? "").toLowerCase().endsWith(".zip")
      )
    ) {
      return "skill_card";
    }
  }

  if (
    candidates.some(
      (candidate) => candidate === "lesson" || candidate === "media_item" || candidate.includes("lesson")
    )
  ) {
    return "lesson_page";
  }
  if (candidates.includes("knowledge_page")) {
    return "concept_lesson";
  }
  return undefined;
}

function resolveSummary(page: SkoolPageRecord): string | undefined {
  const raw = page.text?.trim() || page.desc_raw?.trim();
  if (!raw) return undefined;
  return raw.length <= MAX_SUMMARY_CHARS ? raw : raw.slice(0, MAX_SUMMARY_CHARS);
}

function isValidHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
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
    html: (page.html ?? "").trim() || undefined,
    groupSlug: defaults.groupSlug,
    courseId: defaults.courseId,
    publish: true
  };

  if (!lesson.html) {
    const textBody = page.text?.trim();
    if (textBody) lesson.html = textBody;
  }

  if (curriculumPath?.length) {
    lesson.curriculumPath =
      defaults.courseTitle && curriculumPath[0] !== defaults.courseTitle
        ? [defaults.courseTitle, ...curriculumPath]
        : curriculumPath;
  }
  if (page.page_type?.trim()) lesson.pageType = page.page_type.trim();
  const pageKind = resolvePageKind(page);
  if (pageKind) lesson.pageKind = pageKind;
  const summary = resolveSummary(page);
  if (summary) lesson.summary = summary;
  const resources = resolveResources(page);
  if (resources !== undefined) lesson.resources = resources;
  const githubUrl = extractGithubUrl(page);
  if (githubUrl) lesson.githubUrl = githubUrl;
  if (rawTranscript) {
    lesson.transcript = trimTranscript(rawTranscript, page.page_id);
  }
  const videoLink = video.url ?? video.link;
  if (isValidHttpUrl(videoLink)) lesson.videoLink = videoLink;
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
