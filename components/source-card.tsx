import Image from "next/image";

export interface SourceCardData {
  id?: string;
  citationId?: string;
  sourceTitle?: string;
  title?: string;
  sourceKind?: string;
  kind?: string;
  canonicalUrl?: string;
  timestampUrl?: string;
  thumbnailUrl?: string;
  timestampLabel?: string;
  text?: string;
  provenance?: string;
  transcriptStatus?: string;
  score?: number;
}

interface SourceCardProps {
  source: SourceCardData;
  index?: number;
  compact?: boolean;
}

export function SourceCard({ source, index, compact = false }: SourceCardProps) {
  const title = source.sourceTitle ?? source.title ?? "Untitled source";
  const kind = source.sourceKind ?? source.kind ?? "video";
  const href = safeHttpUrl(source.timestampUrl ?? source.canonicalUrl) ?? "#";
  const thumbnailUrl = safeThumbnailUrl(source.thumbnailUrl);
  const evidenceLabel = getEvidenceLabel(source);
  const citation = source.citationId ?? (index !== undefined ? `S${index + 1}` : undefined);

  return (
    <article className={`source-card${compact ? " source-card--compact" : ""}`}>
      <a className="source-thumb" href={href} target="_blank" rel="noreferrer" tabIndex={-1} aria-hidden="true">
        {thumbnailUrl ? (
          <Image
            src={thumbnailUrl}
            alt=""
            fill
            sizes={compact ? "(max-width: 640px) 112px, 152px" : "(max-width: 640px) 40vw, 220px"}
          />
        ) : (
          <span className="source-thumb-fallback">AS</span>
        )}
        <span className="source-play" aria-hidden="true">
          <PlayIcon />
        </span>
      </a>
      <div className="source-card-body">
        <div className="source-kicker">
          {citation ? <span className="citation-chip">[{citation}]</span> : null}
          <span>{kind === "short" ? "Short" : kind.replaceAll("_", " ")}</span>
          {source.timestampLabel ? <span>{source.timestampLabel}</span> : null}
        </div>
        <h3>
          <a href={href} target="_blank" rel="noreferrer">
            {title}
            <span className="sr-only"> (opens on YouTube in a new tab)</span>
          </a>
        </h3>
        <div className="source-evidence">
          <EvidenceIcon />
          <span>{evidenceLabel}</span>
        </div>
        {source.text && (source.provenance === "transcript" || source.provenance === "creator_export") ? (
          <div className="source-context">
            <span>Transcript context{source.timestampLabel ? ` · ${source.timestampLabel}` : ""}</span>
            <p>{source.text}</p>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function safeHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function safeThumbnailUrl(value: string | undefined): string | undefined {
  const safe = safeHttpUrl(value);
  if (!safe) return undefined;
  const hostname = new URL(safe).hostname.toLowerCase();
  return hostname === "i.ytimg.com" || hostname === "yt3.googleusercontent.com" ? safe : undefined;
}

function getEvidenceLabel(source: SourceCardData) {
  if (source.provenance === "transcript" || source.transcriptStatus === "indexed") {
    return "Timed transcript context";
  }
  if (source.provenance === "document") return "Document excerpt available";
  if (source.provenance === "creator_export") return "Creator-provided text";
  if (source.transcriptStatus === "processing") return "Transcript processing";
  return "Matched from title and metadata";
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18">
      <path d="m9 7 8 5-8 5V7Z" fill="currentColor" />
    </svg>
  );
}

function EvidenceIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
      <path d="M3 2.5h7l3 3V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10 2.5V6h3M4.5 9h6M4.5 11.5h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" />
    </svg>
  );
}
