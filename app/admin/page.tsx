import type { Metadata } from "next";

import { AdminIngestForm } from "@/components/admin-ingest-form";
import catalog from "@/data/catalog.generated.json";

export const metadata: Metadata = {
  title: "Ingestion desk",
  description: "Add creator-owned videos, calls, transcripts, documents, and web resources to Ask Samin."
};

export default function AdminPage() {
  return (
    <main className="interior-page admin-page" id="main-content">
      <header className="page-intro admin-intro">
        <div>
          <span className="hero-index">CREATOR PORTAL / PRIVATE</span>
          <h1>Grow the library.<br /><em>Keep the receipts.</em></h1>
        </div>
        <div className="intro-aside">
          <p>
            Add community calls, documents, resource links, or creator-owned transcripts. Preview first; persist only
            after the normalized evidence looks right.
          </p>
          <div className="admin-stamp">
            <strong>{catalog.stats.total}</strong>
            <span>sources cataloged</span>
            <small>{catalog.stats.transcriptIndexed} with transcript text</small>
          </div>
        </div>
      </header>

      <div className="admin-layout">
        <AdminIngestForm />
        <aside className="ingest-guide">
          <span className="eyebrow">Before you add it</span>
          <h2>Evidence in.<br />Evidence out.</h2>
          <ol>
            <li>
              <span>1</span>
              <div><strong>Use the original title</strong><p>Members should know exactly what they’re opening.</p></div>
            </li>
            <li>
              <span>2</span>
              <div><strong>Preserve timestamps</strong><p>They are what turns a source link into a useful shortcut.</p></div>
            </li>
            <li>
              <span>3</span>
              <div><strong>Choose visibility deliberately</strong><p>New sources stay private unless you explicitly publish them.</p></div>
            </li>
            <li>
              <span>4</span>
              <div><strong>Preview before writing</strong><p>Normalization must not rewrite claims or merge sources.</p></div>
            </li>
          </ol>
          <div className="security-note">
            <strong>Token safety</strong>
            <p>The admin token is sent only with this request. It is never stored in browser storage.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
