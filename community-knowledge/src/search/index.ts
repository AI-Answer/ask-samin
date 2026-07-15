import { getCurriculumNodes as getSeedCurriculumNodes, listRecentUpdates as listSeedRecentUpdates } from "../catalog";
import { browseCurriculumFromDb, fetchEvidenceFromDb, listRecentUpdatesFromDb } from "../db/repository";
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

async function curriculumNodesForBoost(): Promise<CurriculumNode[]> {
  const fromDb = await browseCurriculumFromDb();
  return fromDb?.length ? fromDb : getSeedCurriculumNodes();
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

function fuseRankedLists(lists: RankedChunk[][], limit: number, rrfK = 60): RankedChunk[] {
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
    .slice(0, limit)
    .map(({ chunk, source, score }) => ({ chunk, source, score }));
}

export async function searchCommunityKnowledge(
  query: string,
  options: SearchOptions = {}
): Promise<{ mode: "hybrid" | "local"; results: SearchResult[] }> {
  const normalizedQuery = query.normalize("NFKC").replace(/\s+/g, " ").trim();
  const limit = Math.min(20, Math.max(1, options.limit ?? 5));
  if (!normalizedQuery) return { mode: "local", results: [] };

  const boostNodes = await curriculumNodesForBoost();
  const localRanked = curriculumBoost(
    normalizedQuery,
    searchLocalCatalog(normalizedQuery, {
      limit: limit * 4,
      sourceType: options.sourceType,
      curriculumPath: options.curriculumPath
    }),
    boostNodes
  );

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
          whenToUse: result.whenToUse
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
          updatedAt: ""
        }
      }));

      const fused = fuseRankedLists([localRanked, remoteRanked], limit);
      return { mode: "hybrid", results: rankedToSearchResults(fused) };
    }
  } catch {
    // Fall back to local seed catalog when Postgres is unavailable.
  }

  return {
    mode: "local",
    results: rankedToSearchResults(localRanked.slice(0, limit))
  };
}

export async function fetchCommunityEvidence(chunkId: string): Promise<FetchResult | null> {
  const fromDb = await fetchEvidenceFromDb(chunkId);
  if (fromDb) return fromDb;

  const seed = getSeedChunk(chunkId);
  if (!seed) return null;

  const nearbyChunks = getSeedSourceChunks(seed.source.id);
  const index = nearbyChunks.findIndex((chunk) => chunk.id === chunkId);
  const radius = 1;
  const slice =
    index >= 0
      ? nearbyChunks.slice(Math.max(0, index - radius), Math.min(nearbyChunks.length, index + radius + 1))
      : [seed.chunk];

  return {
    id: chunkId,
    source: seed.source,
    chunk: seed.chunk,
    nearbyChunks: slice
  };
}

export async function browseCurriculum(parentId: string | null = null): Promise<CurriculumNode[]> {
  const fromDb = await browseCurriculumFromDb(parentId);
  if (fromDb?.length) return fromDb;

  const nodes = getSeedCurriculumNodes();
  return nodes.filter((node) => (node.parentId ?? null) === parentId);
}

export async function listRecentUpdates(limit = 10) {
  const fromDb = await listRecentUpdatesFromDb(limit);
  if (fromDb?.length) return fromDb;
  return listSeedRecentUpdates(limit);
}
