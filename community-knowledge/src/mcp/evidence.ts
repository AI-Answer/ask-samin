import type { FetchResult, SearchResult, SourceAsset } from "../types";
import {
  ATTRIBUTION,
  buildCitationText,
  buildMatchReference,
  buildMatchReferenceFromSearch,
  buildSnippet,
  pickBestResultPerSource,
  selectFetchChunks,
  truncateBody,
  type MatchReference
} from "./reference";

export interface McpAssetRef {
  assetType: string;
  fileId?: string;
  fileName?: string;
  url?: string;
}

export interface McpSearchResult {
  id: string;
  sourceId: string;
  title: string;
  /** Citation block + snippet — always includes the Skool URL. */
  text: string;
  /** Content-only excerpt (no citation header). */
  snippet: string;
  url: string;
  curriculumPath: string[];
  reference: MatchReference;
  attribution: string;
  pageKind?: string;
  assets: McpAssetRef[];
}

export interface McpFetchDocument {
  id: string;
  sourceId: string;
  title: string;
  /** Citation header + bounded lesson body — always includes the Skool URL. */
  text: string;
  url: string;
  curriculumPath: string[];
  reference: MatchReference;
  attribution: string;
  pageKind?: string;
  assets: McpAssetRef[];
  metadata: {
    sourceType: string;
    whenToUse?: string;
    timed: boolean;
    chunkCount: number;
    truncated: boolean;
  };
}

function mapAssets(assets: SourceAsset[] = []): McpAssetRef[] {
  return assets.map((asset) => ({
    assetType: asset.assetType,
    fileId: asset.fileId,
    fileName: asset.fileName,
    url: asset.url
  }));
}

export function buildMcpSearchResults(results: SearchResult[]): McpSearchResult[] {
  // Dedup is owned by search; keep pickBest here as a safety net for direct callers.
  return pickBestResultPerSource(results).map((result) => {
    const snippet = buildSnippet(result.content);
    const reference = buildMatchReferenceFromSearch(result);
    const text = buildCitationText({
      title: result.sourceTitle,
      url: result.canonicalUrl,
      reference,
      body: snippet
    });

    return {
      id: result.sourceId,
      sourceId: result.sourceId,
      title: result.sourceTitle,
      text,
      snippet,
      url: result.canonicalUrl,
      curriculumPath: result.curriculumPath,
      reference,
      attribution: ATTRIBUTION,
      pageKind: result.pageKind,
      assets: mapAssets(result.assets)
    };
  });
}

export function buildMcpFetchDocument(record: FetchResult): McpFetchDocument {
  const headingPath = Array.isArray(record.chunk.metadata.headingPath)
    ? (record.chunk.metadata.headingPath as string[])
    : undefined;
  const reference = buildMatchReference({
    chunkId: record.chunk.id,
    curriculumPath: record.source.curriculumPath,
    startMs: record.chunk.startMs,
    headingPath
  });

  const selected = selectFetchChunks(record.chunk, record.nearbyChunks);
  let body = selected.chunks.map((chunk) => chunk.content).join("\n\n");
  if (!body.trim()) {
    body = record.source.bodyMarkdown || record.chunk.content;
  }
  const capped = truncateBody(body);
  const text = buildCitationText({
    title: record.source.title,
    url: record.source.canonicalUrl,
    reference,
    body: capped.text
  });

  return {
    id: record.id,
    sourceId: record.source.id,
    title: record.source.title,
    text,
    url: record.source.canonicalUrl,
    curriculumPath: record.source.curriculumPath,
    reference,
    attribution: ATTRIBUTION,
    pageKind: record.source.pageKind,
    assets: mapAssets(record.assets),
    metadata: {
      sourceType: record.source.sourceType,
      whenToUse: record.chunk.whenToUse ?? record.source.whenToUse,
      timed: selected.chunks.some((chunk) => chunk.metadata.timed === true),
      chunkCount: selected.chunks.length,
      truncated: selected.truncated || capped.truncated
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
