import type { Metadata } from "next";

import { LibraryExplorer } from "@/components/library-explorer";
import catalog from "@/data/catalog.generated.json";
import type { CatalogPayload } from "@/lib/types";

export const metadata: Metadata = {
  title: "Source library",
  description: "Browse the complete catalog of Samin Yasar videos and Shorts available to Ask Samin."
};

const typedCatalog = catalog as CatalogPayload;

export default function LibraryPage() {
  return (
    <main className="interior-page" id="main-content">
      <header className="page-intro library-intro">
        <div>
          <span className="hero-index">THE SOURCE SHELF / LIVE CATALOG</span>
          <h1>Every lesson.<br /><em>No mystery links.</em></h1>
        </div>
        <div className="intro-aside">
          <p>
            Browse all {typedCatalog.stats.total} cataloged items from Samin’s channel. Every result opens the original
            source; nothing here is model-invented.
          </p>
          <div className="coverage-rule">
            <span><strong>{typedCatalog.stats.videos}</strong> full videos</span>
            <span><strong>{typedCatalog.stats.shorts}</strong> Shorts</span>
            <span><strong>{typedCatalog.stats.transcriptIndexed}</strong> transcript-indexed</span>
          </div>
        </div>
      </header>

      <div className="evidence-banner" role="note">
        <strong>Coverage note</strong>
        {typedCatalog.stats.transcriptIndexed > 0 ? (
          <p>
            {typedCatalog.stats.transcriptIndexed} sources include transcript-level evidence. The remaining {typedCatalog.stats.metadataOnly} are searchable by title and metadata only, so they cannot support quotes or precise timestamps yet.
          </p>
        ) : (
          <p>
            The current catalog is metadata-only. Search can match titles, but it cannot yet quote or pinpoint moments
            inside these videos. Transcript coverage will appear here as creator-owned text is ingested.
          </p>
        )}
      </div>

      <LibraryExplorer sources={typedCatalog.sources} />
    </main>
  );
}
