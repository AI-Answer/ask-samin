import { createHash } from "node:crypto";

export function hashContent(value: string): string {
  return createHash("sha256").update(value.normalize("NFKC")).digest("hex");
}

export function htmlToMarkdown(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h([1-6])>/gi, (_, level: string) => `\n${"#".repeat(Number(level))} `)
    .replace(/<h([1-6])[^>]*>/gi, (_, level: string) => `\n${"#".repeat(Number(level))} `)
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function summarizeWhenToUse(title: string, body: string): string {
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 180);
  return snippet ? `${title}: ${snippet}` : title;
}

export interface MarkdownChunk {
  chunkIndex: number;
  content: string;
  headingPath: string[];
}

export function chunkMarkdown(markdown: string, maxChars = 1_200): MarkdownChunk[] {
  const lines = markdown.split("\n");
  const sections: Array<{ headingPath: string[]; content: string[] }> = [];
  let headingPath: string[] = [];
  let current: string[] = [];

  function flush(): void {
    const text = current.join("\n").trim();
    if (text) sections.push({ headingPath: [...headingPath], content: [text] });
    current = [];
  }

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      const title = heading[2].trim();
      headingPath = headingPath.slice(0, level - 1);
      headingPath[level - 1] = title;
      continue;
    }
    current.push(line);
  }
  flush();

  const chunks: MarkdownChunk[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const prefix = section.headingPath.length
      ? `${section.headingPath.join(" > ")}\n\n`
      : "";
    const body = section.content.join("\n\n").trim();
    const full = `${prefix}${body}`.trim();
    if (!full) continue;

    if (full.length <= maxChars) {
      chunks.push({ chunkIndex: chunkIndex++, content: full, headingPath: section.headingPath });
      continue;
    }

    let offset = 0;
    while (offset < full.length) {
      const slice = full.slice(offset, offset + maxChars).trim();
      if (slice) chunks.push({ chunkIndex: chunkIndex++, content: slice, headingPath: section.headingPath });
      offset += maxChars;
    }
  }

  if (chunks.length === 0 && markdown.trim()) {
    chunks.push({ chunkIndex: 0, content: markdown.trim(), headingPath: [] });
  }

  return chunks;
}
