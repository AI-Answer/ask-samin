/** Known Club / AI tools — drop model junk like "Blow" / "VO". */
export const CALL_TOOL_ALLOWLIST = [
  "Hermes",
  "Claude",
  "Claude Code",
  "Claude Club",
  "Claude Cowork",
  "Ask-Samin",
  "Ask Samin",
  "Samin",
  "MCP",
  "Codex",
  "ChatGPT",
  "OpenAI",
  "GPT",
  "API",
  "GitHub",
  "Skool",
  "DeepSeek",
  "Kimi",
  "Higgsfield",
  "Grok",
  "Nous Portal",
  "Obsidian",
  "Alpaca",
  "Composio",
  "Firecrawl",
  "Playwright",
  "Stripe",
  "Todoist",
  "ClickUp",
  "Brave Search",
  "Tavily",
  "Vercel",
  "Telegram",
  "Discord",
  "Slack",
  "iMessage",
  "Multica",
  "Sora",
  "Veo",
  "n8n",
  "AGI",
  "sub-agents",
  "scheduled tasks"
] as const;

const ALLOWED = new Map(
  CALL_TOOL_ALLOWLIST.map((tool) => [tool.toLocaleLowerCase(), tool] as const)
);

/** Keep only allowlisted tools; normalize casing to the canonical label. */
export function filterAllowedTools(tools: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tools) {
    const key = raw.trim().toLocaleLowerCase();
    if (!key) continue;
    const canonical = ALLOWED.get(key);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}
