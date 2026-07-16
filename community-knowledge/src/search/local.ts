import MiniSearch from "minisearch";

import { getSeedCatalog } from "../catalog";
import type { CommunityChunk, CommunitySource, SearchResult, SourceType } from "../types";

export interface RankedChunk {
  chunk: CommunityChunk;
  source: CommunitySource;
  score: number;
}

interface LocalSearchDocument {
  id: string;
  chunkId: string;
  sourceId: string;
  title: string;
  text: string;
  whenToUse: string;
  curriculumPath: string;
}

const catalog = getSeedCatalog();
const chunksById = new Map(catalog.chunks.map((chunk) => [chunk.id, chunk]));
const sourcesById = new Map(catalog.sources.map((source) => [source.id, source]));

const documents: LocalSearchDocument[] = catalog.chunks
  .map((chunk) => {
    const source = sourcesById.get(chunk.sourceId);
    if (!source || source.visibility !== "published") return null;
    return {
      id: chunk.id,
      chunkId: chunk.id,
      sourceId: chunk.sourceId,
      title: source.title,
      text: chunk.content,
      whenToUse: source.whenToUse ?? "",
      curriculumPath: source.curriculumPath.join(" ")
    };
  })
  .filter((entry): entry is LocalSearchDocument => entry !== null);

const miniSearch = new MiniSearch<LocalSearchDocument>({
  fields: ["title", "text", "whenToUse", "curriculumPath"],
  storeFields: ["chunkId", "sourceId"],
  searchOptions: {
    boost: { title: 4, whenToUse: 2, text: 2, curriculumPath: 1.5 },
    combineWith: "OR",
    prefix: true,
    fuzzy: 0.15
  }
});

miniSearch.addAll(documents);

export function searchLocalCatalog(
  query: string,
  options: { limit?: number; sourceType?: SourceType; curriculumPath?: string } = {}
): RankedChunk[] {
  const normalizedQuery = query.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalizedQuery) return [];

  const limit = Math.min(20, Math.max(1, options.limit ?? 8));
  const results = miniSearch.search(normalizedQuery).slice(0, limit * 3);

  return results.flatMap((result) => {
    const chunk = chunksById.get(String(result.chunkId ?? result.id));
    const source = chunk ? sourcesById.get(chunk.sourceId) : undefined;
    if (!chunk || !source) return [];
    if (options.sourceType && source.sourceType !== options.sourceType) return [];
    if (
      options.curriculumPath &&
      !source.curriculumPath.some((segment) =>
        segment.toLocaleLowerCase().includes(options.curriculumPath!.toLocaleLowerCase())
      )
    ) {
      return [];
    }
    return [{ chunk, source, score: result.score }];
  }).slice(0, limit);
}

export function rankedToSearchResults(ranked: RankedChunk[]): SearchResult[] {
  return ranked.map(({ chunk, source, score }) => {
    const headingPath = Array.isArray(chunk.metadata.headingPath)
      ? (chunk.metadata.headingPath as string[])
      : undefined;

    return {
      id: chunk.id,
      sourceId: source.id,
      sourceType: source.sourceType,
      sourceTitle: source.title,
      canonicalUrl: source.canonicalUrl,
      curriculumPath: source.curriculumPath,
      content: chunk.content,
      whenToUse: chunk.whenToUse ?? source.whenToUse,
      score,
      metadata: chunk.metadata,
      pageKind: source.pageKind,
      matchChunkId: chunk.id,
      startMs: chunk.startMs,
      endMs: chunk.endMs,
      headingPath
    };
  });
}

export function getSeedChunk(chunkId: string): { chunk: CommunityChunk; source: CommunitySource } | null {
  const chunk = chunksById.get(chunkId);
  const source = chunk ? sourcesById.get(chunk.sourceId) : undefined;
  if (!chunk || !source) return null;
  return { chunk, source };
}

export function getSeedSourceChunks(sourceId: string): CommunityChunk[] {
  return catalog.chunks.filter((chunk) => chunk.sourceId === sourceId).sort((a, b) => a.chunkIndex - b.chunkIndex);
}
