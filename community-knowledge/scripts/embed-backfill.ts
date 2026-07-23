#!/usr/bin/env tsx
import { createServerSupabaseClient } from "../src/db/client";
import { createEmbeddingsBatch, embeddingToPgVector } from "../src/embed";

const PAGE_SIZE = 200;

async function main(): Promise<void> {
  const client = createServerSupabaseClient();
  if (!client) {
    console.error("Supabase not configured.");
    process.exit(1);
  }

  const sourceId = process.argv[2];
  let totalSeen = 0;
  let totalUpdated = 0;
  let totalFailed = 0;
  let stalled = 0;

  for (;;) {
    // Always take the first page of remaining nulls so updates do not skip rows.
    let query = client
      .from("chunks")
      .select("id, content")
      .is("embedding", null)
      .order("source_id")
      .order("chunk_index")
      .range(0, PAGE_SIZE - 1);

    if (sourceId) query = query.eq("source_id", sourceId);

    const { data: chunks, error } = await query;
    if (error) throw error;
    if (!chunks?.length) break;

    console.log(`Embedding remaining nulls page count=${chunks.length}…`);
    const embeddings = await createEmbeddingsBatch(chunks.map((chunk) => chunk.content as string));

    let pageUpdated = 0;
    for (let index = 0; index < chunks.length; index += 1) {
      totalSeen += 1;
      const embedding = embeddings[index];
      if (!embedding) {
        totalFailed += 1;
        continue;
      }
      const { error: updateError } = await client
        .from("chunks")
        .update({ embedding: embeddingToPgvectorSafe(embedding) })
        .eq("id", chunks[index].id as string);
      if (updateError) {
        totalFailed += 1;
        console.error(`Failed ${chunks[index].id}: ${updateError.message}`);
        continue;
      }
      totalUpdated += 1;
      pageUpdated += 1;
    }

    if (pageUpdated === 0) {
      stalled += 1;
      console.error("No embeddings written this page; aborting to avoid infinite loop.");
      break;
    }
  }

  if (totalSeen === 0) {
    console.log("No chunks missing embeddings.");
    return;
  }

  console.log(`Updated ${totalUpdated}/${totalSeen} chunk embeddings (failed=${totalFailed}).`);
}

function embeddingToPgvectorSafe(values: number[]): string {
  return embeddingToPgVector(values);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
