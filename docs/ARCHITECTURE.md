# Architecture

## Product boundary

Ask Samin is a retrieval product, not a digital impersonation. The standalone web app identifies itself as an AI guide and returns deterministic library matches with stored source links. The remote `/mcp` server exposes the same evidence to ChatGPT and Claude; the signed-in MCP host owns the member session and model inference.

The public release neither accepts member API keys nor uses an owner-funded model key. The standalone path runs no model. In MCP mode, the host account handles model choice and usage while Ask Samin receives only tool queries and returns read-only evidence.

## Retrieval storage

The shipped showcase uses the generated static catalog as its complete source of truth. The included Supabase Postgres + pgvector schema is the optional persistent store for additional approved material. It keeps relational metadata, exact cues, full-text search, vectors, prompt versions, and ingestion jobs transactionally linked.

Retrieval combines:

- `tsvector` + a GIN index for exact tools, product names, code terms, and quoted phrases;
- optional 384-dimensional normalized `gte-small` embeddings + an HNSW cosine index;
- reciprocal-rank fusion inside Postgres for lexical and semantic candidates;
- application-level reciprocal-rank fusion between Supabase and the complete static catalog, so a sparse database cannot suppress channel matches;
- transcript-text intent signals for definition and setup questions before source diversification, with the underlying MiniSearch score retained as the tie-breaker;
- exact matched-cue context in MCP `fetch` (up to two nearby caption cues per side);
- MiniSearch as the no-secret release baseline and disaster fallback.

The `gte-small` Edge function can create embeddings, but the current admin route does not run an embedding backfill. New persisted chunks participate in full-text retrieval until a separate authorized worker populates their vectors.

The corpus is shared rather than tenant-specific, so a dedicated vector service would add a second consistency boundary without a measured benefit. Qdrant is a migration candidate only if a fixed evaluation set shows Postgres cannot meet recall or latency targets at a much larger scale.

## Evidence model

Raw caption cues are immutable. Each transcript chunk publishes a nonempty compact cue table of `[start offset ms, duration ms, text start char, text length]` tuples. These tuples resolve back to stored cue timing and text; neither a client nor a model supplies a URL or timestamp.

The server assigns labels such as `[S1]` and constructs timestamp links from stored data:

```text
https://www.youtube.com/watch?v={video_id}&t={floor(start_ms / 1000)}s
```

Before a recommendation is returned, the broad search chunk is refined to the best matching stored cue. The link starts at that cue while bounded nearby cues provide readable context. MCP search result IDs identify the refined evidence, and `fetch(id)` returns the same exact cue context, so a late match in a long course cannot be replaced by the first chapter.

## Conversation and recommendation policy

The first recommendation turn collects the member's goal, current stage, tools, and blocker. Search runs only after that intake. Recommendation eligibility then requires a full video, transcript or creator-export provenance, nonempty evidence text, and a valid timed cue. Shorts and metadata-only records remain searchable in Library browse but are excluded from `/api/search`, `/api/chat`, and MCP recommendations.

## Ingestion lifecycle

The implemented admin path accepts metadata and pasted text, normalizes timestamped cues, previews the result, and uses one transactional Postgres RPC when Supabase persistence is configured. Visibility is explicit and defaults to private. It does not upload files, transcribe media, populate embeddings, or run an asynchronous publish gate.

The intended future bulk pipeline is:

```text
discover → acquire authorized source → parse/transcribe → normalize
→ segment → chunk → embed → index → QA → publish
```

The local YouTube and creator-export scripts use source hashes, a locked manifest, bounded workers, and at most three attempts. The hosted direct-persist path is one atomic attempt; a failure rolls the transaction back. Private Supabase Storage and a retry/dead-letter worker are planned follow-on infrastructure, not release claims.

## Security boundaries

- The browser never receives `SUPABASE_SERVICE_ROLE_KEY`. An admin token is transmitted only when an administrator deliberately enters it for one request and is not stored in browser storage.
- Admin attempts are rate-limited before token comparison; configured tokens shorter than 32 bytes are rejected.
- Admin visibility defaults to private. Public records require an explicit choice and an HTTP(S) canonical URL; public video/Short records require YouTube URLs.
- Supabase tables live in the `public` schema with RLS, revoked defaults, narrow grants, explicit public-source filters, and an atomic service-role RPC.
- Prompts are versioned and published verbatim on `/prompts`; secrets and user content are never written there.
- Requests are size-limited and schema-validated. Source cards add a second HTTP(S)-only link check.
- No billing, purchase, trial, subscription, social posting, or external messaging path exists.

## Deployment states

- `static`: complete generated catalog, deterministic retrieval, source/timestamp links, and MCP.
- `hybrid`: adds atomic Supabase persistence and FTS/RRF; semantic ranking begins after a separate embedding backfill.
- `mcp-hosted`: a member connects `/mcp` from ChatGPT or Claude; that signed-in host performs inference and accounts for model usage.

The health endpoint reports standalone retrieval-only mode, ChatGPT and Claude MCP host support, intake-required full-video recommendations, and exact timed-cue evidence without exposing credentials.
