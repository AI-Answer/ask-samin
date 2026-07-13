const ANCHORED_RESULT_PREFIX = "a1";

export interface DecodedEvidenceId {
  chunkId: string;
  startMs: number;
}

/** Encode a search hit so MCP fetch can preserve the exact caption cue. */
export function encodeEvidenceId(chunkId: string, startMs: number): string {
  if (!chunkId || !Number.isInteger(startMs) || startMs < 0) return chunkId;
  return `${ANCHORED_RESULT_PREFIX}:${encodeURIComponent(chunkId)}:${startMs}`;
}

/** Decode an anchored ID while leaving legacy chunk/source IDs compatible. */
export function decodeEvidenceId(value: string): DecodedEvidenceId | null {
  const match = /^a1:([^:]+):(\d+)$/.exec(value);
  if (!match) return null;

  const startMs = Number(match[2]);
  if (!Number.isSafeInteger(startMs)) return null;

  try {
    const chunkId = decodeURIComponent(match[1]);
    return chunkId ? { chunkId, startMs } : null;
  } catch {
    return null;
  }
}
