import { getPrompt } from "../data/prompts";

export function getMcpSearchToolDescription(): string {
  return [
    "Search the read-only Samin Yasar full-video transcript library only after completing the intake gate below.",
    getPrompt("recommendation-intake").body,
    getPrompt("samin-grounded-guide").body,
    getPrompt("retrieval-answer-shape").body
  ].join("\n\n");
}

export function getMcpFetchToolDescription(): string {
  return [
    "Fetch the exact matched transcript evidence and bounded adjacent context before recommending a search result.",
    getPrompt("recommendation-intake").body,
    getPrompt("citation-verifier").body
  ].join("\n\n");
}
