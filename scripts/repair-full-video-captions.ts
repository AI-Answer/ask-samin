#!/usr/bin/env tsx
/**
 * Repair FULL VIDEO CLAUDE COURSE chunks: raw YouTube karaoke captions →
 * clean timed transcript chunks + fresh embeddings.
 *
 * Also: unpublish smoke junk; null out Skool [v2] JSON when_to_use pollution.
 */
import { createClient } from "@supabase/supabase-js";

import { applyCallGlossary } from "../community-knowledge/src/calls/glossary";
import {
  chunkTranscriptCues,
  parseYoutubeKaraokeCaptions
} from "../community-knowledge/src/chunking/transcript";
import { createEmbeddingsBatch, embeddingToPgVector } from "../community-knowledge/src/embed";

const FULL_VIDEO_ID = "0e733be297014123aa8b3259a6852261";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function main(): Promise<void> {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const ck = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "community_knowledge" }
  });
  const root = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // --- 1) Unpublish smoke junk ---
  const { data: smoke, error: smokeErr } = await ck
    .from("sources")
    .update({ visibility: "private", extraction_status: "blocked", blocked_reason: "deploy_smoke_junk" })
    .or("id.like.vercel-smoke%,id.eq.root-smoke,id.eq.ingest-smoke-probe,title.eq.Test,title.eq.Production smoke,title.eq.Root deploy smoke,title.eq.Smoke Probe")
    .select("id, title");
  if (smokeErr) throw smokeErr;
  console.log(`Unpublished smoke sources: ${(smoke ?? []).map((s) => s.id).join(", ") || "(none)"}`);

  // --- 2) Null polluted when_to_use (Skool JSON in FTS weight A) ---
  const { count: beforeWhen } = await ck
    .from("chunks")
    .select("*", { count: "exact", head: true })
    .like("when_to_use", "%[v2]%");
  // PostgREST can't easily bulk-null with like filter via update+select count reliably for huge sets;
  // do via RPC-less batched fetch+update of ids.
  let cleared = 0;
  for (;;) {
    const { data: rows, error } = await ck
      .from("chunks")
      .select("id")
      .like("when_to_use", "%[v2]%")
      .limit(200);
    if (error) throw error;
    if (!rows?.length) break;
    const { error: upErr } = await ck
      .from("chunks")
      .update({ when_to_use: null })
      .in(
        "id",
        rows.map((r) => r.id as string)
      );
    if (upErr) throw upErr;
    cleared += rows.length;
    console.log(`Cleared when_to_use pollution: ${cleared}/${beforeWhen ?? "?"}`);
  }

  const { count: sourceWhen } = await ck
    .from("sources")
    .select("*", { count: "exact", head: true })
    .like("when_to_use", "%[v2]%");
  if (sourceWhen && sourceWhen > 0) {
    const { data: srcRows } = await ck.from("sources").select("id").like("when_to_use", "%[v2]%");
    if (srcRows?.length) {
      await ck
        .from("sources")
        .update({ when_to_use: null })
        .in(
          "id",
          srcRows.map((r) => r.id as string)
        );
      console.log(`Cleared source when_to_use: ${srcRows.length}`);
    }
  }

  // --- 3) Rebuild FULL VIDEO from karaoke captions ---
  const pages: Array<{ chunk_index: number; content: string }> = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await ck
      .from("chunks")
      .select("chunk_index, content")
      .eq("source_id", FULL_VIDEO_ID)
      .order("chunk_index")
      .range(offset, offset + 999);
    if (error) throw error;
    if (!data?.length) break;
    pages.push(...(data as Array<{ chunk_index: number; content: string }>));
    if (data.length < 1000) break;
    offset += 1000;
  }

  if (!pages.length) {
    console.log("FULL VIDEO has no chunks; skip rebuild.");
    return;
  }

  const raw = pages
    .sort((a, b) => a.chunk_index - b.chunk_index)
    .map((p) => p.content)
    .join("");

  const cues = parseYoutubeKaraokeCaptions(raw).map((cue) => ({
    ...cue,
    text: applyCallGlossary(cue.text).text
  }));
  console.log(`Parsed ${cues.length} clean cues from ${pages.length} polluted chunks`);
  if (cues.length < 50) {
    throw new Error(`Karaoke parse produced too few cues (${cues.length}); aborting.`);
  }

  const timedChunks = chunkTranscriptCues(cues, 900);
  console.log(`Re-chunked to ${timedChunks.length} timed chunks (was ${pages.length})`);
  console.log("Sample:", timedChunks[0]?.content.slice(0, 200));
  console.log("Mid:", timedChunks[Math.floor(timedChunks.length / 2)]?.content.slice(0, 200));

  const embeddings = await createEmbeddingsBatch(timedChunks.map((c) => c.content));
  const failed = embeddings.filter((e) => !e).length;
  if (failed > 0) {
    throw new Error(`Embedding failed for ${failed}/${timedChunks.length} chunks`);
  }

  const payload = timedChunks.map((chunk, index) => ({
    id: `${FULL_VIDEO_ID}__chunk_${chunk.chunkIndex}`,
    chunk_index: chunk.chunkIndex,
    content: chunk.content,
    embedding: embeddingToPgVector(embeddings[index]!),
    metadata: {
      timed: true,
      startMs: chunk.startMs,
      endMs: chunk.endMs,
      pageKind: "lesson_page",
      repairedFrom: "youtube_karaoke_captions"
    },
    when_to_use: "Full Claude Masterclass video — use for Masterclass how-tos, day lessons, and end-to-end walkthroughs when day-level pages are thin."
  }));

  const { data: replaced, error: replaceErr } = await root.rpc("replace_source_chunks", {
    p_source_id: FULL_VIDEO_ID,
    p_chunks: payload
  });
  if (replaceErr) throw replaceErr;

  // Update source body to clean preview (not raw VTT)
  const cleanBody = timedChunks
    .slice(0, 8)
    .map((c) => c.content)
    .join("\n\n");
  await ck
    .from("sources")
    .update({
      body_markdown: cleanBody.slice(0, 8_000),
      when_to_use:
        "Full Claude Masterclass video — comprehensive walkthrough across the course days."
    })
    .eq("id", FULL_VIDEO_ID);

  // Verify no VTT left
  const { count: stillVtt } = await ck
    .from("chunks")
    .select("*", { count: "exact", head: true })
    .eq("source_id", FULL_VIDEO_ID)
    .like("content", "%<c>%");
  const { count: newCount } = await ck
    .from("chunks")
    .select("*", { count: "exact", head: true })
    .eq("source_id", FULL_VIDEO_ID);

  console.log(
    JSON.stringify(
      {
        replaced,
        newCount,
        stillVtt,
        first: timedChunks[0]?.content.slice(0, 180),
        last: timedChunks.at(-1)?.content.slice(0, 180)
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
