import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const cacheDir = path.join(root, ".cache", "youtube");
const outputFile = path.join(root, "data", "catalog.generated.json");

function id(prefix, value) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 18)}`;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function readOptionalJson(file) {
  try {
    return await readJson(file);
  } catch {
    return null;
  }
}

function toSource(entry, kind) {
  const externalId = String(entry.id);
  const canonicalUrl =
    kind === "short"
      ? `https://www.youtube.com/shorts/${externalId}`
      : `https://www.youtube.com/watch?v=${externalId}`;
  return {
    id: `youtube_${externalId}`,
    externalId,
    kind,
    title: String(entry.title || "Untitled video").trim(),
    canonicalUrl,
    thumbnailUrl: `https://i.ytimg.com/vi/${externalId}/hqdefault.jpg`,
    ...(Number.isFinite(entry.duration) ? { durationSeconds: entry.duration } : {}),
    transcriptStatus: "metadata_only",
    segmentCount: 0,
    tags: []
  };
}

function auditSource(entry, fallback) {
  const externalId = String(entry.externalId || entry.id || fallback.externalId);
  const kind = entry.kind === "short" ? "short" : "video";
  const canonicalUrl =
    kind === "short"
      ? `https://www.youtube.com/shorts/${externalId}`
      : `https://www.youtube.com/watch?v=${externalId}`;
  return {
    ...fallback,
    id: `youtube_${externalId}`,
    externalId,
    kind,
    title: String(entry.title || fallback.title || "Untitled video").trim(),
    canonicalUrl,
    thumbnailUrl: entry.thumbnailUrl || fallback.thumbnailUrl,
    ...(entry.description ? { description: String(entry.description) } : {}),
    ...(entry.publishedAt ? { publishedAt: String(entry.publishedAt) } : {}),
    ...(Number.isFinite(entry.durationSeconds)
      ? { durationSeconds: entry.durationSeconds }
      : {}),
    transcriptStatus: "metadata_only",
    segmentCount: 0,
    tags: Array.isArray(entry.tags) ? entry.tags : []
  };
}

function metadataChunk(source) {
  return {
    id: id("chunk", `${source.id}:metadata`),
    sourceId: source.id,
    sourceTitle: source.title,
    sourceKind: source.kind,
    canonicalUrl: source.canonicalUrl,
    thumbnailUrl: source.thumbnailUrl,
    startMs: 0,
    endMs: 0,
    text: source.title,
    provenance: "metadata"
  };
}

const [videos, shorts] = await Promise.all([
  readJson(path.join(cacheDir, "videos.json")),
  readJson(path.join(cacheDir, "shorts.json"))
]);

const byExternalId = new Map();
for (const entry of videos.entries ?? []) byExternalId.set(entry.id, toSource(entry, "video"));
for (const entry of shorts.entries ?? []) {
  if (!byExternalId.has(entry.id)) byExternalId.set(entry.id, toSource(entry, "short"));
}

// Prefer the verified owner audit for richer metadata, but only for IDs that
// are already visible on the public Videos or Shorts tabs. This boundary keeps
// staged unlisted playlist items out of the public catalog.
const auditPayload = await readOptionalJson(path.join(cacheDir, "audit", "sources.json"));
const verifiedAuditSources = Array.isArray(auditPayload)
  ? auditPayload
  : Array.isArray(auditPayload?.sources)
    ? auditPayload.sources
    : [];
for (const entry of verifiedAuditSources) {
  const externalId = String(entry.externalId || entry.id || "");
  const fallback = byExternalId.get(externalId);
  if (!fallback || entry.visibility === "unlisted") continue;
  byExternalId.set(externalId, auditSource(entry, fallback));
}

const sources = [...byExternalId.values()];
const transcriptFile = path.join(root, "data", "transcripts", "chunks.json");
const sourceById = new Map(sources.map((source) => [source.id, source]));
const rawTranscriptChunks = (await readOptionalJson(transcriptFile)) ?? [];
const transcriptChunks = (Array.isArray(rawTranscriptChunks) ? rawTranscriptChunks : [])
  .filter((chunk) => sourceById.has(chunk.sourceId))
  .map((chunk) => {
    const source = sourceById.get(chunk.sourceId);
    return {
      ...chunk,
      sourceTitle: source.title,
      sourceKind: source.kind,
      canonicalUrl: source.canonicalUrl,
      thumbnailUrl: source.thumbnailUrl
    };
  });

const transcriptSourceIds = new Set(transcriptChunks.map((chunk) => chunk.sourceId));
const segmentCounts = new Map();
for (const chunk of transcriptChunks) {
  segmentCounts.set(chunk.sourceId, (segmentCounts.get(chunk.sourceId) ?? 0) + 1);
}
for (const source of sources) {
  if (transcriptSourceIds.has(source.id)) {
    source.transcriptStatus = "indexed";
    source.segmentCount = segmentCounts.get(source.id) ?? 0;
  }
}

const metadataChunks = sources
  .filter((source) => !transcriptSourceIds.has(source.id))
  .map(metadataChunk);
const chunks = [...transcriptChunks, ...metadataChunks];
const channel = {
  id: videos.channel_id || "UCzGcYErpBX4ldvv0l7MWLfw",
  handle: "@SaminYasar_",
  title: videos.channel || videos.uploader || "Samin Yasar",
  description: videos.description || "",
  canonicalUrl: "https://www.youtube.com/@SaminYasar_",
  avatarUrl:
    videos.thumbnails?.find((thumbnail) => thumbnail.id === "avatar_uncropped")?.url ||
    "https://yt3.googleusercontent.com/2EugEifAsndnoTfNBH_PKH5nPujlg7_GHFQ5dwc9o6y8gSnoq9pmlKvIVdsqoY_l35mi4Y_m=s900-c-k-c0x00ffffff-no-rj",
  bannerUrl:
    videos.thumbnails?.find((thumbnail) => thumbnail.id === "banner_uncropped")?.url || ""
};

const payload = {
  generatedAt: new Date().toISOString(),
  channel,
  stats: {
    total: sources.length,
    videos: sources.filter((source) => source.kind === "video").length,
    shorts: sources.filter((source) => source.kind === "short").length,
    transcriptIndexed: transcriptSourceIds.size,
    metadataOnly: sources.length - transcriptSourceIds.size
  },
  sources,
  chunks
};

await mkdir(path.dirname(outputFile), { recursive: true });
// Generated evidence is shipped with the server. Compact JSON keeps the
// cue-precision map small without changing any source text or timestamps.
await writeFile(outputFile, `${JSON.stringify(payload)}\n`, "utf8");
console.log(`Wrote ${sources.length} sources and ${chunks.length} chunks to ${outputFile}`);
