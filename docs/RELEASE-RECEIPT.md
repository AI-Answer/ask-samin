# Loopy release receipt

- **Loop:** Universal Autonomous Content Engine — AI Samin Knowledge App
- **Definition:** [`LOOPS.md`](../LOOPS.md), SHA-256 `4a200fc696af5ae94869554492e5f6501375238c175f0af3a6b15ab4b07b11ac`
- **Scope:** One bounded, hostable Ask Samin release; public channel corpus plus extensible private-by-default admin ingestion; no billing, purchases, subscriptions, social posting, or third-party deployment changes.
- **Result:** **KEEP** — production release ready at [ask-samin.vercel.app](https://ask-samin.vercel.app), Vercel deployment `dpl_DpnwaL3pSSnw82j9nbFVa21dhe8o`.

## Check evidence

- `npm run qa`: pass — ESLint, strict TypeScript, Vitest, and catalog integrity including 68,756 validated compact cue anchors.
- `npm run build`: pass — 12 Next.js routes, including `/mcp`, search/chat/health APIs, admin, library, connect, and prompt ledger.
- `npm audit --omit=dev`: 0 known vulnerabilities.
- Native MCP SDK: initialize/list/search/fetch pass; JSON text equals `structuredContent`; intake is required before recommendations; exact late-course cue matches are preserved; four expected tools; CORS pass.
- API canary: health/search/chat/admin-preview pass on the production alias; cross-origin JSON rejection and pre-auth admin rate limiting pass locally.
- Browser canary: member chat, library search/filter, prompt ledger, connect copy action, private admin defaults, desktop `1280×720`, mobile `390×844`, zero horizontal overflow, zero console warnings/errors.
- Vercel runtime logs: zero production error logs during the canary window.

## Corpus boundary

- Public channel items: 518 (`92` videos, `426` Shorts), 42.093 hours.
- Transcript-indexed: 496; metadata-only: 22; search chunks: 2,501.
- Caption retrieval: 497 tracks and 68,757 timed cues; 21 bot-challenge items exhausted after exactly three attempts; one incomplete track failed measured coverage and was demoted to metadata-only.
- Published cue anchors: 68,756 validated compact tuples across all 2,479 transcript chunks.
- Recommendation boundary: timed full-video transcript evidence only; Shorts and metadata-only records remain Library browse-only.
- Privacy: 15 unlisted owner items remain only in ignored local audit state; zero unlisted or third-party items are in the public catalog.
- Catalog SHA-256: `b5ca42c9bc2e4ef31420417ca8adf680b59398399b37b98c5dd273b2c9c4e465`.
- Ingestion receipt SHA-256: `34918c5ced85a6c17d03b6fc631bf6d88261ca9fd049ec43c9e24039996f19f5`.

## Guardrail decisions

- The referenced third-party “Login with ChatGPT” transport was not deployed because it reuses a Codex OAuth identity/private backend outside the documented production boundary.
- Host-account inference is implemented through the official remote MCP pattern: ChatGPT or Claude owns sign-in, model choice, and usage; Ask Samin returns read-only evidence.
- The standalone site is retrieval-only; no owner-funded OpenAI key is configured or accepted.
- The recommendation flow is intake-first: goal, current stage, tools, and blocker must be established before source search.
- Supabase/pgvector is the selected optional persistent store, but no database or paid service was provisioned. Static retrieval is the production source of truth.
- Admin preview is enabled with a production secret stored in Vercel and the macOS Keychain service `Ask Samin Vercel admin token`; persistence remains unavailable until an owner Supabase project is configured.
- New admin sources default private. Public links require explicit approval and HTTP(S); public videos/Shorts require YouTube URLs. Future Supabase writes use one atomic RPC and explicit public filters.

## Optional next expansion

Seed the full static catalog into an owner Supabase project, run the separate `gte-small` embedding backfill, add the Storage/async file worker, and submit the MCP app for ChatGPT directory review only when those separate account/configuration decisions are desired. None is required for the verified public release.
