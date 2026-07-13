import Image from "next/image";
import Link from "next/link";

import { ChatWorkspace } from "@/components/chat-workspace";
import { SourceCard } from "@/components/source-card";
import catalog from "@/data/catalog.generated.json";

const featuredSources = catalog.sources.filter((source) => source.kind === "video").slice(0, 3);

export default function HomePage() {
  return (
    <main id="main-content">
      <section className="home-hero">
        <div className="hero-copy">
          <span className="hero-index">CLAUDE CLUB FIELD NOTE / 001</span>
          <h1>
            Find the lesson.
            <br />
            <em>Build the thing.</em>
          </h1>
          <p>
            Start with what you’re building, then add your stage, tools, and blocker. This site uses no model; it
            retrieves the best full videos, transcript context, and exact moments to continue.
          </p>
        </div>

        <aside className="hero-note" aria-label="About AI Samin">
          <div className="hero-note-pin" aria-hidden="true" />
          <div className="hero-note-person">
            <Image src={catalog.channel.avatarUrl} alt="Samin Yasar" height={72} width={72} priority />
            <div>
              <span>YOUR GUIDE</span>
              <strong>Samin’s library,<br />minus the scroll.</strong>
            </div>
          </div>
          <p>
            Practical, beginner-friendly, and allergic to hype. Every useful answer should point back to a real source.
          </p>
          <Link href="/connect">How the connection works <span aria-hidden="true">→</span></Link>
        </aside>
      </section>

      <div className="home-grid">
        <ChatWorkspace sourceCount={catalog.stats.total} />

        <aside className="shelf-rail" aria-label="Library snapshot">
          <div className="rail-heading">
            <span className="eyebrow">Fresh from the shelf</span>
            <Link href="/library">View all</Link>
          </div>
          <div className="rail-source-list">
            {featuredSources.map((source) => (
              <SourceCard compact key={source.id} source={source} />
            ))}
          </div>
          <div className="coverage-note">
            <strong>What’s indexed today</strong>
            <p>
              Browse all {catalog.stats.total} catalog items in the Library. Recommendations are narrower: only full
              videos with timed transcript context qualify. Shorts and metadata-only items remain browse-only.
            </p>
            <Link href="/admin">Open ingestion desk <span aria-hidden="true">→</span></Link>
          </div>
        </aside>
      </div>

      <section className="truth-strip" aria-label="How Ask Samin works">
        <div>
          <span>01</span>
          <strong>Say what you’re making</strong>
          <p>Skip tool jargon. Start with the actual outcome.</p>
        </div>
        <div>
          <span>02</span>
          <strong>Add the useful context</strong>
          <p>Share your stage, current tools, and the blocker in the way.</p>
        </div>
        <div>
          <span>03</span>
          <strong>Get the full lesson</strong>
          <p>Receive full-video recommendations with transcript evidence and exact timestamps.</p>
        </div>
      </section>
    </main>
  );
}
