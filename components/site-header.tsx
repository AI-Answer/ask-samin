import Image from "next/image";
import Link from "next/link";

import catalog from "@/data/catalog.generated.json";

const links = [
  { href: "/", label: "Ask" },
  { href: "/library", label: "Library" },
  { href: "/connect", label: "Connect" },
  { href: "/prompts", label: "Prompts" }
];

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand-lockup" href="/" aria-label="Ask Samin home">
          <span className="brand-avatar">
            <Image
              src={catalog.channel.avatarUrl}
              alt=""
              width={44}
              height={44}
              sizes="44px"
              priority
            />
          </span>
          <span className="brand-words">
            <strong>ASK SAMIN</strong>
            <small>Practical AI field guide</small>
          </span>
        </Link>

        <nav className="primary-nav" aria-label="Main navigation">
          {links.map((link) => (
            <Link href={link.href} key={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>

        <Link className="header-cta" href="/connect">
          Connect your AI
          <ArrowIcon />
        </Link>
      </div>
    </header>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
      <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}
