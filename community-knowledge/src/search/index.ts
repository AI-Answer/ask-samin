import { getCurriculumNodes as getSeedCurriculumNodes, listRecentUpdates as listSeedRecentUpdates } from "../catalog";
import {
  browseCurriculumFromDb,
  fetchEvidenceFromDb,
  getSourceRetrievalMeta,
  listRecentUpdatesFromDb
} from "../db/repository";
import { pickBestResultPerSource } from "../mcp/reference";
import type { CurriculumNode, FetchResult, SearchResult, SourceType } from "../types";
import {
  getSeedChunk,
  getSeedSourceChunks,
  rankedToSearchResults,
  searchLocalCatalog,
  type RankedChunk
} from "./local";
import { searchSupabase } from "./supabase";

export interface SearchOptions {
  limit?: number;
  sourceType?: SourceType;
  curriculumPath?: string;
  clientIpHash?: string;
}

function isRemoteSearchConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim())
  );
}

async function enrichSearchResults(results: SearchResult[]): Promise<SearchResult[]> {
  const meta = await getSourceRetrievalMeta(results.map((result) => result.sourceId));
  return results.map((result) => {
    const sourceMeta = meta.get(result.sourceId);
    if (!sourceMeta) return result;
    return {
      ...result,
      pageKind: sourceMeta.pageKind,
      assets: sourceMeta.assets
    };
  });
}

async function curriculumNodesForBoost(): Promise<CurriculumNode[]> {
  const fromDb = await browseCurriculumFromDb();
  if (fromDb?.length) return fromDb;
  if (isRemoteSearchConfigured()) return [];
  return getSeedCurriculumNodes();
}

function curriculumBoost(query: string, ranked: RankedChunk[], nodes: CurriculumNode[]): RankedChunk[] {
  const normalizedQuery = query.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  if (!normalizedQuery) return ranked;

  const titleMatches = new Set<string>();
  for (const node of nodes) {
    const title = node.title.toLocaleLowerCase();
    if (title.includes(normalizedQuery) || normalizedQuery.includes(title)) {
      if (node.sourceId) titleMatches.add(node.sourceId);
    }
  }

  if (titleMatches.size === 0) return ranked;

  return [...ranked]
    .map((entry) =>
      titleMatches.has(entry.source.id) ? { ...entry, score: entry.score * 1.35 } : entry
    )
    .sort((left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id));
}

function fuseRankedLists(lists: RankedChunk[][], rrfK = 60): RankedChunk[] {
  const fused = new Map<string, RankedChunk & { fusedScore: number }>();

  for (const list of lists) {
    list.forEach((entry, index) => {
      const contribution = 1 / (rrfK + index + 1);
      const current = fused.get(entry.chunk.id);
      if (!current) {
        fused.set(entry.chunk.id, { ...entry, fusedScore: contribution });
        return;
      }
      current.fusedScore += contribution;
      if (entry.score > current.score) {
        current.score = entry.score;
        current.chunk = entry.chunk;
        current.source = entry.source;
      }
    });
  }

  return [...fused.values()]
    .sort(
      (left, right) =>
        right.fusedScore - left.fusedScore || left.chunk.id.localeCompare(right.chunk.id)
    )
    .map(({ chunk, source, score }) => ({ chunk, source, score }));
}

async function finalizeSearchResults(
  results: SearchResult[],
  limit: number
): Promise<SearchResult[]> {
  const enriched = await enrichSearchResults(results);
  return pickBestResultPerSource(enriched, limit);
}

export async function searchCommunityKnowledge(
  query: string,
  options: SearchOptions = {}
): Promise<{ mode: "hybrid" | "local"; results: SearchResult[] }> {
  const normalizedQuery = query.normalize("NFKC").replace(/\s+/g, " ").trim();
  const limit = Math.min(20, Math.max(1, options.limit ?? 5));
  if (!normalizedQuery) return { mode: "local", results: [] };

  const useRemoteOnly = isRemoteSearchConfigured();
  const boostNodes = await curriculumNodesForBoost();
  const localRanked = useRemoteOnly
    ? []
    : curriculumBoost(
        normalizedQuery,
        searchLocalCatalog(normalizedQuery, {
          limit: limit * 4,
          sourceType: options.sourceType,
          curriculumPath: options.curriculumPath
        }),
        boostNodes
      );

  if (useRemoteOnly) {
    try {
      const remoteResults = await searchSupabase(normalizedQuery, {
        limit: limit * 4,
        sourceType: options.sourceType,
        curriculumPath: options.curriculumPath,
        clientIpHash: options.clientIpHash
      });
      return {
        mode: "hybrid",
        results: await finalizeSearchResults(remoteResults ?? [], limit)
      };
    } catch {
      return { mode: "hybrid", results: [] };
    }
  }

  try {
    const remoteResults = await searchSupabase(normalizedQuery, {
      limit: limit * 4,
      sourceType: options.sourceType,
      curriculumPath: options.curriculumPath,
      clientIpHash: options.clientIpHash
    });

    if (remoteResults?.length) {
      const remoteRanked: RankedChunk[] = remoteResults.map((result) => ({
        score: result.score,
        chunk: {
          id: result.id,
          sourceId: result.sourceId,
          chunkIndex: 0,
          content: result.content,
          metadata: result.metadata,
          whenToUse: result.whenToUse,
          startMs: result.startMs,
          endMs: result.endMs
        },
        source: {
          id: result.sourceId,
          sourceType: result.sourceType,
          title: result.sourceTitle,
          canonicalUrl: result.canonicalUrl,
          curriculumPath: result.curriculumPath,
          bodyMarkdown: "",
          videoIds: [],
          contentHash: "",
          visibility: "published",
          extractionStatus: "indexed",
          extractedAt: "",
          updatedAt: "",
          pageKind: result.pageKind
        }
      }));

      const fused = fuseRankedLists([localRanked, remoteRanked]);
      return {
        mode: "hybrid",
        results: await finalizeSearchResults(rankedToSearchResults(fused), limit)
      };
    }
  } catch {
    // Fall back to local seed catalog when Postgres is unavailable.
  }

  return {
    mode: "local",
    results: pickBestResultPerSource(rankedToSearchResults(localRanked), limit)
  };
}

export async function fetchCommunityEvidence(id: string): Promise<FetchResult | null> {
  const fromDb = await fetchEvidenceFromDb(id);
  if (fromDb) return fromDb;

  if (isRemoteSearchConfigured()) return null;

  const seed = getSeedChunk(id);
  const sourceId = seed?.source.id ?? id;
  const chunks = getSeedSourceChunks(sourceId);
  if (chunks.length === 0) return null;

  const source = seed?.source ?? getSeedChunk(chunks[0]!.id)?.source;
  if (!source) return null;

  return {
    id: sourceId,
    source,
    chunk: chunks[0]!,
    nearbyChunks: chunks,
    assets: []
  };
}

export async function browseCurriculum(parentId: string | null = null): Promise<CurriculumNode[]> {
  const fromDb = await browseCurriculumFromDb(parentId);
  if (fromDb?.length) return fromDb;
  if (isRemoteSearchConfigured()) return [];

  const nodes = getSeedCurriculumNodes();
  return nodes.filter((node) => (node.parentId ?? null) === parentId);
}

export async function listRecentUpdates(limit = 10) {
  const fromDb = await listRecentUpdatesFromDb(limit);
  if (fromDb?.length) return fromDb;
  if (isRemoteSearchConfigured()) return [];
  return listSeedRecentUpdates(limit);
}
