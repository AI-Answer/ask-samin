/**
 * Deterministic ASR / Club terminology repair.
 * Apply BEFORE any LLM extract so "hermits" never becomes a RAG chunk.
 */

export interface GlossaryReplacement {
  /** Case-insensitive match; word-ish boundaries. */
  from: RegExp;
  to: string;
  label: string;
}

/** Known Club / AI mishearings — extend as new ASR errors appear. */
export const CALL_GLOSSARY: GlossaryReplacement[] = [
  { from: /\bhermits?\b/gi, to: "Hermes", label: "hermit(s)→Hermes" },
  { from: /\bhermese\b/gi, to: "Hermes", label: "hermese→Hermes" },
  { from: /\bhermis\b/gi, to: "Hermes", label: "hermis→Hermes" },
  { from: /\bcloud\s*code\b/gi, to: "Claude Code", label: "cloud code→Claude Code" },
  { from: /\bclaude\s*code\b/gi, to: "Claude Code", label: "claude code casing" },
  { from: /\bcloud\s*club\b/gi, to: "Claude Club", label: "cloud club→Claude Club" },
  { from: /\bclot\s*club\b/gi, to: "Claude Club", label: "clot club→Claude Club" },
  { from: /\bclaude\s*club\b/gi, to: "Claude Club", label: "claude club casing" },
  { from: /\bsalmon\b/gi, to: "Samin", label: "salmon→Samin" },
  { from: /\bsaman\b/gi, to: "Samin", label: "saman→Samin" },
  { from: /\bsamin\b/gi, to: "Samin", label: "samin casing" },
  { from: /\bdeep\s*sick\b/gi, to: "DeepSeek", label: "deep sick→DeepSeek" },
  { from: /\bdeepseek\b/gi, to: "DeepSeek", label: "deepseek casing" },
  { from: /\bkimmy\b/gi, to: "Kimi", label: "kimmy→Kimi" },
  { from: /\bkemi\b/gi, to: "Kimi", label: "kemi→Kimi" },
  { from: /\bhicks\s*field\b/gi, to: "Higgsfield", label: "hicks field→Higgsfield" },
  { from: /\bhicks\s*filled\b/gi, to: "Higgsfield", label: "hicks filled→Higgsfield" },
  { from: /\bnews\s*portal\b/gi, to: "Nous Portal", label: "news portal→Nous Portal" },
  { from: /\bchat\s*gpt\b/gi, to: "ChatGPT", label: "chat gpt→ChatGPT" },
  { from: /\bchatgpt\b/gi, to: "ChatGPT", label: "chatgpt casing" },
  { from: /\bopen\s*ai\b/gi, to: "OpenAI", label: "open ai→OpenAI" },
  { from: /\bopenai\b/gi, to: "OpenAI", label: "openai casing" },
  { from: /\bpaper\s*token\b/gi, to: "pay-per-token", label: "paper token→pay-per-token" },
  { from: /\bmcps?\b/gi, to: "MCP", label: "mcp casing" },
  { from: /\bgpts?\b/gi, to: "GPT", label: "gpt casing" },
  { from: /\bapis?\b/gi, to: "API", label: "api casing" },
  { from: /\bgithub\b/gi, to: "GitHub", label: "github casing" },
  { from: /\bcodex\b/gi, to: "Codex", label: "codex casing" },
  { from: /\bskool\b/gi, to: "Skool", label: "skool casing" },
  { from: /\bsub[-\s]?agents?\b/gi, to: "sub-agents", label: "sub-agents normalize" },
  { from: /\bscheduled\s*tasks?\b/gi, to: "scheduled tasks", label: "scheduled tasks" }
];

export interface GlossaryResult {
  text: string;
  replacements: Array<{ label: string; count: number }>;
}

export function applyCallGlossary(input: string): GlossaryResult {
  let text = input;
  const counts = new Map<string, number>();

  for (const rule of CALL_GLOSSARY) {
    let count = 0;
    text = text.replace(rule.from, () => {
      count += 1;
      return rule.to;
    });
    if (count > 0) {
      counts.set(rule.label, (counts.get(rule.label) ?? 0) + count);
    }
  }

  return {
    text,
    replacements: [...counts.entries()].map(([label, count]) => ({ label, count }))
  };
}
