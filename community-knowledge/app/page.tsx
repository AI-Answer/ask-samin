import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Community Knowledge MCP",
  description: "Open read-only MCP server for course community knowledge."
};

export default function HomePage() {
  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">Open MCP · No login required</p>
        <h1>Community Knowledge</h1>
        <p className="lede">
          Read-only hybrid search over published lessons, posts, and transcripts. Your AI client owns
          inference — paste the MCP URL, no OAuth.
        </p>
        <div className="actions">
          <Link href="/connect">Connect guide →</Link>
          <Link href="/api/health">Health check</Link>
        </div>
      </header>
    </main>
  );
}
