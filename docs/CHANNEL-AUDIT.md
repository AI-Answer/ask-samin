# Samin Yasar YouTube channel audit

Audit timestamp: 2026-07-13 13:58 EDT
Channel: [@SaminYasar_](https://www.youtube.com/@SaminYasar_) (`UCzGcYErpBX4ldvv0l7MWLfw`)

## Public inventory and ingestion result

| Surface | Items | Duration | Caption result |
| --- | ---: | ---: | --- |
| Videos | 92 | 38.957 h | Included in the bounded caption pass |
| Shorts | 426 | 3.136 h | Included in the bounded caption pass |
| Streams | 0 | — | The channel has no Streams tab |
| Total | 518 | 42.093 h | 496 transcript-indexed; 22 metadata-only |

The ingester fetched 497 English auto-caption tracks and preserved 68,757 raw millisecond cues. The acceptance check kept 496 sources, producing 2,479 transcript chunks covering 41.934 hours of source duration. Twenty-one Shorts exhausted three attempts on YouTube's bot challenge. One additional track was QA-rejected: `EocXQhuBCEo` returned one incomplete cue covering 3.72 seconds of a 24-second Short (15.5%), so the catalog uses its metadata instead of quoting the fragment.

The generated public catalog has 518 sources and 2,501 searchable chunks: 2,479 transcript chunks plus 22 metadata fallbacks. Exact per-source failures and checksums are recorded in [`data/channel-ingestion-receipt.json`](../data/channel-ingestion-receipt.json).

Every one of the 2,479 transcript chunks publishes a nonempty compact cue table. Catalog QA validates all tuple bounds, text spans, ordering, and timing, and currently reports 68,756 published cue anchors. The one-cue difference from the 68,757 raw cues is the incomplete Short that failed measured coverage and was demoted to metadata-only.

The complete 518-item catalog is available for browsing, but recommendation surfaces have a narrower evidence boundary: full videos with timed transcript cues only. All 426 Shorts and all metadata-only records are browse-only and cannot enter standalone or MCP recommendations.

## Privacy and playlist boundary

The seven public playlists contain 91 memberships across 85 unique video IDs. Forty-four IDs overlap the public Videos/Shorts tabs; 41 do not. Of those 41, the audit found 15 owner-uploaded unlisted videos, 14 playable third-party resources, and 12 removed/private videos.

| Playlist | ID | Memberships |
| --- | --- | ---: |
| Free Courses | `PLEpieL08TZ0cH_WHK2jH6ba8YSaTZobX_` | 3 |
| Agentic Playlist | `PLEpieL08TZ0eODTMORuukerQq6ARAKdPO` | 20 |
| Bookedin | `PLEpieL08TZ0c1ZDS7MP7Foznn29ZH3kfD` | 13 |
| Testimonials | `PLEpieL08TZ0ftFSjximj8haPxP6ryxWZx` | 5 |
| Resources | `PLEpieL08TZ0flTOvlpDp4SJgzW4ubdIJO` | 34 |
| Random | `PLEpieL08TZ0doSO5QkTtLCnY-YkE0bE4h` | 4 |
| Tate Tips | `PLEpieL08TZ0eUs6dWw3DHU8vQYKsPv1bS` | 12 |

The 15 unlisted owner videos are staged only in ignored local audit state with `visibility=unlisted`; their titles, IDs, and transcripts are not in the public catalog or tracked receipt. The 14 third-party and 12 unavailable entries are excluded. Publication of unlisted material requires an explicit member-gating and approval decision.

The channel exposes no clearly labeled public community-call video and has no Streams tab. Twenty public videos carry past-live/premiere metadata, but that is not sufficient evidence to classify them as community calls. Community-call recordings should enter through the admin source portal with an explicit visibility setting.

## Method and reproducibility

Channel surfaces and playlists were enumerated independently so Shorts and playlist-only entries were not lost:

```sh
for tab in videos shorts streams playlists; do
  yt-dlp --ignore-errors --no-warnings --flat-playlist --dump-single-json \
    "https://www.youtube.com/@SaminYasar_/$tab"
done
```

The installed `yt-dlp` 2025.10.14 default player route returned `The page needs to be reloaded` for individual video metadata. The bounded ingester therefore used YouTube's public Android player response only to locate caption tracks, then downloaded timed-text XML—never audiovisual media. Raw XML, parsed cues, an incrementally locked manifest, and the private visibility evidence live under ignored `.cache/youtube/audit/`.

```sh
python3 scripts/ingest-youtube-captions.py --workers 5 --max-attempts 3
node scripts/build-catalog.mjs
node scripts/qa-content.mjs
npm run typecheck
npm run lint
```

The catalog builder accepts the verified audit metadata only for IDs already visible on the public Videos or Shorts tabs. This explicit intersection prevents an unlisted source from entering the public catalog even if an audit file is malformed. `scripts/qa-content.mjs` also rejects any transcript chunk without a valid nonempty compact cue table, so every published recommendation timestamp resolves to stored caption evidence.

## Checksums

| Artifact | SHA-256 |
| --- | --- |
| `.cache/youtube/audit/sources.json` | `1063e039c878ad5d059ff1a228d152cb93693dc8bb1544257982d2ce8a73e0a2` |
| `data/transcripts/chunks.json` | `16835ecb6b0728307fd024494545f2e51f87c961892792f977344aa113d03839` |
| `data/catalog.generated.json` | `b5ca42c9bc2e4ef31420417ca8adf680b59398399b37b98c5dd273b2c9c4e465` |
| Raw caption XML index (497 files) | `27fa6df24d0a90083ecd93dbaca97aa85bc6c23ec6059bcee1423f21214b858b` |
| Parsed cue JSON index (497 files) | `0889ec329ff06e4941a4cb7d9b940745e12538c08dbab0bc0f8fbd0735860f8d` |

`node scripts/qa-content.mjs`, TypeScript checking, and ESLint all passed after the final catalog rebuild. Content QA reports 68,756 published cue anchors, and the public catalog contains zero unlisted or third-party sources.
