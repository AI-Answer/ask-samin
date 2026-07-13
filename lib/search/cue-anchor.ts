import type { KnowledgeChunk, TranscriptCuePoint } from "../types";

const CONTEXT_RADIUS = 2;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "can",
  "do",
  "does",
  "for",
  "how",
  "i",
  "in",
  "is",
  "it",
  "my",
  "of",
  "on",
  "or",
  "the",
  "this",
  "to",
  "what",
  "with"
]);

interface DecodedCue {
  startMs: number;
  endMs: number;
  charStart: number;
  charEnd: number;
  text: string;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

function tokens(value: string): string[] {
  return [
    ...new Set(
      normalize(value)
        .match(/[a-z0-9/]+/g)
        ?.filter((token) => token.length > 1 && !STOP_WORDS.has(token)) ?? []
    )
  ];
}

function decodeCue(chunk: KnowledgeChunk, point: TranscriptCuePoint): DecodedCue | null {
  const [startOffsetMs, durationMs, charStart, charLength] = point;
  const startMs = chunk.startMs + startOffsetMs;
  const endMs = startMs + durationMs;
  const charEnd = charStart + charLength;
  if (
    ![startOffsetMs, durationMs, charStart, charLength].every(Number.isInteger) ||
    startOffsetMs < 0 ||
    durationMs < 0 ||
    charStart < 0 ||
    charLength <= 0 ||
    startMs < chunk.startMs ||
    endMs > chunk.endMs ||
    charEnd > chunk.text.length
  ) {
    return null;
  }

  return {
    startMs,
    endMs,
    charStart,
    charEnd,
    text: chunk.text.slice(charStart, charEnd)
  };
}

function decodedCues(chunk: KnowledgeChunk): DecodedCue[] {
  return (chunk.cuePoints ?? []).flatMap((point) => {
    const cue = decodeCue(chunk, point);
    return cue ? [cue] : [];
  });
}

function tokenMatches(cueToken: string, queryToken: string): boolean {
  if (cueToken === queryToken) return true;
  return queryToken.length >= 4 && cueToken.startsWith(queryToken);
}

function directCueScore(
  cue: DecodedCue,
  queryTerms: string[],
  definitionIntent: boolean,
  setupIntent: boolean
): number {
  const cueText = normalize(cue.text);
  const cueTokens = tokens(cueText);
  let score = 0;

  for (const queryTerm of queryTerms) {
    if (!cueTokens.some((cueToken) => tokenMatches(cueToken, queryTerm))) continue;
    score += queryTerm === "mcp" ? 12 : queryTerm.length >= 6 ? 5 : 3;
  }

  if (definitionIntent) {
    if (/\b(?:an?\s+)?mcps?\b[^.]{0,24}\bis\b/.test(cueText)) score += 45;
    if (/\bmodel context protocol\b/.test(cueText)) score += 45;
    if (/\bmcps?\b/.test(cueText) && /\b(?:means|stands for)\b/.test(cueText)) score += 35;
  }

  if (setupIntent) {
    if (/\badd custom connector\b/.test(cueText)) score += 50;
    if (/\binstall\w*\b[^.]{0,45}\bmcps?\b|\bmcps?\b[^.]{0,45}\binstall\w*\b/.test(cueText)) {
      score += 45;
    }
    if (/\bmanage connectors?\b/.test(cueText)) score += 24;
    if (/\b(?:copy|paste|terminal|verify|mcp status|\/mcp)\b/.test(cueText)) score += 14;
    if (/\bconnect\w*\b/.test(cueText)) score += 8;
  }

  return score;
}

function queryIntent(query: string): { definition: boolean; setup: boolean } {
  const normalized = normalize(query);
  const mentionsMcp = /\b(?:mcp|connector)\b/.test(normalized);
  return {
    definition:
      mentionsMcp &&
      (/(?:^|[.!?\n]\s*)(?:what is|what does|define|definition|meaning)\b/.test(normalized) ||
        /\bwhat\s+(?:an?\s+)?(?:mcp|connector)\s+is\b/.test(normalized) ||
        /\bunderstand(?:ing)?\s+(?:an?\s+)?(?:mcp|connector)\b/.test(normalized) ||
        /\b(?:meaning|definition)\s+of\s+(?:an?\s+)?(?:mcp|connector)\b/.test(normalized)),
    setup:
      mentionsMcp &&
      /\b(?:add|connect\w*|configur\w*|install\w*|set up|setup)\b/.test(normalized)
  };
}

function contextFromCueIndex(
  chunk: KnowledgeChunk,
  cues: DecodedCue[],
  cueIndex: number
): KnowledgeChunk {
  const contextStartIndex = Math.max(0, cueIndex - CONTEXT_RADIUS);
  const contextEndIndex = Math.min(cues.length - 1, cueIndex + CONTEXT_RADIUS);
  const contextStart = cues[contextStartIndex];
  const contextEnd = cues[contextEndIndex];
  const matchedCue = cues[cueIndex];
  const base = { ...chunk };
  delete base.cuePoints;

  return {
    ...base,
    startMs: matchedCue.startMs,
    endMs: Math.max(matchedCue.endMs, contextEnd.endMs),
    text: chunk.text.slice(contextStart.charStart, contextEnd.charEnd)
  };
}

/**
 * Refine a broad retrieval chunk to the exact stored caption cue that best
 * matches the member's words. The surrounding ±2 cues remain as readable
 * conversation context, while the link starts at the matched cue itself.
 */
export function anchorChunkToQuery(
  chunk: KnowledgeChunk,
  query: string
): KnowledgeChunk | null {
  const cues = decodedCues(chunk);
  if (cues.length === 0) return chunk;

  const queryTerms = tokens(query);
  if (queryTerms.length === 0) return null;
  const intent = queryIntent(query);
  const directScores = cues.map((cue) =>
    directCueScore(cue, queryTerms, intent.definition, intent.setup)
  );

  let bestIndex = -1;
  let bestScore = 0;
  for (let index = 0; index < cues.length; index += 1) {
    const direct = directScores[index];
    if (direct <= 0) continue;
    const nearby =
      (directScores[index - 1] ?? 0) +
      (directScores[index + 1] ?? 0) +
      (directScores[index - 2] ?? 0) * 0.5 +
      (directScores[index + 2] ?? 0) * 0.5;
    const score = direct * 4 + nearby;
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }

  return bestIndex >= 0 ? contextFromCueIndex(chunk, cues, bestIndex) : null;
}

export function hasStoredCueStart(chunk: KnowledgeChunk, startMs: number): boolean {
  const cues = decodedCues(chunk);
  if (cues.length === 0) return startMs === chunk.startMs;
  return cues.some((cue) => cue.startMs === startMs);
}

export function cueContextAtStart(
  chunk: KnowledgeChunk,
  startMs: number
): KnowledgeChunk | null {
  const cues = decodedCues(chunk);
  if (cues.length === 0) return startMs === chunk.startMs ? chunk : null;
  const index = cues.findIndex((cue) => cue.startMs === startMs);
  return index >= 0 ? contextFromCueIndex(chunk, cues, index) : null;
}
