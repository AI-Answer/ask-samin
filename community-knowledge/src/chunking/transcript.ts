export interface TranscriptCue {
  startMs: number;
  endMs: number;
  text: string;
}

function parseTimestamp(value: string): number {
  const parts = value.trim().split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part))) return 0;
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1_000;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1_000;
  return 0;
}

export function parseTimestampedTranscript(transcript: string): TranscriptCue[] {
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
    const text = lines.slice(lines.indexOf(timeLine) + 1).join(" ").trim();
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
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
