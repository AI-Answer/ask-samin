import { createQueryEmbedding, logQueryUsage, rpcSearchCommunityChunks } from "../embed";
import type { SearchResult, SourceType } from "../types";
import { rankedToSearchResults, type RankedChunk } from "./local";

function rpcRowToRanked(row: {
  id: string;
  source_id: string;
  source_type: string;
  source_title: string;
  canonical_url: string;
  curriculum_path: string[];
  content: string;
  when_to_use: string | null;
  metadata: Record<string, unknown> | null;
  score: number;
}): RankedChunk {
  return {
    score: row.score,
    source: {
      id: row.source_id,
      sourceType: row.source_type as SourceType,
      title: row.source_title,
      canonicalUrl: row.canonical_url,
      curriculumPath: row.curriculum_path ?? [],
      bodyMarkdown: "",
      videoIds: [],
      contentHash: "",
      visibility: "published",
      extractionStatus: "indexed",
      extractedAt: "",
      updatedAt: ""
    },
    chunk: {
      id: row.id,
      sourceId: row.source_id,
      chunkIndex: 0,
      content: row.content,
      metadata: row.metadata ?? {},
      whenToUse: row.when_to_use ?? undefined,
      startMs: typeof row.metadata?.startMs === "number" ? row.metadata.startMs : undefined,
      endMs: typeof row.metadata?.endMs === "number" ? row.metadata.endMs : undefined
    }
  };
}

export async function searchSupabase(
  query: string,
  options: {
    limit: number;
    sourceType?: SourceType;
    curriculumPath?: string;
    clientIpHash?: string;
  }
): Promise<SearchResult[] | null> {
  const embedding = await createQueryEmbedding(query);
  const rows = await rpcSearchCommunityChunks({
    queryText: query,
    queryEmbedding: embedding,
    matchCount: options.limit,
    filterSourceType: options.sourceType,
    filterCurriculumPath: options.curriculumPath
  });

  if (!rows) return null;

  const ranked = rows.map(rpcRowToRanked);
  const results = rankedToSearchResults(ranked);

  if (options.clientIpHash) {
    await logQueryUsage({
      toolName: "search",
      queryText: query,
      clientIpHash: options.clientIpHash,
      resultCount: results.length
    });
  }

  return results;
}
