import { rankCitationSources } from "../citations";
import { isEligibleRecommendationChunk } from "../recommendation-eligibility";
import type { CitationSource, SourceKind } from "../types";
import { searchLocalCatalog } from "./local";
import { searchSupabase } from "./supabase";
import type { RankedChunk } from "./local";

export interface LibrarySearchOptions {
  limit?: number;
  kinds?: SourceKind[];
}

export interface LibrarySearchResult {
  query: string;
  mode: "hybrid" | "local";
  sources: CitationSource[];
}

function diversifySources(results: RankedChunk[], limit: number): RankedChunk[] {
  const seenSourceIds = new Set<string>();
  const seenTitles = new Set<string>();
  const diversified: RankedChunk[] = [];

  for (const result of results) {
    if (!isEligibleRecommendationChunk(result.chunk)) continue;
    const normalizedTitle = result.chunk.sourceTitle
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase();
    if (seenSourceIds.has(result.chunk.sourceId) || seenTitles.has(normalizedTitle)) continue;
    seenSourceIds.add(result.chunk.sourceId);
    seenTitles.add(normalizedTitle);
    diversified.push(result);
    if (diversified.length >= limit) break;
  }

  return diversified;
}

export function fuseRankedSources(
  rankedLists: RankedChunk[][],
  limit: number,
  rrfK = 60
): RankedChunk[] {
  const fused = new Map<
    string,
    { chunk: RankedChunk["chunk"]; score: number; bestContribution: number; bestRawScore: number }
  >();

  for (const list of rankedLists) {
    list.forEach((result, index) => {
      if (!isEligibleRecommendationChunk(result.chunk)) return;
      const contribution = 1 / (rrfK + index + 1);
      const current = fused.get(result.chunk.sourceId);
      if (!current) {
        fused.set(result.chunk.sourceId, {
          chunk: result.chunk,
          score: contribution,
          bestContribution: contribution,
          bestRawScore: result.score
        });
        return;
      }

      current.score += contribution;
      if (
        contribution > current.bestContribution ||
        (contribution === current.bestContribution && result.score > current.bestRawScore)
      ) {
        current.chunk = result.chunk;
        current.bestContribution = contribution;
        current.bestRawScore = result.score;
      }
    });
  }

  return [...fused.values()]
    .sort(
      (left, right) =>
        right.score - left.score || left.chunk.id.localeCompare(right.chunk.id)
    )
    .slice(0, limit)
    .map(({ chunk, score }) => ({ chunk, score }));
}

export async function searchSaminLibrary(
  query: string,
  options: LibrarySearchOptions = {}
): Promise<LibrarySearchResult> {
  const normalizedQuery = query.normalize("NFKC").replace(/\s+/g, " ").trim();
  const limit = Math.min(20, Math.max(1, Math.floor(options.limit ?? 8)));
  const candidateLimit = Math.min(160, Math.max(limit * 8, limit));
  if (!normalizedQuery) return { query: normalizedQuery, mode: "local", sources: [] };

  // Recommendation search is intentionally narrower than library browsing.
  // Intersect caller filters with the only eligible source kind so `short`
  // cannot be used to bypass the evidence rule through the public API.
  const requestedKinds = options.kinds?.length ? options.kinds : (["video"] as SourceKind[]);
  const recommendationKinds = requestedKinds.filter((kind) => kind === "video");
  if (recommendationKinds.length === 0) {
    return { query: normalizedQuery, mode: "local", sources: [] };
  }

  const localResults = searchLocalCatalog(normalizedQuery, {
    limit: candidateLimit,
    kinds: recommendationKinds
  });

  try {
    const remoteResults = await searchSupabase(normalizedQuery, {
      limit: candidateLimit,
      kinds: recommendationKinds
    });
    if (remoteResults?.length) {
      const fusedResults = fuseRankedSources([localResults, remoteResults], candidateLimit);
      return {
        query: normalizedQuery,
        mode: "hybrid",
        sources: rankCitationSources(diversifySources(fusedResults, limit), limit)
      };
    }
  } catch {
    // A configured but unavailable database must not take down the public library.
  }

  return {
    query: normalizedQuery,
    mode: "local",
    sources: rankCitationSources(diversifySources(localResults, limit), limit)
  };
}
