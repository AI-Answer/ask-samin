#!/usr/bin/env tsx
import { readFile } from "node:fs/promises";

import { ingestLessons } from "../src/ingest/run-lessons";

async function main(): Promise<void> {
  const inputPath = process.argv[2] ?? "data/inventory/lessons-export.json";
  const lessons = JSON.parse(await readFile(inputPath, "utf8"));
  const result = await ingestLessons(lessons, { fetchMethod: "export" });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
