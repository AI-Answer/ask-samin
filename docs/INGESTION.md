# Adding videos and resources

## Current drop points

Use `/admin` to preview and optionally persist source metadata and pasted creator-owned text. It supports:

- Samin-owned YouTube videos and Shorts;
- text copied from Creator Studio or Google Takeout transcript exports;
- transcripts from community calls Samin owns or is authorized to publish;
- Markdown/plain-text extracts, course notes, and study guides;
- approved web resources with stable canonical URLs.

New records are private by default. The form parses timestamped lines into immutable cues, previews normalized rows, and—when Supabase is configured—writes the source, cues, chunks, prompt snapshot, and completed job through one atomic RPC. “Publish in member search” is a separate explicit choice.

The hosted form does not upload binary files, transcribe audio/video, backfill embeddings, or run an asynchronous QA worker. Private Storage and that worker are planned follow-on infrastructure.

For local or bulk creator exports, use the ignored `imports/` folder. Name a YouTube transcript file with its 11-character video ID:

```text
imports/8yE6G1Lup1s.en.vtt
```

Run:

```bash
npm run ingest:exports
npm run catalog:build
npm run qa
```

The local importer uses a locked manifest, up to five workers, and at most three attempts per file.

## Required provenance

For current direct ingestion, record at minimum:

- canonical URL or creator filename;
- external/video ID when one exists;
- content owner and rights/permission basis;
- source kind and explicit visibility;
- acquisition/source dates;
- transcript language and whether captions are human or automatic;
- parser/chunker version.

Record asset hashes and embedding-model versions when the future file/embedding worker adds those stages. Do not ingest third-party videos simply because they appear in a playlist, and do not download audiovisual media from YouTube for transcription. Prefer original files and creator-exported captions.

## Timestamp rules

Timed cues are immutable. Normalization may repair whitespace and encoding artifacts for search, but it must not alter the raw quote or invent a timestamp.

The channel ingester creates bounded transcript chunks without crossing a source. The current admin form preserves each pasted timed line as one cue/chunk. Richer chapter-, speaker-, silence-, or 300–450-token chunking is future worker behavior.

Untimed text can be searched, but the UI labels it as metadata/untimed and links to the source without pretending to know a precise moment.

## QA before publication

An item is public only when all applicable checks pass:

- explicit public visibility and a valid HTTP(S) canonical URL;
- YouTube host for a public video or Short;
- non-negative, monotonic cue times;
- no orphan or cross-source chunks;
- stored source IDs resolve;
- citation URLs derive from stored metadata;
- visible title/brand text matches the source;
- duplicate IDs are handled intentionally.

The local bounded ingesters discard an item after three failed attempts and record evidence. The hosted direct-persist path makes one atomic attempt: on failure the transaction rolls back and no partial source is exposed.
