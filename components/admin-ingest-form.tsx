"use client";

import { FormEvent, useState } from "react";

import type { SourceKind } from "@/lib/types";

type IngestStatus = "preview" | "queued" | "persisted" | "unavailable";

interface IngestResponse {
  status?: IngestStatus;
  message?: string;
  source?: Record<string, unknown>;
  chunks?: Record<string, unknown>[];
  error?: string;
}

export function AdminIngestForm() {
  const [kind, setKind] = useState<SourceKind>("video");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [externalId, setExternalId] = useState("");
  const [text, setText] = useState("");
  const [persist, setPersist] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [token, setToken] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<IngestResponse | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setResult(null);

    try {
      const response = await fetch("/api/admin/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          kind,
          title: title.trim(),
          url: url.trim() || undefined,
          externalId: externalId.trim() || undefined,
          text: text.trim() || undefined,
          persist,
          isPublic
        })
      });

      const payload = (await response.json().catch(() => ({}))) as IngestResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? payload.message ?? "The ingestion request was rejected.");
      }

      setResult(payload);
      if (payload.status === "persisted" || payload.status === "queued") {
        setTitle("");
        setUrl("");
        setExternalId("");
        setText("");
      }
    } catch (error) {
      setResult({
        status: "unavailable",
        message: error instanceof Error ? error.message : "The ingestion request failed."
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="ingest-form" onSubmit={onSubmit}>
      <div className="form-section-heading">
        <span>01</span>
        <div>
          <h2>Describe the source</h2>
          <p>Keep the title faithful to the original material so members can recognize it.</p>
        </div>
      </div>

      <div className="field-grid">
        <label>
          <span>Source type</span>
          <select onChange={(event) => setKind(event.target.value as SourceKind)} value={kind}>
            <option value="video">YouTube video</option>
            <option value="short">YouTube Short</option>
            <option value="community_call">Community call</option>
            <option value="document">Document or guide</option>
            <option value="web">Web resource</option>
          </select>
        </label>
        <label>
          <span>Original title</span>
          <input onChange={(event) => setTitle(event.target.value)} required value={title} />
        </label>
        <label className="field-span-2">
          <span>Canonical URL <small>optional for private material</small></span>
          <input
            inputMode="url"
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            type="url"
            value={url}
          />
        </label>
        <label className="field-span-2">
          <span>External ID <small>optional, useful for deduplication</small></span>
          <input onChange={(event) => setExternalId(event.target.value)} placeholder="YouTube ID or creator-owned reference" value={externalId} />
        </label>
      </div>

      <div className="form-section-heading form-section-heading--second">
        <span>02</span>
        <div>
          <h2>Add the evidence</h2>
          <p>Paste only material you own or have permission to index. Timestamps should stay in the text when available.</p>
        </div>
      </div>

      <label className="text-field">
        <span>Transcript or resource text <small>optional for a metadata-only record</small></span>
        <textarea
          onChange={(event) => setText(event.target.value)}
          placeholder={'00:00:00 Samin: Today we’re going to…\n00:00:14 Samin: The first thing to understand is…'}
          rows={12}
          value={text}
        />
        <small>{text.length.toLocaleString()} characters</small>
      </label>

      <div className="ingest-actions">
        <label className="check-field">
          <input checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} type="checkbox" />
          <span>
            <strong>Publish in member search</strong>
            Off by default. Enable only for material approved for every member to discover.
          </span>
        </label>

        <label className="check-field">
          <input checked={persist} onChange={(event) => setPersist(event.target.checked)} type="checkbox" />
          <span>
            <strong>Write to the configured knowledge store</strong>
            Leave this off to preview normalization without saving.
          </span>
        </label>

        <label className="token-field">
          <span>Admin token</span>
          <input
            autoComplete="current-password"
            onChange={(event) => setToken(event.target.value)}
            required
            type="password"
            value={token}
          />
        </label>

        <button className="submit-ingest" disabled={isSubmitting || !title.trim() || !token} type="submit">
          {isSubmitting ? "Checking source…" : persist ? "Verify & ingest" : "Preview ingestion"}
          <span aria-hidden="true">→</span>
        </button>
      </div>

      {result ? (
        <div className={`ingest-result ingest-result--${result.status ?? "unavailable"}`} role="status">
          <span>{result.status ?? "result"}</span>
          <div>
            <strong>{result.message ?? "The ingestion endpoint responded."}</strong>
            {Array.isArray(result.chunks) ? <p>{result.chunks.length} normalized chunks returned.</p> : null}
          </div>
        </div>
      ) : null}
    </form>
  );
}
