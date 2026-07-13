import catalogJson from "../data/catalog.generated.json";

import type { CatalogPayload, KnowledgeChunk, KnowledgeSource } from "./types";

const catalog = catalogJson as CatalogPayload;
const sourcesById = new Map(catalog.sources.map((source) => [source.id, source]));
const chunksById = new Map(catalog.chunks.map((chunk) => [chunk.id, chunk]));
const chunksBySourceId = new Map<string, KnowledgeChunk[]>();

for (const chunk of catalog.chunks) {
  const sourceChunks = chunksBySourceId.get(chunk.sourceId) ?? [];
  sourceChunks.push(chunk);
  chunksBySourceId.set(chunk.sourceId, sourceChunks);
}

for (const chunks of chunksBySourceId.values()) {
  chunks.sort((left, right) => left.startMs - right.startMs || left.id.localeCompare(right.id));
}

export function getCatalog(): CatalogPayload {
  return catalog;
}

export function getCatalogSource(sourceId: string): KnowledgeSource | undefined {
  return sourcesById.get(sourceId);
}

export function getCatalogChunksForSource(sourceId: string): KnowledgeChunk[] {
  return [...(chunksBySourceId.get(sourceId) ?? [])];
}

export function getCatalogChunk(chunkId: string): KnowledgeChunk | undefined {
  return chunksById.get(chunkId);
}
