#!/usr/bin/env tsx
import { createServerSupabaseClient, createServiceRootClient } from "../src/db/client";
import { createEmbeddingsBatch, embeddingToPgVector } from "../src/embed";

async function main(): Promise<void> {
  const client = createServerSupabaseClient();
  if (!client) {
    console.error("Supabase not configured.");
    process.exit(1);
  }

  const sourceId = process.argv[2];
  let query = client
    .from("chunks")
    .select("id, content")
    .is("embedding", null)
    .order("source_id")
    .order("chunk_index");

  if (sourceId) query = query.eq("source_id", sourceId);

  const { data: chunks, error } = await query;
  if (error) throw error;
  if (!chunks?.length) {
    console.log("No chunks missing embeddings.");
    return;
  }

  console.log(`Embedding ${chunks.length} chunks…`);
  const rootClient = createServiceRootClient();
  if (!rootClient) {
    console.error("Service role client unavailable.");
    process.exit(1);
  }

  const embeddings = await createEmbeddingsBatch(chunks.map((chunk) => chunk.content as string));

  let updated = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const embedding = embeddings[index];
    if (!embedding) continue;
    const { error: updateError } = await client
      .from("chunks")
      .update({ embedding: embeddingToPgVector(embedding) })
      .eq("id", chunks[index].id as string);
    if (!updateError) updated += 1;
  }

  console.log(`Updated ${updated}/${chunks.length} chunk embeddings.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
