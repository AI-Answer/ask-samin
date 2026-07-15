# Community Knowledge (module)

Skool course RAG module used by the root **ask-samin** app. Do not deploy this folder as a separate Vercel project.

## Production URLs (ask-samin only)

| Surface | URL |
|---------|-----|
| **MCP (read)** | `https://ask-samin-ochre.vercel.app/mcp` |
| **Ingest (write)** | `https://ask-samin-ochre.vercel.app/api/ingest` |
| **Web UI** | `https://ask-samin-ochre.vercel.app` |

## Local dev

From repo root:

```bash
npm install
cp .env.example .env.local   # Supabase + INGEST_API_KEY
npm run dev
```

- MCP: http://localhost:3000/mcp
- Ingest: http://localhost:3000/api/ingest

## Ingest CLI

```bash
npm run ingest:skool -- ~/Downloads/claude_masterclass_ingest.json --local
```

See [`docs/HERMES-RUNBOOK.md`](./docs/HERMES-RUNBOOK.md) for Hermes integration.

## Supabase

Run `supabase/setup.sql` on the shared Bookedin project and expose the `community_knowledge` schema in API settings.
