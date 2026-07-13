import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-mark" aria-hidden="true">
        AS
      </div>
      <div>
        <p className="footer-title">Built for people with something to ship.</p>
        <p className="footer-note">
          AI Samin is a source-grounded guide, not Samin himself. Verify important details in the linked material.
        </p>
      </div>
      <nav aria-label="Footer navigation">
        <Link href="/library">Browse all sources</Link>
        <Link href="/admin">Add material</Link>
        <a href="https://www.youtube.com/@SaminYasar_" rel="noreferrer" target="_blank">
          YouTube <span className="sr-only">(opens in a new tab)</span>
        </a>
      </nav>
    </footer>
  );
}
