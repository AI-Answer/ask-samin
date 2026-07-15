# Community Knowledge MCP

Open, read-only MCP server for course community knowledge — lessons, transcripts, and posts — backed by hybrid Postgres search (FTS + pgvector + RRF).

## Architecture

```
Ingestion scripts (local/CI)  →  Supabase Postgres (community_knowledge schema)
                                         ↑
Claude / ChatGPT  →  Vercel /mcp (read-only, no OAuth)
```

## Quick start

```bash
cd community-knowledge
npm install
cp .env.example .env.local
npm run dev
```

- App: http://localhost:3001
- MCP: http://localhost:3001/mcp
- Connect guide: http://localhost:3001/connect

## Supabase setup

1. Enable pgvector in Dashboard → Database → Extensions
2. Run `supabase/setup.sql` in SQL Editor (drop schema first if re-running after a failed install)
3. Add `community_knowledge` to API → Exposed schemas
4. Set env vars in `.env.local`
5. `npm run seed && npm run embed:backfill`

## Ingestion

Hermes/Skool agent exports JSON → `npm run ingest:run data/inventory/lessons-export.json`

```bash
npm run coverage:inventory -- claude
npm run ingest:run data/inventory/lessons-export.json
npm run embed:backfill
```

## MCP tools

| Tool | Purpose |
|------|---------|
| `search` | Hybrid retrieval with optional filters |
| `fetch` | Full evidence + nearby context |
| `browse_curriculum` | Curriculum tree navigation |
| `list_recent_updates` | Recently updated published sources |

## Verify

```bash
npm run qa
npm run build
```
