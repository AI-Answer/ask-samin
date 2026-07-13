import {
  buildRetrievalOnlyAnswer,
  type ConversationMessage
} from "./prompting";
import type { CitationSource } from "./types";

export interface GroundedAnswerInput {
  query: string;
  messages: ConversationMessage[];
  sources: CitationSource[];
}

export interface GroundedAnswerResult {
  answer: string;
  sources: CitationSource[];
  mode: "retrieval_only";
  notice: string;
}

export const STANDALONE_INTAKE_ANSWER = `Hey this is Samin helping you build these things. I’m an AI guide grounded in Samin’s verified source library, not Samin himself.

Before I search, give me the quick build context:
1. Goal — what should exist or work when you’re done?
2. Current stage — idea, testing, or already running?
3. Tools — what are you using now, if anything?
4. Blocker — what is stopping you today?

Reply in rough bullets. “Not sure” is a perfectly useful answer.`;

const INTAKE_MARKERS = ["goal", "stage", "tools", "blocker"] as const;

export function hasPriorAssistantIntake(messages: ConversationMessage[]): boolean {
  return messages.some((message) => {
    if (message.role !== "assistant") return false;
    const content = message.content.toLocaleLowerCase();
    return INTAKE_MARKERS.filter((marker) => content.includes(marker)).length >= 3;
  });
}

export function buildBoundedRecommendationQuery(
  fallbackQuery: string,
  messages: ConversationMessage[]
): string {
  const fallback = fallbackQuery.trim();
  if (fallback.startsWith("Goal:") && fallback.includes("\nContext and refinements:\n")) {
    return fallback.slice(0, 2_000);
  }

  const userMessages = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter(Boolean);
  const latestUserMessage = userMessages.at(-1);

  if (
    fallback &&
    fallback !== latestUserMessage &&
    !(latestUserMessage && fallback.includes(latestUserMessage))
  ) {
    userMessages.push(fallback);
  }
  if (!userMessages.length) return fallback.slice(0, 2_000);

  const goal = userMessages[0].slice(0, 700);
  const prefix = `Goal: ${goal}\nContext and refinements:\n`;
  const availableContextLength = Math.max(0, 2_000 - prefix.length);
  const recentContext = userMessages.slice(1).join("\n").slice(-availableContextLength);
  return `${prefix}${recentContext}`.slice(0, 2_000);
}

export function buildStandaloneIntakeResult(): GroundedAnswerResult {
  return {
    answer: STANDALONE_INTAKE_ANSWER,
    sources: [],
    mode: "retrieval_only",
    notice: "No search was run. Share your goal, current stage, tools, and blocker first."
  };
}

/**
 * The public standalone app deliberately performs retrieval only. Model
 * inference belongs in the member's ChatGPT session through `/mcp`, avoiding
 * custody of member credentials and unbounded owner-funded API spend.
 */
export async function answerFromSaminLibrary(
  input: GroundedAnswerInput
): Promise<GroundedAnswerResult> {
  const isFirstAnswer = !input.messages.some((message) => message.role === "assistant");

  return {
    answer: buildRetrievalOnlyAnswer(input.sources, isFirstAnswer),
    sources: input.sources,
    mode: "retrieval_only",
    notice: input.sources.length
      ? "Standalone mode returns verified retrieval only. Connect ChatGPT at /connect for model synthesis."
      : "No verified source evidence was retrieved. Try a tool, workflow, or outcome from Samin’s library."
  };
}
