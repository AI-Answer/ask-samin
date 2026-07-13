"use client";

import { useMemo, useState } from "react";

import { SourceCard } from "@/components/source-card";
import type { KnowledgeSource } from "@/lib/types";

interface LibraryExplorerProps {
  sources: KnowledgeSource[];
}

type KindFilter = "all" | "video" | "short";

const PAGE_SIZE = 30;

export function LibraryExplorer({ sources }: LibraryExplorerProps) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const counts = useMemo(
    () => ({
      all: sources.length,
      video: sources.filter((source) => source.kind === "video").length,
      short: sources.filter((source) => source.kind === "short").length
    }),
    [sources]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return sources.filter((source) => {
      const matchesKind = kind === "all" || source.kind === kind;
      const haystack = `${source.title} ${source.tags.join(" ")}`.toLocaleLowerCase();
      return matchesKind && (!needle || haystack.includes(needle));
    });
  }, [kind, query, sources]);

  const visible = filtered.slice(0, visibleCount);

  function clearFilters() {
    setQuery("");
    setKind("all");
    setVisibleCount(PAGE_SIZE);
  }

  return (
    <div className="library-explorer">
      <div className="library-toolbar">
        <label className="library-search" htmlFor="library-query">
          <SearchIcon />
          <span className="sr-only">Search the source library</span>
          <input
            id="library-query"
            onChange={(event) => {
              setQuery(event.target.value);
              setVisibleCount(PAGE_SIZE);
            }}
            placeholder="Search Claude, agents, content, n8n…"
            type="search"
            value={query}
          />
          {query ? (
            <button onClick={() => setQuery("")} type="button">
              Clear
            </button>
          ) : null}
        </label>

        <div className="kind-filters" aria-label="Filter sources by type">
          {(["all", "video", "short"] as const).map((filter) => (
            <button
              aria-pressed={kind === filter}
              key={filter}
              onClick={() => {
                setKind(filter);
                setVisibleCount(PAGE_SIZE);
              }}
              type="button"
            >
              <span>{filter === "all" ? "Everything" : filter === "video" ? "Full videos" : "Shorts"}</span>
              <strong>{counts[filter]}</strong>
            </button>
          ))}
        </div>
      </div>

      <div className="result-summary" aria-live="polite">
        <p>
          <strong>{filtered.length}</strong> {filtered.length === 1 ? "source" : "sources"}
          {query ? <> matching “{query}”</> : null}
        </p>
        <span>Channel order · newest catalog entries first</span>
      </div>

      {visible.length ? (
        <div className="library-results">
          {visible.map((source, index) => (
            <div className="library-result" key={source.id}>
              <span className="result-index">{String(index + 1).padStart(3, "0")}</span>
              <SourceCard compact source={source} />
            </div>
          ))}
        </div>
      ) : (
        <div className="library-empty">
          <span aria-hidden="true">?</span>
          <h2>No exact title match.</h2>
          <p>Try a tool name, a shorter phrase, or search everything instead of one format.</p>
          <button onClick={clearFilters} type="button">Reset the shelf</button>
        </div>
      )}

      {visible.length < filtered.length ? (
        <button className="load-more" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)} type="button">
          Show {Math.min(PAGE_SIZE, filtered.length - visible.length)} more
          <span>{visible.length} of {filtered.length}</span>
        </button>
      ) : null}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="20" height="20">
      <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="m13 13 4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  );
}
