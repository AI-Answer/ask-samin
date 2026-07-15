import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";

import { CopyButton } from "@/components/copy-button";
import { isSupabaseReadConfigured } from "@/src/db/client";

export const metadata: Metadata = {
  title: "Connect your AI",
  description: "Connect Claude or ChatGPT to the community knowledge MCP server."
};

export default async function ConnectPage() {
  const requestHeaders = await headers();
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const appUrl = (configuredUrl || (host ? `${protocol}://${host}` : "http://localhost:3001")).replace(/\/$/, "");
  const mcpUrl = `${appUrl}/mcp`;
  const dbReady = isSupabaseReadConfigured();

  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">Open MCP · No login required</p>
        <h1>Connect Claude or ChatGPT to community knowledge</h1>
        <p className="lede">
          This server returns read-only evidence from published lessons and posts. Your AI client owns
          inference — no OAuth, no API key, no member credentials sent here.
        </p>
        <Link href="/">← Back</Link>
      </header>

      <section className="panel">
        <h2>Remote endpoint</h2>
        <div className="endpoint-row">
          <code>{mcpUrl}</code>
          <CopyButton text={mcpUrl} label="Copy URL" />
        </div>
        <p className="note">Use the public HTTPS URL after deployment. Localhost is for local preview only.</p>
      </section>

      <section className="panel">
        <h2>Claude (custom connector)</h2>
        <ol className="steps">
          <li>Open <strong>Customize → Connectors</strong>.</li>
          <li>Select <strong>+ → Add custom connector</strong>.</li>
          <li>Name it, paste the URL above, leave OAuth blank.</li>
          <li>In chat: <strong>+ → Connectors</strong> and enable it.</li>
        </ol>
      </section>

      <section className="panel facts">
        <div>
          <span>Database</span>
          <strong>{dbReady ? "Configured" : "Seed fallback only"}</strong>
        </div>
        <div>
          <span>Auth</span>
          <strong>None required</strong>
        </div>
      </section>
    </main>
  );
}
