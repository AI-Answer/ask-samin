import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { CopyButton } from "@/components/copy-button";

export const metadata: Metadata = {
  title: "Connect your AI",
  description: "Connect Ask Samin MCP and the Claude Club skill for Skool-linked answers."
};

const SKILL_INSTALL_CMD = `npx skills add AI-Answer/ask-samin --skill ask-samin-claude-club -g -a claude-code -y`;

export default async function ConnectPage() {
  const requestHeaders = await headers();
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const appUrl = (configuredUrl || (host ? `${protocol}://${host}` : "http://localhost:3000")).replace(/\/$/, "");
  const mcpUrl = `${appUrl}/mcp`;
  const skillZipUrl = `${appUrl}/skills/ask-samin-claude-club.zip`;

  return (
    <main className="interior-page connect-page" id="main-content">
      <header className="page-intro connect-intro">
        <div>
          <span className="hero-index">BRING YOUR AI / REMOTE MCP</span>
          <h1>Your model.<br /><em>Samin’s shelf.</em></h1>
        </div>
        <div className="intro-aside">
          <p>
            Connect the Ask Samin library to Claude or ChatGPT. For Claude Club, pair the MCP (retrieval) with the Club
            skill (always open with the Skool lesson link).
          </p>
          <Link className="intro-link" href="/">
            Try the built-in navigator <span aria-hidden="true">→</span>
          </Link>
        </div>
      </header>

      <section className="mcp-definition" aria-labelledby="mcp-definition-heading">
        <span>TWO LAYERS</span>
        <div>
          <h2 id="mcp-definition-heading">MCP finds the lesson. The skill formats the answer.</h2>
          <p>
            <strong>MCP</strong> searches Claude Club and returns Skool URLs, paths, and timestamps.{" "}
            <strong>Skill</strong> tells Claude to put that Skool link in the first sentence, credit Samin, then
            summarize. MCP alone is not enough for the retention CTA.
          </p>
        </div>
      </section>

      <section className="endpoint-panel" aria-labelledby="endpoint-heading">
        <div className="endpoint-label">
          <span>REMOTE MCP</span>
          <strong id="endpoint-heading">Paste this into your connector</strong>
        </div>
        <div className="endpoint-value">
          <code>{mcpUrl}</code>
          <CopyButton idleLabel="Copy MCP URL" text={mcpUrl} />
        </div>
        <p className="endpoint-note">Read-only search over published Skool lessons and transcripts.</p>
      </section>

      <section className="endpoint-panel" aria-labelledby="skill-cmd-heading" style={{ marginTop: "1.5rem" }}>
        <div className="endpoint-label">
          <span>SKILL · CLAUDE CODE / CURSOR</span>
          <strong id="skill-cmd-heading">Install with one command</strong>
        </div>
        <div className="endpoint-value">
          <code>{SKILL_INSTALL_CMD}</code>
          <CopyButton idleLabel="Copy install" text={SKILL_INSTALL_CMD} />
        </div>
        <p className="endpoint-note">
          Uses the open{" "}
          <a href="https://github.com/vercel-labs/skills" rel="noreferrer" target="_blank">
            skills CLI<span className="sr-only">, opens in a new tab</span>
          </a>
          . For Cursor, change <code>-a claude-code</code> to <code>-a cursor</code>. Claude.ai members: use the zip
          below instead.
        </p>
      </section>

      <section className="claude-connect" aria-labelledby="claude-heading" style={{ marginTop: "2.5rem" }}>
        <div className="claude-connect-heading">
          <span className="status-chip">CLAUDE CLUB · RECOMMENDED</span>
          <div>
            <span className="eyebrow">Full setup</span>
            <h2 id="claude-heading">Connect MCP, install skill, then ask.</h2>
            <p>Do this once. New chats need the Ask Samin connector enabled.</p>
          </div>
        </div>
        <ol>
          <li>
            <span>01</span>
            <p>
              <strong>Connect MCP</strong> — Customize → Connectors → Add custom connector → name{" "}
              <code>Ask Samin</code> → paste <code>{mcpUrl}</code> → Add. In a chat: + → Connectors → enable Ask Samin.
            </p>
          </li>
          <li>
            <span>02</span>
            <p>
              <strong>Install skill</strong> — Devs: run the <code>npx skills add …</code> command above. Claude.ai:
              download{" "}
              <a href="/skills/ask-samin-claude-club.zip">ask-samin-claude-club.zip</a>, then Settings → Capabilities →
              Skills → upload/enable the folder.
            </p>
          </li>
          <li>
            <span>03</span>
            <p>
              <strong>Ask</strong> — e.g. “Where does Samin cover the trading use case?” First sentence must be
              markdown <code>[title](https://www.skool.com/...)</code> — not the title alone. Deeper detail: ask to
              fetch that lesson.
            </p>
          </li>
        </ol>
        <div className="claude-team-note">
          <strong>Pass check</strong>
          <p>
            Sentence one is <code>[title](https://www.skool.com/claude/...)</code>. Title-only (“Here’s the lesson: 📝 …
            Day 15”) without an https URL fails.
          </p>
        </div>
        <div className="claude-team-note" style={{ marginTop: "1rem" }}>
          <strong>Team or Enterprise?</strong>
          <p>
            An Owner adds the MCP URL in Organization settings → Connectors; members then enable it under Customize →
            Connectors. Skill install is still per member (npx or zip).
          </p>
        </div>
        <p className="endpoint-note" style={{ marginTop: "1rem" }}>
          Zip always available at <a href={skillZipUrl}>{skillZipUrl}</a>
          {" · "}
          <a
            href="https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp"
            rel="noreferrer"
            target="_blank"
          >
            Official Claude connector guide<span className="sr-only">, opens in a new tab</span>
          </a>
        </p>
      </section>

      <div className="connect-layout" style={{ marginTop: "2.5rem" }}>
        <section className="connection-steps" aria-labelledby="steps-heading">
          <span className="eyebrow">ChatGPT setup</span>
          <h2 id="steps-heading">Same MCP endpoint</h2>
          <ol>
            <li>
              <span>01</span>
              <div>
                <h3>Enable Developer mode</h3>
                <p>Settings → Security and login → Developer mode.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Create a developer-mode app</h3>
                <p>
                  Settings → Plugins (or{" "}
                  <a href="https://chatgpt.com/plugins" rel="noreferrer" target="_blank">
                    chatgpt.com/plugins<span className="sr-only">, opens in a new tab</span>
                  </a>
                  ) → create app → paste <code>{mcpUrl}</code>.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Use it in chat</h3>
                <p>Select the Ask Samin app from + → More, then ask for the lesson or timestamp you need.</p>
              </div>
            </li>
          </ol>
          <a
            className="guide-link"
            href="https://developers.openai.com/apps-sdk/deploy/connect-chatgpt"
            rel="noreferrer"
            target="_blank"
          >
            Official ChatGPT setup guide <span aria-hidden="true">→</span>
            <span className="sr-only">, opens in a new tab</span>
          </a>
        </section>

        <aside className="connection-receipt">
          <div className="receipt-top">
            <span>CONNECTION RECEIPT</span>
            <span>ASK SAMIN / MCP</span>
          </div>
          <h2>What crosses the line?</h2>
          <dl>
            <div>
              <dt>Your question</dt>
              <dd>Sent by your AI client to the retrieval tools.</dd>
            </div>
            <div>
              <dt>Source evidence</dt>
              <dd>Returned with titles, Skool URLs, and timestamps when available.</dd>
            </div>
            <div>
              <dt>Your AI account password</dt>
              <dd>
                <strong>Never sent to this app.</strong>
              </dd>
            </div>
            <div>
              <dt>Your personal API key</dt>
              <dd>
                <strong>Not required by this MCP server.</strong>
              </dd>
            </div>
          </dl>
          <div className="receipt-total">
            <span>MODEL USAGE</span>
            <strong>Handled by your signed-in AI client</strong>
          </div>
        </aside>
      </div>

      <section className="connect-clarifier" aria-labelledby="clarifier-heading">
        <span aria-hidden="true">!</span>
        <div>
          <h2 id="clarifier-heading">MCP vs skill</h2>
          <p>
            Connecting only the MCP lets Claude search Club content — it may still answer without pasting the Skool
            link. Installing the Club skill is what gatekeeps “link in the first sentence.” Full skill README:{" "}
            <a href="https://github.com/AI-Answer/ask-samin/tree/main/skills/ask-samin-claude-club" rel="noreferrer" target="_blank">
              skills/ask-samin-claude-club<span className="sr-only">, opens in a new tab</span>
            </a>
            .
          </p>
        </div>
      </section>
    </main>
  );
}
