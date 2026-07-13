import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { CopyButton } from "@/components/copy-button";

export const metadata: Metadata = {
  title: "Connect your AI",
  description: "Connect an MCP-compatible AI client to the Ask Samin source library."
};

export default async function ConnectPage() {
  const requestHeaders = await headers();
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const appUrl = (configuredUrl || (host ? `${protocol}://${host}` : "http://localhost:3000")).replace(/\/$/, "");
  const mcpUrl = `${appUrl}/mcp`;

  return (
    <main className="interior-page connect-page" id="main-content">
      <header className="page-intro connect-intro">
        <div>
          <span className="hero-index">BRING YOUR AI / REMOTE MCP</span>
          <h1>Your model.<br /><em>Samin’s shelf.</em></h1>
        </div>
        <div className="intro-aside">
          <p>
            The standalone site retrieves evidence without running a model. Connect this read-only library to ChatGPT
            or Claude when you want your signed-in AI client to reason over the transcript context.
          </p>
          <Link className="intro-link" href="/">
            Try the built-in navigator <span aria-hidden="true">→</span>
          </Link>
        </div>
      </header>

      <section className="mcp-definition" aria-labelledby="mcp-definition-heading">
        <span>MCP, IN PLAIN ENGLISH</span>
        <div>
          <h2 id="mcp-definition-heading">A bridge to tools and context—not another model.</h2>
          <p>
            MCP stands for Model Context Protocol, an open standard that lets an AI client call external tools. Here,
            it lets ChatGPT or Claude search and fetch read-only evidence from Samin’s library. It does not provide a
            model or move your AI account login into this site.
          </p>
        </div>
      </section>

      <section className="connection-facts" aria-label="Ways to use Ask Samin">
        <article>
          <span>STANDALONE SITE</span>
          <strong>Retrieval only</strong>
          <p>No model runs here, so it uses no model inference tokens. Recommendations are full videos only; Shorts remain in Library browse.</p>
        </article>
        <article>
          <span>CHATGPT</span>
          <strong>Supported</strong>
          <p>ChatGPT stays the host and performs inference in the member’s signed-in ChatGPT session.</p>
        </article>
        <article>
          <span>CLAUDE</span>
          <strong>Supported · beta</strong>
          <p>Claude can add the same URL as a custom remote MCP connector and handles its own inference.</p>
        </article>
      </section>

      <section className="endpoint-panel" aria-labelledby="endpoint-heading">
        <div className="endpoint-label">
          <span>REMOTE ENDPOINT</span>
          <strong id="endpoint-heading">Paste this into your MCP client</strong>
        </div>
        <div className="endpoint-value">
          <code>{mcpUrl}</code>
          <CopyButton idleLabel="Copy endpoint" text={mcpUrl} />
        </div>
        <p className="endpoint-note">Use the public HTTPS URL after deployment. Localhost is only for local preview.</p>
      </section>

      <div className="connect-layout">
        <section className="connection-steps" aria-labelledby="steps-heading">
          <span className="eyebrow">ChatGPT setup</span>
          <h2 id="steps-heading">Connect once. Then share the build context.</h2>
          <ol>
            <li>
              <span>01</span>
              <div>
                <h3>Enable ChatGPT Developer mode</h3>
                <p>Open Settings → Security and login, then turn on Developer mode. If the toggle is unavailable, your workspace admin must allow it.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Create a developer-mode app</h3>
                <p>
                  Open Settings → Plugins (or <a href="https://chatgpt.com/plugins" rel="noreferrer" target="_blank">chatgpt.com/plugins<span className="sr-only">, opens in a new tab</span></a>), select plus, then create a developer-mode app and paste <code>{mcpUrl}</code>.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Choose the app in a new chat</h3>
                <p>
                  Select + near the composer, choose More, then select Ask Samin. Start with your goal; the guide asks
                  for your stage, tools, and blocker before recommending full videos.
                </p>
              </div>
            </li>
          </ol>
          <a className="guide-link" href="https://developers.openai.com/apps-sdk/deploy/connect-chatgpt" rel="noreferrer" target="_blank">
            Official ChatGPT setup guide <span aria-hidden="true">→</span><span className="sr-only">, opens in a new tab</span>
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
              <dd>Returned with titles, URLs, and timestamps when available.</dd>
            </div>
            <div>
              <dt>Your AI account password</dt>
              <dd><strong>Never sent to this app.</strong></dd>
            </div>
            <div>
              <dt>Your personal API key</dt>
              <dd><strong>Not required by this MCP server.</strong></dd>
            </div>
          </dl>
          <div className="receipt-total">
            <span>MODEL USAGE</span>
            <strong>Handled by your signed-in AI client</strong>
          </div>
        </aside>
      </div>

      <section className="claude-connect" aria-labelledby="claude-heading">
        <div className="claude-connect-heading">
          <span className="status-chip">SUPPORTED · BETA</span>
          <div>
            <span className="eyebrow">Claude setup</span>
            <h2 id="claude-heading">Use the same shelf in Claude.</h2>
            <p>
              Custom remote MCP connectors are currently available in beta across Claude plans. Free accounts are
              limited to one custom connector; Team and Enterprise owners must add it for their organization first.
            </p>
          </div>
        </div>
        <ol>
          <li><span>01</span><p>Open <strong>Customize → Connectors</strong>.</p></li>
          <li><span>02</span><p>Select <strong>+ → Add custom connector</strong>, name it Ask Samin, and paste <code>{mcpUrl}</code>.</p></li>
          <li><span>03</span><p>Select <strong>Add</strong>. In a chat, open <strong>+ → Connectors</strong> and enable Ask Samin.</p></li>
        </ol>
        <div className="claude-team-note">
          <strong>Team or Enterprise?</strong>
          <p>An Owner first adds the URL in Organization settings → Connectors; members then connect it under Customize → Connectors.</p>
        </div>
        <a className="guide-link" href="https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp" rel="noreferrer" target="_blank">
          Official Claude connector guide <span aria-hidden="true">→</span><span className="sr-only">, opens in a new tab</span>
        </a>
      </section>

      <section className="connect-clarifier" aria-labelledby="clarifier-heading">
        <span aria-hidden="true">!</span>
        <div>
          <h2 id="clarifier-heading">A useful distinction about “Login with ChatGPT”</h2>
          <p>
            A ChatGPT or Claude account is not a transferable API key. With the MCP route, the AI client remains the
            host, performs inference in the member’s signed-in session, and calls this library as a tool. This app does
            not capture or reuse the member’s AI account credentials.
          </p>
          <p>
            This production build deliberately uses remote MCP instead of the third-party <a href="https://github.com/opencoredev/login-with-chatgpt" rel="noreferrer" target="_blank">Login with ChatGPT SDK<span className="sr-only">, opens in a new tab</span></a>. That SDK can keep refreshable ChatGPT credentials on an application server and spend the member’s plan; this connector design avoids taking custody of those credentials.
          </p>
        </div>
      </section>
      <p className="plugin-note">
        This connects a private developer-mode app. Publishing to the plugin directory is a separate, reviewed submission step.
      </p>
    </main>
  );
}
