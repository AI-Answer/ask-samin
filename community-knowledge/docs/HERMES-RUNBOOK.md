# Hermes — Community Knowledge integration

## URLs (after deploy)

| Surface | URL | Auth |
|---------|-----|------|
| **Ingest (write)** | `https://ask-samin-ochre.vercel.app/api/ingest` | `Authorization: Bearer <INGEST_API_KEY>` |
| **MCP (read)** | `https://ask-samin-ochre.vercel.app/mcp` | None |

Also accepts raw `skool_ingest.v1` export JSON (with `pages[]`) — no manual field mapping required.

Local dev: replace host with `http://localhost:3000`.

## Environment (Dani / Vercel)

Set on the deployed app (not in Hermes):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `EMBED_FUNCTION_NAME=gte-small`
- `INGEST_API_KEY` — shared secret for Hermes ingest only
- `NEXT_PUBLIC_APP_URL` — public deployment URL

Hermes receives **only** `INGEST_API_KEY` and the two URLs above.

## Member product path (Claude Club)

Full guide: https://ask-samin-ochre.vercel.app/connect

1. **MCP** — connect `https://ask-samin-ochre.vercel.app/mcp` (Customize → Connectors)
2. **Skill**
   - Claude Code / Cursor:
     ```bash
     npx skills add AI-Answer/ask-samin --skill ask-samin -g -a claude-code -y
     ```
     Invoke with `/ask-samin`.
   - Claude.ai — zip: https://ask-samin-ochre.vercel.app/skills/ask-samin.zip
3. **Ask** — e.g. “Where does Samin cover trading?” → first sentence must be the Skool URL

Repo skill docs: `skills/ask-samin/README.md`

Do not rely on members pasting custom instructions — distribute the skill (npx or zip).

## Ingest — POST body

```json
{
  "lessons": [
    {
      "id": "<skool_page_id>",
      "title": "<title>",
      "url": "https://www.skool.com/claude/classroom/e63905c6?md=<id>",
      "curriculumPath": ["Claude Masterclass", "Day 01 — …"],
      "html": "<from skool get-lesson --json>",
      "transcript": "[00:00] optional caption text",
      "videoLink": "https://home.wistia.com/medias/…",
      "groupSlug": "claude",
      "courseId": "e63905c6",
      "pageType": "skill_card",
      "summary": "optional short description",
      "resources": [{ "type": "zip", "file_id": "…", "file_name": "playwright.zip" }],
      "githubUrl": "https://github.com/org/repo",
      "publish": true
    }
  ]
}
```

Max 150 lessons per request. Unchanged content is skipped automatically.

## Sync workflow (Claude Masterclass)

1. `skool list-courses -g claude --json`
2. `skool list-lessons -g claude --course "Claude Masterclass" --json`
3. **Also fetch orphan pages** not in outline (e.g. FULL VIDEO `0e733be297014123aa8b3259a6852261`)
4. Per page: `skool get-lesson --url "…" --json`
5. If `videoLink`: captions via yt-dlp → `transcript`
6. `POST /api/ingest` with full batch
7. Verify via MCP `search` (e.g. `"35-day map welcome"`)

## MCP tools (read-only)

- `search` — `{ "query": "…", "limit": 8 }` → citation `text` (attribution + Skool `url` + location/timestamp + snippet). Always cite `url` in replies.
- `fetch` — `{ "id": "<sourceId from search>" }` → same citation header + bounded lesson body (truncated if long)
- `browse_curriculum` — `{ "parent_id": null }` → tree populated at ingest from `curriculumPath`
- `list_recent_updates` — `{ "limit": 10 }`

Do **not** scrape Skool on every member question. Sync on schedule or when content changes.

## DB migration (one-time)

Apply `community-knowledge/supabase/migrations/20260715000003_catalog_retrieval.sql` on the Supabase project before re-ingesting vault content.

## curl smoke test

```bash
curl -sS -X POST "https://<DEPLOYMENT>/api/ingest" \
  -H "Authorization: Bearer <INGEST_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"lessons":[{"id":"test-lesson-1","title":"Test","url":"https://example.com/l","html":"<p>Hello</p>","publish":true,"groupSlug":"claude","courseId":"e63905c6"}]}'
```

Expected: `{"ok":true,"runId":"…","processed":1,"skipped":0,"total":1}`
