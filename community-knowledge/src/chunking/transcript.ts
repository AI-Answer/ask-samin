export interface TranscriptCue {
  startMs: number;
  endMs: number;
  text: string;
}

function parseTimestamp(value: string): number {
  const parts = value.trim().split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part))) return 0;
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return Math.round((hours * 3600 + minutes * 60 + seconds) * 1_000);
  }
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1_000;
  return 0;
}

/**
 * YouTube auto-captions often arrive as karaoke/word-timed markup:
 * `Welcome<00:00:00.560><c> to</c><00:00:00.800><c> the</c>`
 * Strip tags into clean timed cues (not raw VTT garbage for embeddings).
 */
export function parseYoutubeKaraokeCaptions(raw: string): TranscriptCue[] {
  const strippedHeader = raw
    .replace(/Kind:\s*captions\s*/gi, " ")
    .replace(/Language:\s*[a-z-]+\s*/gi, " ");

  const wordPattern = /<(\d{2}:\d{2}:\d{2}\.\d{1,3})><c>\s*([^<]+?)\s*<\/c>/g;
  const words: Array<{ startMs: number; text: string }> = [];
  let match = wordPattern.exec(strippedHeader);
  while (match) {
    const text = match[2].replace(/\s+/g, " ").trim();
    if (text) {
      words.push({ startMs: parseTimestamp(match[1]), text });
    }
    match = wordPattern.exec(strippedHeader);
  }

  if (words.length === 0) return [];

  const firstTagAt = strippedHeader.search(/<\d{2}:\d{2}:\d{2}\.\d{1,3}>/);
  if (firstTagAt > 0) {
    const lead = strippedHeader
      .slice(0, firstTagAt)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (lead) {
      words.unshift({ startMs: Math.max(0, words[0].startMs - 1_000), text: lead });
    }
  }

  // Group ~12s / ~42 words into phrase cues for readable chunks.
  const cues: TranscriptCue[] = [];
  let buffer: Array<{ startMs: number; text: string }> = [];
  const flush = (): void => {
    if (!buffer.length) return;
    const text = buffer.map((word) => word.text).join(" ").replace(/\s+/g, " ").trim();
    if (text) {
      const startMs = buffer[0].startMs;
      const last = buffer[buffer.length - 1];
      cues.push({
        startMs,
        endMs: Math.max(startMs + 1_000, last.startMs + 1_500),
        text
      });
    }
    buffer = [];
  };

  for (const word of words) {
    const span = buffer.length ? word.startMs - buffer[0].startMs : 0;
    if (buffer.length >= 42 || span >= 12_000) flush();
    buffer.push(word);
  }
  flush();
  return cues;
}

export function parseTimestampedTranscript(transcript: string): TranscriptCue[] {
  const karaoke = parseYoutubeKaraokeCaptions(transcript);
  if (karaoke.length > 0) return karaoke;

  const cues: TranscriptCue[] = [];
  const bracketPattern = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*([^\[]+)/g;
  let match = bracketPattern.exec(transcript);
  while (match) {
    const startMs = parseTimestamp(match[1]);
    const text = match[2].trim();
    if (text) cues.push({ startMs, endMs: startMs, text });
    match = bracketPattern.exec(transcript);
  }
  if (cues.length > 0) {
    for (let index = 0; index < cues.length; index += 1) {
      const next = cues[index + 1];
      cues[index].endMs = next ? next.startMs : cues[index].startMs + 30_000;
    }
    return cues;
  }

  const vttBlocks = transcript.split(/\n\n+/);
  for (const block of vttBlocks) {
    const lines = block.trim().split("\n");
    const timeLine = lines.find((line) => line.includes("-->"));
    if (!timeLine) continue;
    const [startRaw, endRaw] = timeLine.split("-->").map((part) => part.trim().split(" ")[0]);
    const text = lines
      .slice(lines.indexOf(timeLine) + 1)
      .join(" ")
      .replace(/<\/?v[^>]*>/gi, " ")
      .replace(/<\/?c>/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    cues.push({
      startMs: parseTimestamp(startRaw.replace(",", ".")),
      endMs: parseTimestamp(endRaw.replace(",", ".")),
      text
    });
  }

  return cues;
}

export function chunkTranscriptCues(
  cues: TranscriptCue[],
  maxChars = 900
): Array<{ chunkIndex: number; content: string; startMs: number; endMs: number }> {
  const chunks: Array<{ chunkIndex: number; content: string; startMs: number; endMs: number }> = [];
  let buffer: TranscriptCue[] = [];
  let bufferChars = 0;

  function flush(): void {
    if (buffer.length === 0) return;
    const content = buffer.map((cue) => `[${formatMs(cue.startMs)}] ${cue.text}`).join("\n");
    chunks.push({
      chunkIndex: chunks.length,
      content,
      startMs: buffer[0].startMs,
      endMs: buffer[buffer.length - 1].endMs
    });
    buffer = [];
    bufferChars = 0;
  }

  for (const cue of cues) {
    const nextLen = bufferChars + cue.text.length + 16;
    if (buffer.length > 0 && nextLen > maxChars) flush();
    buffer.push(cue);
    bufferChars += cue.text.length + 16;
  }
  flush();
  return chunks;
}

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1_000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
