# Community Knowledge MCP

Open, read-only MCP server for course community knowledge — lessons, transcripts, and posts — backed by hybrid Postgres search (FTS + pgvector + RRF).

## Architecture

```
Hermes (cloud)  →  POST /api/ingest  →  Supabase (community_knowledge)
Hermes / Claude →  GET  /mcp         →  hybrid search (read-only, no OAuth)
```

## Quick start

```bash
cd community-knowledge
npm install
cp .env.example .env.local   # fill Supabase + INGEST_API_KEY
npm run dev
```

- App: http://localhost:3001
- MCP (read): http://localhost:3001/mcp
- Ingest (write): http://localhost:3001/api/ingest
- Connect guide: http://localhost:3001/connect

## Supabase setup

1. Enable pgvector in Dashboard → Database → Extensions
2. Run `supabase/setup.sql` in SQL Editor
3. Add `community_knowledge` to API → Exposed schemas
4. Deploy `gte-small` edge function (or reuse from ask-samin on same project)
5. Set env vars in `.env.local` / Vercel

## Hermes — push knowledge (cloud)

```http
POST https://<DEPLOYMENT>/api/ingest
Authorization: Bearer <INGEST_API_KEY>
Content-Type: application/json

{
  "lessons": [
    {
      "id": "c5b48848624842c5a604953068072170",
      "title": "The 35-day map — print + stick it",
      "url": "https://www.skool.com/claude/classroom/e63905c6?md=c5b48848624842c5a604953068072170",
      "curriculumPath": ["Claude Masterclass", "Day 01 — See What You're Building"],
      "html": "<from skool get-lesson --json>",
      "transcript": "[00:00] optional caption text",
      "videoLink": "https://home.wistia.com/medias/7xosh5mfda",
      "groupSlug": "claude",
      "courseId": "e63905c6",
      "publish": true
    }
  ]
}
```

Response: `{ "ok": true, "runId": "...", "processed": N, "skipped": N, "total": N }`

Rules:
- Set `"publish": true` for MCP-visible content
- Include orphan pages (e.g. FULL VIDEO) — outline-only sync is incomplete
- Re-POST is safe — unchanged lessons skip via content hash

## Hermes — query knowledge

Connect MCP to `https://<DEPLOYMENT>/mcp` (no auth).

| Tool | Purpose |
|------|---------|
| `search` | Hybrid retrieval |
| `fetch` | Chunk + nearby context |
| `browse_curriculum` | Tree navigation |
| `list_recent_updates` | Recently updated sources |

## Local CLI (alternative)

```bash
npm run ingest:run data/inventory/lessons-export.json
npm run embed:backfill
```

## Verify

```bash
npm run qa
npm run build
```
