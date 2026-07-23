const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function openRouterChatJson(input: {
  apiKey: string;
  model: string;
  messages: OpenRouterChatMessage[];
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://ask-samin-ochre.vercel.app",
      "X-Title": "Ask Samin call enrich"
    },
    body: JSON.stringify({
      model: input.model,
      temperature: input.temperature ?? 0.1,
      max_tokens: input.maxTokens ?? 8_192,
      response_format: { type: "json_object" },
      messages: input.messages
    })
  });

  const payload = (await response.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `OpenRouter error (${response.status})`);
  }

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenRouter returned empty content.");
  }

  return content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}
