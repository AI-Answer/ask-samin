#!/usr/bin/env tsx
import { readFile } from "node:fs/promises";

import { mapSkoolExportToLessons, type SkoolIngestExport } from "../lib/community/skool-export";
import { ingestLessons } from "@community/ingest/run-lessons";

const DEFAULT_BATCH = 10;

async function postBatch(
  baseUrl: string,
  apiKey: string,
  lessons: ReturnType<typeof mapSkoolExportToLessons>,
  force: boolean
): Promise<{ processed: number; skipped: number; runId?: string }> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/ingest${force ? "?force=1" : ""}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ lessons, force })
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    error?: string;
    processed?: number;
    skipped?: number;
    runId?: string;
  };

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? `Ingest failed (${response.status})`);
  }

  return {
    processed: payload.processed ?? 0,
    skipped: payload.skipped ?? 0,
    runId: payload.runId
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error(
      "Usage: tsx scripts/ingest-skool-export.ts <export.json> [--batch=10] [--url=...] [--force] [--local]"
    );
    process.exit(1);
  }

  const batchArg = process.argv.find((arg) => arg.startsWith("--batch="));
  const urlArg = process.argv.find((arg) => arg.startsWith("--url="));
  const local = process.argv.includes("--local");
  const force = process.argv.includes("--force");
  const batchSize = batchArg ? Number(batchArg.split("=")[1]) : DEFAULT_BATCH;
  const baseUrl =
    urlArg?.split("=")[1] ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.INGEST_BASE_URL ??
    "http://localhost:3000";
  const apiKey = process.env.INGEST_API_KEY;
  if (!local && !apiKey) {
    console.error("INGEST_API_KEY is required unless --local is set.");
    process.exit(1);
  }

  const raw = JSON.parse(await readFile(inputPath, "utf8")) as SkoolIngestExport;
  const lessons = mapSkoolExportToLessons(raw);
  const batches = chunk(lessons, Math.max(1, batchSize));

  console.log(
    JSON.stringify(
      {
        source: inputPath,
        lessons: lessons.length,
        batches: batches.length,
        force,
        mode: local ? "local" : "http",
        target: local ? "direct-ingestLessons()" : `${baseUrl}/api/ingest`
      },
      null,
      2
    )
  );

  let processed = 0;
  let skipped = 0;

  for (const [index, batch] of batches.entries()) {
    const result = local
      ? await ingestLessons(batch, { fetchMethod: "skool-export", force })
      : await postBatch(baseUrl, apiKey!, batch, force);
    processed += result.processed;
    skipped += result.skipped;
    console.log(
      JSON.stringify({
        batch: index + 1,
        total: batches.length,
        batchSize: batch.length,
        runId: "runId" in result ? result.runId : undefined,
        processed: result.processed,
        skipped: result.skipped
      })
    );
  }

  console.log(JSON.stringify({ ok: true, processed, skipped, total: lessons.length, force }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
