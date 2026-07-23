#!/usr/bin/env tsx
/**
 * Enrich a community-call transcript → ingest-ready lesson JSON.
 *
 * Plain text:
 *   npx tsx scripts/enrich-call-transcript.ts --transcript ./call.txt ...
 *
 * Whisper JSON ({ text, segments:[{start,end,text}] }) — preferred for timestamps:
 *   npx tsx scripts/enrich-call-transcript.ts --json ./call.corrected.json ...
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  enrichCallTranscript,
  whisperSegmentsToTimedTranscript
} from "../community-knowledge/src/calls/enrich";
import { lessonSchema } from "../lib/community/ingest-schema";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function required(flag: string): string {
  const value = argValue(flag)?.trim();
  if (!value) {
    console.error(`Missing required ${flag}`);
    process.exit(1);
  }
  return value;
}

async function loadTranscript(): Promise<{ transcript: string; source: string }> {
  const jsonPath = argValue("--json");
  if (jsonPath) {
    const raw = JSON.parse(await readFile(resolve(jsonPath), "utf8")) as {
      text?: string;
      segments?: Array<{ start?: number; end?: number; text?: string }>;
    };
    if (Array.isArray(raw.segments) && raw.segments.length > 0) {
      return {
        transcript: whisperSegmentsToTimedTranscript(raw.segments),
        source: `${jsonPath} (whisper segments → timed)`
      };
    }
    if (raw.text?.trim()) {
      return { transcript: raw.text, source: `${jsonPath} (text field)` };
    }
    throw new Error(`No segments/text in ${jsonPath}`);
  }

  const transcriptPath = argValue("--transcript");
  if (!transcriptPath) {
    console.error("Provide --json <whisper.json> or --transcript <file.txt>");
    process.exit(1);
  }
  return {
    transcript: await readFile(resolve(transcriptPath), "utf8"),
    source: transcriptPath
  };
}

async function main(): Promise<void> {
  const id = required("--id");
  const title = required("--title");
  const url = required("--url");
  const outPath = argValue("--out") ?? `./call-${id}-ingest.json`;
  const callDate = argValue("--date");
  const doIngest = process.argv.includes("--ingest");
  const force = process.argv.includes("--force");

  const { transcript, source } = await loadTranscript();
  console.log(JSON.stringify({ loading: source, chars: transcript.length }, null, 2));

  const result = await enrichCallTranscript({
    id,
    title,
    url,
    transcript,
    callDate,
    publish: true
  });

  const parsed = lessonSchema.safeParse(result.lesson);
  if (!parsed.success) {
    console.error("Enrichment produced invalid ingest lesson:", parsed.error.flatten());
    process.exit(1);
  }

  const payload = {
    ok: true,
    source,
    glossaryReplacements: result.glossaryReplacements,
    windowCount: result.windowCount,
    segmentCounts: result.enrichment.segments.reduce<Record<string, number>>((acc, segment) => {
      acc[segment.kind] = (acc[segment.kind] ?? 0) + 1;
      return acc;
    }, {}),
    topics: result.enrichment.topics,
    lessons: [parsed.data]
  };

  await writeFile(resolve(outPath), JSON.stringify(payload, null, 2), "utf8");
  console.log(
    JSON.stringify(
      {
        wrote: outPath,
        windows: result.windowCount,
        segments: result.enrichment.segments.length,
        segmentCounts: payload.segmentCounts,
        topics: result.enrichment.topics,
        glossary: result.glossaryReplacements.slice(0, 15),
        sourceType: parsed.data.sourceType
      },
      null,
      2
    )
  );

  if (!doIngest) return;

  const apiKey = process.env.INGEST_API_KEY?.trim();
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.INGEST_BASE_URL?.trim() ||
    "https://ask-samin-ochre.vercel.app";
  if (!apiKey) {
    console.error("INGEST_API_KEY required with --ingest");
    process.exit(1);
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/ingest${force ? "?force=1" : ""}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ lessons: [parsed.data], force })
  });
  const body = await response.json();
  console.log(JSON.stringify({ ingestStatus: response.status, body }, null, 2));
  if (!response.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
