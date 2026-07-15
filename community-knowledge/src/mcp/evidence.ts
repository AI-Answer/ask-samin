import type { FetchResult, SearchResult } from "../types";

export interface McpSearchResult {
  id: string;
  title: string;
  text: string;
  url: string;
}

export interface McpFetchDocument {
  id: string;
  title: string;
  text: string;
  url: string;
  metadata: {
    sourceType: string;
    curriculumPath: string[];
    whenToUse?: string;
    timed: boolean;
  };
}

export function buildMcpSearchResults(results: SearchResult[]): McpSearchResult[] {
  const seen = new Set<string>();
  return results.flatMap((result) => {
    if (seen.has(result.id)) return [];
    seen.add(result.id);
    return [
      {
        id: result.id,
        title: result.sourceTitle,
        text: result.content,
        url: result.canonicalUrl
      }
    ];
  });
}

export function buildMcpFetchDocument(record: FetchResult): McpFetchDocument {
  const text = record.nearbyChunks.map((chunk) => chunk.content).join("\n\n");
  const timed = record.nearbyChunks.some((chunk) => chunk.metadata.timed === true);

  return {
    id: record.id,
    title: record.source.title,
    text: text || record.source.bodyMarkdown || record.chunk.content,
    url: record.source.canonicalUrl,
    metadata: {
      sourceType: record.source.sourceType,
      curriculumPath: record.source.curriculumPath,
      whenToUse: record.chunk.whenToUse ?? record.source.whenToUse,
      timed
    }
  };
}

export interface CurriculumBrowseNode {
  id: string;
  title: string;
  slug: string;
  nodeType: string;
  sourceId?: string;
  children?: CurriculumBrowseNode[];
}

export function flattenCurriculumNodes(
  nodes: Array<{
    id: string;
    title: string;
    slug: string;
    nodeType: string;
    sourceId?: string;
  }>
): CurriculumBrowseNode[] {
  return nodes.map((node) => ({
    id: node.id,
    title: node.title,
    slug: node.slug,
    nodeType: node.nodeType,
    sourceId: node.sourceId
  }));
}
