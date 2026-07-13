# Measurable QA

## Release checks

The local gate is:

```bash
npm run qa
npm run build
```

It checks lint, strict TypeScript, unit tests, prompt/citation contracts, duplicate source IDs, valid source URLs, non-empty chunks, timestamp order, and unresolved placeholders. Browser QA then covers the member chat, library filters, admin validation, prompts page, MCP health, keyboard focus, reduced motion, mobile layout, and console errors.

## Retrieval evaluation

Before calling semantic retrieval production-ready, build a fixed gold set of real Claude Club questions. Each row needs expected source IDs and, where known, expected timestamp windows.

Track under recorded corpus/model versions:

- Recall@5 and Recall@10;
- mean reciprocal rank and nDCG@10;
- cited-video correctness;
- timestamp hit within the expected interval or ±30 seconds;
- citation-label validity (required: 100%);
- unsupported-claim rate;
- retrieval latency p50 and p95;
- transcript coverage and missing-embedding count.

Do not add query rewriting, a paid reranker, or a specialized vector database because it sounds better. Keep the change only when the same fixed evaluation set improves materially without violating citation validity or latency limits.

## Current corpus-status rule

Discovery coverage and transcript coverage are separate measures. A source with only title/metadata is searchable for discovery but may not receive a precise timestamp citation. The UI and health endpoint must report both counts.
