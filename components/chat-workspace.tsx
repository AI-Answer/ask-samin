"use client";

import Link from "next/link";
import { FormEvent, KeyboardEvent, useRef, useState } from "react";

import { SourceCard, type SourceCardData } from "@/components/source-card";

type ChatSource = SourceCardData & Record<string, unknown>;

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
  mode?: "generated" | "retrieval_only";
  notice?: string;
  phase?: "intake" | "recommendations";
}

const starters = [
  "Automate follow-up for my service business",
  "Build my first useful AI agent",
  "Turn my expertise into a clear offer"
];

const intakePrompt = `Hey this is Samin helping you build these things. I’m an AI guide grounded in Samin’s verified source library, not Samin himself.

Before I search, give me the quick build context:
1. Goal — what should exist or work when you’re done?
2. Current stage — idea, testing, or already running?
3. Tools — what are you using now, if anything?
4. Blocker — what is stopping you today?

Reply in rough bullets. “Not sure” is a perfectly useful answer.`;

interface ChatWorkspaceProps {
  sourceCount: number;
}

export function ChatWorkspace({ sourceCount }: ChatWorkspaceProps) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasIntake = messages.some((message) => message.phase === "intake");
  const hasRecommendations = messages.some((message) => message.phase === "recommendations");

  async function submitQuestion(question: string) {
    const cleanQuestion = question.trim();
    if (!cleanQuestion || isSending) return;

    const boundedHistory =
      messages.length <= 11 ? messages : [messages[0], messages[1], ...messages.slice(-9)];
    const priorMessages = boundedHistory.map(({ role, content }) => ({ role, content }));
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: cleanQuestion
    };

    if (!hasIntake) {
      setMessages([
        userMessage,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: intakePrompt,
          phase: "intake"
        }
      ]);
      setDraft("");
      setError(null);
      window.setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }

    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setError(null);
    setIsSending(true);

    try {
      const retrievalQuery = buildClientRecommendationQuery(messages, cleanQuestion);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: retrievalQuery,
          messages: [...priorMessages, { role: "user" as const, content: cleanQuestion }]
        })
      });

      const payload = await readPayload(response);
      if (!response.ok) {
        throw new Error(readError(payload) ?? "The library could not answer that yet.");
      }

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: readAnswer(payload),
        sources: readSources(payload),
        mode: readMode(payload),
        notice: readNotice(payload),
        phase: "recommendations"
      };
      setMessages((current) => [...current, assistantMessage]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Something went wrong. Please try again.");
    } finally {
      setIsSending(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitQuestion(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitQuestion(draft);
    }
  }

  const hasConversation = messages.length > 0;

  return (
    <section className="chat-workspace" aria-labelledby="chat-heading">
      <div className="chat-topline">
        <div>
          <span className="eyebrow">Source-grounded course navigator</span>
          <h2 id="chat-heading">Start with the outcome.</h2>
        </div>
        <span className="library-status">
          <span aria-hidden="true" /> {sourceCount.toLocaleString()} sources on the shelf
        </span>
      </div>

      {!hasConversation ? (
        <div className="chat-empty">
          <p>
            Give the rough goal first. The guide asks about your stage, tools, and blocker before it returns full-video
            recommendations with transcript context and exact timestamps.
          </p>
          <div className="starter-list" aria-label="Example questions">
            {starters.map((starter, index) => (
              <button key={starter} onClick={() => void submitQuestion(starter)} type="button">
                <span>0{index + 1}</span>
                {starter}
                <ArrowIcon />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="message-thread" aria-live="polite">
          {messages.map((message) => (
            <article className={`message message--${message.role}`} key={message.id}>
              <div className="message-label">{message.role === "user" ? "You" : "AI Samin"}</div>
              <div className="message-copy">
                {message.content.split("\n").map((line, index) =>
                  line ? <p key={`${message.id}-${index}`}>{line}</p> : <br key={`${message.id}-${index}`} />
                )}
              </div>
              {message.notice ? <p className="message-notice">{message.notice}</p> : null}
              {message.mode === "retrieval_only" ? (
                <p className="retrieval-badge">Retrieval-only answer — no model synthesis was used.</p>
              ) : null}
              {message.sources?.length ? (
                <div className="answer-sources">
                  <div className="answer-sources-heading">
                    <h3>Full videos to watch</h3>
                    <span>
                      {Math.min(message.sources.length, 3)} verified {Math.min(message.sources.length, 3) === 1 ? "source" : "sources"}
                    </span>
                  </div>
                  <p className="match-rationale">
                    Why these match: their timed transcript context is closest to the goal, stage, tools, and blocker
                    you shared.
                  </p>
                  <div className="answer-source-list">
                    {message.sources.slice(0, 3).map((source, index) => (
                      <SourceCard
                        compact
                        index={index}
                        key={source.citationId ?? source.id ?? `${source.sourceTitle}-${index}`}
                        source={source}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </article>
          ))}
          {isSending ? (
            <div className="message message--assistant message--loading" role="status">
              <div className="message-label">AI Samin</div>
              <div className="searching-line">
                <span />
                Searching the shelf and checking sources…
              </div>
            </div>
          ) : null}
        </div>
      )}

      <form className="composer" onSubmit={onSubmit}>
        <label htmlFor="samin-question">
          {hasIntake ? "Add your build context" : "What do you want to build?"}
        </label>
        <div className="composer-field">
          <textarea
            aria-describedby="composer-note"
            disabled={isSending}
            id="samin-question"
            maxLength={2000}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              hasIntake
                ? "Goal / stage / tools / blocker — rough bullets are fine."
                : "e.g. I want to automate lead follow-up for my local business."
            }
            ref={inputRef}
            rows={3}
            value={draft}
          />
          <button disabled={!draft.trim() || isSending} type="submit">
            <span>
              {isSending
                ? "Looking"
                : !hasIntake
                  ? "Start the intake"
                  : hasRecommendations
                    ? "Refine the matches"
                    : "Find full videos"}
            </span>
            <ArrowIcon />
          </button>
        </div>
        <div className="composer-meta" id="composer-note">
          <span>No model runs here · Enter to send · Shift + Enter for a new line</span>
          <Link href="/library">Or browse all {sourceCount.toLocaleString()} sources</Link>
        </div>
        {error ? (
          <div className="form-error" role="alert">
            <strong>That search hit a snag.</strong> {error}
          </div>
        ) : null}
      </form>
    </section>
  );
}

async function readPayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return response.json();
  return response.text();
}

function readAnswer(payload: unknown): string {
  if (typeof payload === "string") return payload.trim() || "The library returned an empty answer.";
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.answer === "string") return record.answer;
    if (typeof record.message === "string") return record.message;
    if (typeof record.text === "string") return record.text;
  }
  return "The library returned an answer in an unexpected format.";
}

function readSources(payload: unknown): ChatSource[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const sources = Array.isArray(record.sources)
    ? record.sources
    : Array.isArray(record.citations)
      ? record.citations
      : [];
  return sources.filter((source): source is ChatSource => Boolean(source && typeof source === "object"));
}

function readMode(payload: unknown): ChatMessage["mode"] {
  if (!payload || typeof payload !== "object") return undefined;
  const mode = (payload as Record<string, unknown>).mode;
  return mode === "generated" || mode === "retrieval_only" ? mode : undefined;
}

function readNotice(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const notice = (payload as Record<string, unknown>).notice;
  return typeof notice === "string" ? notice : undefined;
}

function readError(payload: unknown): string | undefined {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  if (typeof record.error === "string") return record.error;
  if (typeof record.message === "string") return record.message;
  return undefined;
}

function buildClientRecommendationQuery(messages: ChatMessage[], latestMessage: string): string {
  const userMessages = [
    ...messages.filter((message) => message.role === "user").map((message) => message.content.trim()),
    latestMessage.trim()
  ].filter(Boolean);
  const goal = (userMessages[0] ?? latestMessage).slice(0, 700);
  const prefix = `Goal: ${goal}\nContext and refinements:\n`;
  const availableContextLength = Math.max(0, 2_000 - prefix.length);
  const recentContext = userMessages.slice(1).join("\n").slice(-availableContextLength);
  return `${prefix}${recentContext}`.slice(0, 2_000);
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="20" height="20">
      <path d="M3 10h13M11 5l5 5-5 5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  );
}
