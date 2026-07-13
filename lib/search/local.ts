import MiniSearch from "minisearch";

import { getCatalog } from "../catalog";
import type { KnowledgeChunk, SourceKind } from "../types";
import { anchorChunkToQuery } from "./cue-anchor";

interface LocalSearchDocument {
  id: string;
  chunkId: string;
  sourceKind: SourceKind;
  title: string;
  text: string;
  description: string;
  tags: string;
}

export interface RankedChunk {
  chunk: KnowledgeChunk;
  score: number;
}

const INTENT_CANDIDATE_FLOOR = 80;
const INTENT_CANDIDATE_CEILING = 160;
const QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "can",
  "do",
  "does",
  "how",
  "i",
  "in",
  "is",
  "my",
  "of",
  "or",
  "the",
  "to",
  "what"
]);
const SETUP_ACTIONS = ["add", "connect", "configure", "install", "setup"] as const;
const PROCEDURE_MARKERS = [
  "api key",
  "authorize",
  "copy",
  "custom connector",
  "get started",
  "manage",
  "mcp status",
  "new mcp server",
  "paste",
  "plus button",
  "terminal",
  "verify",
  "/mcp"
] as const;
const NON_DEFINITION_STATES = [
  "available",
  "configured",
  "connected",
  "enabled",
  "installed",
  "running"
] as const;

const catalog = getCatalog();
const chunksById = new Map(catalog.chunks.map((chunk) => [chunk.id, chunk]));
const sourcesById = new Map(catalog.sources.map((source) => [source.id, source]));

const documents: LocalSearchDocument[] = catalog.chunks.map((chunk) => {
  const source = sourcesById.get(chunk.sourceId);
  return {
    id: chunk.id,
    chunkId: chunk.id,
    sourceKind: chunk.sourceKind,
    title: chunk.sourceTitle,
    text: chunk.text,
    description: source?.description ?? "",
    tags: source?.tags.join(" ") ?? ""
  };
});

const miniSearch = new MiniSearch<LocalSearchDocument>({
  fields: ["title", "text", "description", "tags"],
  storeFields: ["chunkId", "sourceKind"],
  searchOptions: {
    boost: { title: 4, text: 2, description: 1.25, tags: 1.5 },
    combineWith: "OR",
    prefix: true,
    fuzzy: (term) => (term.length >= 6 ? 0.15 : false)
  }
});

miniSearch.addAll(documents);

function normalizeQuery(query: string): string {
  return query.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function supplementalIntentQueries(query: string): string[] {
  const normalized = query.toLocaleLowerCase();
  if (!/\b(?:mcp|connector)\b/.test(normalized)) return [];

  const supplements: string[] = [];
  const definitionIntent =
    /^(?:what is|define|definition|meaning)\b/.test(normalized) ||
    /^what does .+ mean\b/.test(normalized) ||
    /\bwhat\s+(?:an?\s+)?(?:mcp|connector)\s+is\b/.test(normalized) ||
    /\bunderstand(?:ing)?\s+(?:an?\s+)?(?:mcp|connector)\b/.test(normalized) ||
    /\b(?:meaning|definition)\s+of\s+(?:an?\s+)?(?:mcp|connector)\b/.test(normalized);
  if (definitionIntent) supplements.push("what is MCP model context protocol");

  const setupIntent =
    /\b(?:add|connect\w*|configur\w*|install\w*|set up|setup)\b/.test(normalized) ||
    /(?:^|[.!?\n]\s*)how\b/.test(normalized);
  if (setupIntent) {
    if (/\bclaude code\b/.test(normalized)) {
      supplements.push("install MCP Claude Code terminal verify /mcp");
    } else if (/\bclaude(?: desktop)?\b/.test(normalized)) {
      supplements.push("add custom connector manage connectors Claude Desktop MCP");
    } else if (/\bchatgpt\b/.test(normalized)) {
      supplements.push("connect MCP ChatGPT developer app");
    } else {
      supplements.push("connect install MCP custom connector AI client");
    }
  }

  return supplements;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function queryTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLocaleLowerCase()
        .replace(/[^a-z0-9/]+/g, " ")
        .trim()
        .split(/\s+/)
        .filter((term) => term && !QUERY_STOP_WORDS.has(term))
    )
  ];
}

function hasAcronymExpansion(text: string, acronym: string): boolean {
  if (!/^[a-z]{2,6}$/.test(acronym)) return false;
  const expansion = acronym
    .split("")
    .map((letter) => `${escapeRegExp(letter)}[a-z]+`)
    .join("\\s+");
  return new RegExp(`\\b${expansion}\\b`, "i").test(text);
}

function definitionSignalScore(query: string, text: string, terms: string[]): number {
  const normalizedQuery = query.toLocaleLowerCase();
  const isDefinitionQuestion =
    /^(?:what is|define|definition|meaning)\b/.test(normalizedQuery) ||
    /^what does .+ mean\b/.test(normalizedQuery) ||
    /\bwhat\s+(?:an?\s+)?(?:mcp|connector)\s+is\b/.test(normalizedQuery) ||
    /\bunderstand(?:ing)?\s+(?:an?\s+)?(?:mcp|connector)\b/.test(normalizedQuery) ||
    /\b(?:meaning|definition)\s+of\s+(?:an?\s+)?(?:mcp|connector)\b/.test(normalizedQuery);
  if (!isDefinitionQuestion || terms.length === 0) return 0;

  const subjects = new Set([terms.join(" "), ...terms.filter((term) => term.length <= 6)]);
  const blockedStates = NON_DEFINITION_STATES.join("|");
  let score = 0;

  for (const subject of subjects) {
    const escapedSubject = escapeRegExp(subject);
    const directDefinition = new RegExp(
      `\\b(?:an?\\s+)?${escapedSubject}\\s+is\\s+(?!(?:${blockedStates})\\b)`,
      "gi"
    );
    const reverseDefinition = new RegExp(
      `\\bwhat\\s+(?:an?\\s+)?${escapedSubject}\\s+is\\b`,
      "i"
    );
    const explanationWindow = new RegExp(
      `\\b${escapedSubject}\\b.{0,180}\\b(?:access|bridge|connector|interface|outside world|standard process)\\b`,
      "i"
    );

    score += [...text.matchAll(directDefinition)].length * 4;
    if (reverseDefinition.test(text)) score += 4;
    if (explanationWindow.test(text)) score += 2;
  }

  const acronym = terms.length === 1 ? terms[0] : terms.find((term) => term === "mcp");
  if (acronym && hasAcronymExpansion(text, acronym)) score += 8;
  return score;
}

function setupSignalScore(query: string, text: string, terms: string[]): number {
  const normalizedQuery = query.toLocaleLowerCase();
  const requestedActions = SETUP_ACTIONS.filter((action) => {
    if (action === "setup") return /\b(?:set up|setup)\b/.test(normalizedQuery);
    return new RegExp(`\\b${action}\\w*\\b`).test(normalizedQuery);
  });
  const isSetupQuestion = requestedActions.length > 0 || /^how\b/.test(normalizedQuery);
  if (!isSetupQuestion || !/\b(?:mcp|connector)\b/.test(normalizedQuery)) return 0;

  let score = terms.filter((term) => text.includes(term)).length;
  score += PROCEDURE_MARKERS.filter((marker) => text.includes(marker)).length * 2;

  for (const action of requestedActions) {
    const actionPattern = action === "setup" ? "(?:set\\s+up|setup)" : `${action}\\w*`;
    const nearConnector = new RegExp(
      `(?:\\b${actionPattern}\\b.{0,100}\\b(?:mcp|connector)\\b)|` +
        `(?:\\b(?:mcp|connector)\\b.{0,100}\\b${actionPattern}\\b)`,
      "i"
    );
    if (nearConnector.test(text)) score += 4;
  }

  return score;
}

function intentSignalScore(query: string, chunk: KnowledgeChunk): number {
  const text = chunk.text.normalize("NFKC").toLocaleLowerCase();
  const terms = queryTerms(query);
  return (
    definitionSignalScore(query, text, terms) + setupSignalScore(query, text, terms)
  );
}

function isDefinitionEvidence(chunk: KnowledgeChunk): boolean {
  const text = chunk.text.normalize("NFKC").toLocaleLowerCase();
  return (
    /\b(?:an?\s+)?mcp\s+is\s+(?!(?:available|configured|connected|enabled|installed|running)\b)/.test(
      text
    ) || /\bmodel context protocol\b/.test(text)
  );
}

function isProcedureEvidence(chunk: KnowledgeChunk): boolean {
  const text = chunk.text.normalize("NFKC").toLocaleLowerCase();
  return PROCEDURE_MARKERS.some((marker) => text.includes(marker));
}

function hasMixedDefinitionAndSetupIntent(query: string): boolean {
  const supplements = supplementalIntentQueries(query);
  return (
    supplements.some((supplement) => supplement.startsWith("what is MCP")) &&
    supplements.some((supplement) => !supplement.startsWith("what is MCP"))
  );
}

export function searchLocalCatalog(
  query: string,
  options: { limit: number; kinds?: SourceKind[] }
): RankedChunk[] {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) return [];

  const allowedKinds = options.kinds?.length ? new Set(options.kinds) : undefined;
  const candidateLimit = Math.min(
    INTENT_CANDIDATE_CEILING,
    Math.max(INTENT_CANDIDATE_FLOOR, options.limit)
  );
  const mergedResults = new Map<string, ReturnType<typeof miniSearch.search>[number]>();
  for (const searchQuery of [normalizedQuery, ...supplementalIntentQueries(normalizedQuery)]) {
    const searchResults = miniSearch
      .search(searchQuery)
      .filter((result) => {
        const kind = result.sourceKind as SourceKind | undefined;
        return !allowedKinds || (kind !== undefined && allowedKinds.has(kind));
      })
      .sort(
        (left, right) =>
          right.score - left.score || String(left.id).localeCompare(String(right.id))
      )
      .slice(0, candidateLimit);

    for (const result of searchResults) {
      const id = String(result.chunkId ?? result.id);
      const current = mergedResults.get(id);
      if (!current || result.score > current.score) mergedResults.set(id, result);
    }
  }

  const rankedCandidates = [...mergedResults.values()]
    .flatMap((result) => {
      const chunk = chunksById.get(String(result.chunkId ?? result.id));
      if (!chunk) return [];
      const anchoredChunk = anchorChunkToQuery(chunk, normalizedQuery);
      if (!anchoredChunk) return [];
      return [
        {
          result,
          chunk: anchoredChunk,
          intentScore: intentSignalScore(normalizedQuery, chunk),
          definitionEvidence: isDefinitionEvidence(chunk),
          procedureEvidence: isProcedureEvidence(chunk)
        }
      ];
    })
    .sort(
      (left, right) =>
        right.intentScore - left.intentScore ||
        right.result.score - left.result.score ||
        left.chunk.id.localeCompare(right.chunk.id)
    );

  const candidates = hasMixedDefinitionAndSetupIntent(normalizedQuery)
    ? (() => {
        const definition = rankedCandidates.find((candidate) => candidate.definitionEvidence);
        const procedure = rankedCandidates.find(
          (candidate) =>
            candidate.procedureEvidence && candidate.chunk.sourceId !== definition?.chunk.sourceId
        );
        const promoted = [definition, procedure].filter(
          (candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate)
        );
        const promotedIds = new Set(promoted.map((candidate) => candidate.chunk.id));
        return [
          ...promoted,
          ...rankedCandidates.filter((candidate) => !promotedIds.has(candidate.chunk.id))
        ];
      })()
    : rankedCandidates;

  return candidates.slice(0, options.limit).map(({ result, chunk }) => ({
    chunk,
    score: Math.round(result.score * 1_000_000) / 1_000_000
  }));
}
