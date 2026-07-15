#!/usr/bin/env tsx
import seedCatalog from "../data/seed/catalog.json";
import { createServerSupabaseClient } from "../src/db/client";
import { replaceSourceChunks, upsertSource } from "../src/ingest/pipeline";
import type { CommunitySource, CurriculumNode } from "../src/types";

async function main(): Promise<void> {
  const client = createServerSupabaseClient();
  if (!client) {
    console.error("Supabase not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const catalog = seedCatalog as {
    sources: CommunitySource[];
    chunks: import("../src/types").CommunityChunk[];
    curriculumNodes: CurriculumNode[];
  };

  for (const node of catalog.curriculumNodes) {
    const { error } = await client.from("curriculum_nodes").upsert({
      id: node.id,
      parent_id: node.parentId,
      title: node.title,
      slug: node.slug,
      node_order: node.order,
      node_type: node.nodeType,
      source_id: node.sourceId ?? null
    });
    if (error) throw error;
  }

  for (const source of catalog.sources) {
    const ok = await upsertSource(source, { publish: source.visibility === "published" });
    if (!ok) throw new Error(`Failed to upsert source ${source.id}`);
    if (source.extractionStatus !== "indexed") continue;

    const chunks = catalog.chunks.filter((chunk) => chunk.sourceId === source.id);
    const count = await replaceSourceChunks(source.id, chunks, false);
    console.log(`Seeded ${source.id}: ${count} chunks (no embed — run embed:backfill separately)`);
  }

  console.log("Seed complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
