import { readFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile("data/catalog.generated.json", "utf8"));
const failures = [];
let publishedCueAnchors = 0;

if (catalog.stats.total !== catalog.sources.length) failures.push("Catalog total does not match source count.");
if (catalog.sources.length < 1) failures.push("Catalog is empty.");

const sourceIds = new Set();
const externalIds = new Set();
for (const source of catalog.sources) {
  if (sourceIds.has(source.id)) failures.push(`Duplicate source id: ${source.id}`);
  if (externalIds.has(source.externalId)) failures.push(`Duplicate external id: ${source.externalId}`);
  sourceIds.add(source.id);
  externalIds.add(source.externalId);
  if (!source.title?.trim()) failures.push(`Missing title: ${source.id}`);
  if (!/^https:\/\/www\.youtube\.com\/(watch\?v=|shorts\/)/.test(source.canonicalUrl)) {
    failures.push(`Invalid YouTube URL: ${source.id}`);
  }
}

for (const chunk of catalog.chunks) {
  if (!sourceIds.has(chunk.sourceId)) failures.push(`Orphan chunk: ${chunk.id}`);
  if (chunk.startMs < 0 || chunk.endMs < chunk.startMs) failures.push(`Invalid timestamps: ${chunk.id}`);
  if (!chunk.text?.trim()) failures.push(`Empty chunk: ${chunk.id}`);

  if (chunk.provenance !== "transcript") continue;
  if (!Array.isArray(chunk.cuePoints) || chunk.cuePoints.length === 0) {
    failures.push(`Missing compact cue points: ${chunk.id}`);
    continue;
  }

  let previousStartOffset = -1;
  for (const [index, point] of chunk.cuePoints.entries()) {
    publishedCueAnchors += 1;
    if (!Array.isArray(point) || point.length !== 4) {
      failures.push(`Invalid compact cue point tuple: ${chunk.id}[${index}]`);
      continue;
    }

    const [startOffsetMs, durationMs, charStart, charLength] = point;
    const values = [startOffsetMs, durationMs, charStart, charLength];
    const cueEndMs = chunk.startMs + startOffsetMs + durationMs;
    const charEnd = charStart + charLength;
    if (
      !values.every(Number.isInteger) ||
      startOffsetMs < 0 ||
      startOffsetMs <= previousStartOffset ||
      durationMs <= 0 ||
      charStart < 0 ||
      charLength <= 0 ||
      cueEndMs > chunk.endMs ||
      charEnd > chunk.text.length ||
      !chunk.text.slice(charStart, charEnd).trim()
    ) {
      failures.push(`Invalid compact cue point values: ${chunk.id}[${index}]`);
    }
    previousStartOffset = startOffsetMs;
  }
}

for (const file of ["LOOPS.md", "data/prompts.ts", "README.md"]) {
  try {
    const text = await readFile(file, "utf8");
    if (/\[INSERT\s+TARGET/i.test(text)) failures.push(`Unresolved placeholder in ${file}`);
  } catch {
    if (file !== "README.md") failures.push(`Missing required file: ${file}`);
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "pass",
      sources: catalog.sources.length,
      chunks: catalog.chunks.length,
      publishedCueAnchors,
      transcriptIndexed: catalog.stats.transcriptIndexed,
      metadataOnly: catalog.stats.metadataOnly
    },
    null,
    2
  )
);
