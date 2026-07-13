import type { Metadata } from "next";

import { CopyButton } from "@/components/copy-button";
import { promptLedger } from "@/data/prompts";

export const metadata: Metadata = {
  title: "Prompt ledger",
  description: "The complete, verbatim prompt ledger used by Ask Samin."
};

export default function PromptsPage() {
  return (
    <main className="interior-page prompts-page" id="main-content">
      <header className="page-intro prompt-intro">
        <div>
          <span className="hero-index">PUBLIC LEDGER / VERBATIM</span>
          <h1>No hidden voice.<br /><em>Read every prompt.</em></h1>
        </div>
        <div className="intro-aside">
          <p>
            These are the exact versioned instructions exposed to ChatGPT through the MCP tools, plus the ingestion
            rule. The standalone site does not run a model; it returns deterministic evidence.
          </p>
          <div className="ledger-key">
            <span><i /> Current instruction</span>
            <span>{promptLedger.length} entries</span>
          </div>
        </div>
      </header>

      <div className="prompt-ledger">
        {promptLedger.map((prompt, index) => (
          <article className="prompt-entry" id={prompt.id} key={prompt.id}>
            <div className="prompt-margin">
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div className="prompt-version">v{prompt.version}</div>
            </div>
            <div className="prompt-content">
              <header>
                <div>
                  <span className="eyebrow">{prompt.id}</span>
                  <h2>{prompt.name}</h2>
                  <p>{prompt.purpose}</p>
                </div>
                <CopyButton idleLabel="Copy verbatim" text={prompt.body} />
              </header>
              <pre><code>{prompt.body}</code></pre>
              <footer>
                <span>Updated {prompt.updatedAt}</span>
                <a href={`#${prompt.id}`}>#{prompt.id}</a>
              </footer>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
