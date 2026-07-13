#!/usr/bin/env python3
"""Fetch and normalize creator-owned YouTube caption tracks without media.

This is a bounded, resumable audit ingester. It reads the owner-only source
inventory, requests player metadata and caption XML, preserves the raw XML and
millisecond cues, and writes timestamped retrieval chunks. It never requests
audio or video streams.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import fcntl
import hashlib
import html
import json
import os
import re
import tempfile
import time
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = next(
    parent for parent in Path(__file__).resolve().parents if (parent / "package.json").is_file()
)
AUDIT_DIR = ROOT / ".cache" / "youtube" / "audit"
DEFAULT_INPUT = AUDIT_DIR / "audit-owned-533.jsonl"
DEFAULT_SOURCES = AUDIT_DIR / "sources.json"
DEFAULT_PRIVATE_SOURCES = AUDIT_DIR / "sources.private.json"
DEFAULT_MANIFEST = AUDIT_DIR / "manifest.json"
DEFAULT_LOCK = AUDIT_DIR / "manifest.lock"
DEFAULT_TRANSCRIPTS = AUDIT_DIR / "transcripts"
DEFAULT_RAW_XML = AUDIT_DIR / "raw-xml"
DEFAULT_CHUNKS = ROOT / "data" / "transcripts" / "chunks.json"
DEFAULT_RECEIPT = AUDIT_DIR / "receipt.json"

OWNER_CHANNEL_ID = "UCzGcYErpBX4ldvv0l7MWLfw"
HANDLE = "@SaminYasar_"
ANDROID_CLIENT_NAME = 3
ANDROID_CLIENT_VERSION = "20.10.38"
ANDROID_USER_AGENT = f"com.google.android.youtube/{ANDROID_CLIENT_VERSION}"
WEB_CLIENT_NAME = 1
WEB_CLIENT_VERSION = "2.20260713.01.00"
WEB_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
)
KEY_RE = re.compile(r'"INNERTUBE_API_KEY":"([^"]+)"')
SPACE_RE = re.compile(r"\s+")


@dataclass(frozen=True)
class Cue:
    start_ms: int
    duration_ms: int | None
    end_ms: int
    text: str


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def atomic_write_bytes(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as file:
            file.write(payload)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def atomic_write_json(path: Path, payload: object, *, compact: bool = False) -> None:
    if compact:
        encoded = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    else:
        encoded = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode()
    atomic_write_bytes(path, encoded)


def request_bytes(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    body: dict[str, Any] | None = None,
    timeout: int = 30,
) -> bytes:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def discover_api_key(video_id: str) -> tuple[str, str]:
    override = os.environ.get("YOUTUBE_INNERTUBE_API_KEY")
    if override:
        return override, "environment"
    try:
        page = request_bytes(
            f"https://www.youtube.com/embed/{video_id}?hl=en",
            headers={"User-Agent": WEB_USER_AGENT, "Referer": "https://example.com/"},
        ).decode("utf-8", "replace")
        match = KEY_RE.search(page)
        if match:
            return match.group(1), "youtube_embed_config"
    except Exception:
        pass
    raise RuntimeError(
        "Could not discover YouTube's Innertube client key. "
        "Set YOUTUBE_INNERTUBE_API_KEY for this bounded ingestion run."
    )


def player_response(video_id: str, api_key: str, client: str = "android") -> dict[str, Any]:
    if client == "android":
        client_context: dict[str, Any] = {
            "clientName": ANDROID_CLIENT_NAME,
            "clientVersion": ANDROID_CLIENT_VERSION,
            "hl": "en",
            "androidSdkVersion": 35,
            "osName": "Android",
            "osVersion": "15",
        }
        user_agent = ANDROID_USER_AGENT
    else:
        client_context = {
            "clientName": WEB_CLIENT_NAME,
            "clientVersion": WEB_CLIENT_VERSION,
            "hl": "en",
        }
        user_agent = WEB_USER_AGENT
    payload = {
        "context": {"client": client_context},
        "videoId": video_id,
        "racyCheckOk": True,
        "contentCheckOk": True,
    }
    raw = request_bytes(
        f"https://www.youtube.com/youtubei/v1/player?key={api_key}&prettyPrint=false",
        headers={"Content-Type": "application/json", "User-Agent": user_agent},
        body=payload,
    )
    return json.loads(raw)


def rendered_text(value: object) -> str | None:
    if isinstance(value, str):
        return value
    if not isinstance(value, dict):
        return None
    if isinstance(value.get("simpleText"), str):
        return value["simpleText"]
    runs = value.get("runs")
    if isinstance(runs, list):
        return "".join(str(run.get("text", "")) for run in runs if isinstance(run, dict))
    return None


def choose_track(tracks: list[dict[str, Any]]) -> dict[str, Any]:
    if not tracks:
        raise ValueError("player response advertised no caption tracks")

    def rank(track: dict[str, Any]) -> tuple[int, int]:
        language = str(track.get("languageCode", ""))
        is_english = language == "en" or language.startswith("en-")
        is_manual = track.get("kind") != "asr"
        return (0 if is_english else 1, 0 if is_manual else 1)

    return sorted(tracks, key=rank)[0]


def clean_caption_text(value: str) -> str:
    return SPACE_RE.sub(" ", html.unescape(value)).strip()


def parse_caption_xml(raw: bytes, duration_ms: int) -> list[Cue]:
    root = ET.fromstring(raw)
    provisional: list[tuple[int, int | None, str]] = []
    paragraphs = root.findall(".//p")
    if paragraphs:
        for paragraph in paragraphs:
            text = clean_caption_text("".join(paragraph.itertext()))
            if not text:
                continue
            start_ms = int(float(paragraph.attrib.get("t", "0")))
            raw_duration = paragraph.attrib.get("d")
            duration = int(float(raw_duration)) if raw_duration not in (None, "") else None
            provisional.append((start_ms, duration, text))
    else:
        for text_node in root.findall(".//text"):
            text = clean_caption_text("".join(text_node.itertext()))
            if not text:
                continue
            start_ms = int(float(text_node.attrib.get("start", "0")) * 1000)
            raw_duration = text_node.attrib.get("dur")
            duration = int(float(raw_duration) * 1000) if raw_duration not in (None, "") else None
            provisional.append((start_ms, duration, text))
    if not provisional:
        raise ValueError("caption XML contained no usable cues")

    cues: list[Cue] = []
    for index, (start_ms, duration, text) in enumerate(provisional):
        next_start = provisional[index + 1][0] if index + 1 < len(provisional) else duration_ms
        if duration is None or duration <= 0:
            end_ms = max(start_ms, next_start)
        else:
            end_ms = start_ms + duration
        if duration_ms > 0:
            end_ms = min(end_ms, duration_ms + 5_000)
        cues.append(Cue(start_ms, duration, max(start_ms, end_ms), text))
    return cues


def audit_records(path: Path) -> list[dict[str, Any]]:
    records = [json.loads(line) for line in path.read_text("utf-8").splitlines() if line.strip()]
    ids = [str(record.get("id", "")) for record in records]
    if len(records) != 533:
        raise ValueError(f"owner inventory must contain 533 rows, found {len(records)}")
    if len(set(ids)) != len(ids) or any(len(video_id) != 11 for video_id in ids):
        raise ValueError("owner inventory contains a duplicate or invalid video id")
    foreign = [record.get("id") for record in records if record.get("channel_id") != OWNER_CHANNEL_ID]
    if foreign:
        raise ValueError(f"owner inventory contains foreign channel ids: {foreign[:5]}")
    return records


def source_kind(record: dict[str, Any]) -> str:
    surfaces = record.get("surfaces") or []
    if "shorts" in surfaces:
        return "short"
    title = str(record.get("title") or record.get("flat_title") or "")
    if re.search(r"(?:^|\s)#shorts?\b", title, re.IGNORECASE):
        return "short"
    return "video"


def source_from_record(record: dict[str, Any]) -> dict[str, Any]:
    video_id = str(record["id"])
    kind = source_kind(record)
    title = str(record.get("title") or record.get("flat_title") or "Untitled video").strip()
    duration = record.get("duration_seconds")
    memberships = record.get("playlist_memberships") or []
    canonical_url = (
        f"https://www.youtube.com/shorts/{video_id}"
        if kind == "short"
        else f"https://www.youtube.com/watch?v={video_id}"
    )
    source: dict[str, Any] = {
        "id": f"youtube_{video_id}",
        "externalId": video_id,
        "kind": kind,
        "title": title,
        "canonicalUrl": canonical_url,
        "thumbnailUrl": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        "description": str(record.get("description") or ""),
        "transcriptStatus": "processing",
        "segmentCount": 0,
        "tags": [],
        "channelId": OWNER_CHANNEL_ID,
        "channelTitle": str(record.get("owner_channel_name") or "Samin Yasar"),
        "captionTrackAdvertised": bool(record.get("caption_track_advertised")),
        "visibility": "unlisted" if record.get("is_unlisted") is True else "public",
        "discovery": {
            "surfaces": record.get("surfaces") or [],
            "positions": record.get("positions") or {},
            "playlistMemberships": memberships,
        },
    }
    if record.get("publish_date"):
        source["publishedAt"] = record["publish_date"]
    if isinstance(duration, int):
        source["durationSeconds"] = duration
    return source


def load_manifest(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"schemaVersion": 1, "channelId": OWNER_CHANNEL_ID, "items": {}}
    try:
        manifest = json.loads(path.read_text("utf-8"))
    except json.JSONDecodeError:
        return {"schemaVersion": 1, "channelId": OWNER_CHANNEL_ID, "items": {}}
    if not isinstance(manifest.get("items"), dict):
        manifest["items"] = {}
    return manifest


def is_resumable_success(item: dict[str, Any], transcript_dir: Path, raw_xml_dir: Path) -> bool:
    if item.get("status") != "kept":
        return False
    cue_path = transcript_dir / str(item.get("cueFile", ""))
    xml_path = raw_xml_dir / str(item.get("xmlFile", ""))
    if not cue_path.is_file() or not xml_path.is_file():
        return False
    try:
        return (
            sha256_bytes(cue_path.read_bytes()) == item.get("cueFileSha256")
            and sha256_bytes(xml_path.read_bytes()) == item.get("xmlSha256")
        )
    except OSError:
        return False


def fetch_transcript(
    source: dict[str, Any],
    api_key: str,
    transcript_dir: Path,
    raw_xml_dir: Path,
) -> dict[str, Any]:
    video_id = source["externalId"]
    android = player_response(video_id, api_key, "android")
    status = android.get("playabilityStatus") or {}
    if status.get("status") != "OK":
        raise ValueError(f"player status {status.get('status')}: {status.get('reason')}")
    details = android.get("videoDetails") or {}
    if details.get("channelId") != OWNER_CHANNEL_ID:
        raise ValueError(f"owner mismatch: {details.get('channelId')}")
    tracks = (
        ((android.get("captions") or {}).get("playerCaptionsTracklistRenderer") or {}).get("captionTracks")
        or []
    )
    track = choose_track(tracks)
    base_url = track.get("baseUrl")
    if not isinstance(base_url, str) or not base_url.startswith("https://www.youtube.com/api/timedtext"):
        raise ValueError("caption track did not contain a timedtext URL")
    raw_xml = request_bytes(base_url, headers={"User-Agent": ANDROID_USER_AGENT}, timeout=45)
    duration_seconds = int(details.get("lengthSeconds") or source.get("durationSeconds") or 0)
    cues = parse_caption_xml(raw_xml, duration_seconds * 1000)
    if any(cues[index].start_ms > cues[index + 1].start_ms for index in range(len(cues) - 1)):
        raise ValueError("caption cues are not monotonic")

    xml_path = raw_xml_dir / f"{video_id}.xml"
    cue_path = transcript_dir / f"{video_id}.json"
    atomic_write_bytes(xml_path, raw_xml)
    cue_payload = {
        "schemaVersion": 1,
        "source": source,
        "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "playerEvidence": {
            "client": "ANDROID",
            "clientVersion": ANDROID_CLIENT_VERSION,
            "playabilityStatus": status.get("status"),
            "channelId": details.get("channelId"),
            "author": details.get("author"),
            "title": details.get("title"),
            "durationSeconds": duration_seconds,
        },
        "captionTrack": {
            "languageCode": track.get("languageCode"),
            "name": rendered_text(track.get("name")),
            "kind": track.get("kind") or "manual",
            "vssId": track.get("vssId"),
            "isTranslatable": bool(track.get("isTranslatable")),
        },
        "rawXml": {
            "file": str(xml_path.relative_to(ROOT)),
            "bytes": len(raw_xml),
            "sha256": sha256_bytes(raw_xml),
        },
        "cues": [
            {
                "start_ms": cue.start_ms,
                "duration_ms": cue.duration_ms,
                "end_ms": cue.end_ms,
                "text": cue.text,
            }
            for cue in cues
        ],
    }
    atomic_write_json(cue_path, cue_payload, compact=True)
    cue_bytes = cue_path.read_bytes()
    text_sha = sha256_text("\n".join(cue.text for cue in cues))
    first_start = cues[0].start_ms
    last_end = max(cue.end_ms for cue in cues)
    return {
        "status": "kept",
        "visibility": "public",
        "cueFile": cue_path.name,
        "cueFileSha256": sha256_bytes(cue_bytes),
        "xmlFile": xml_path.name,
        "xmlSha256": sha256_bytes(raw_xml),
        "xmlBytes": len(raw_xml),
        "cueCount": len(cues),
        "textSha256": text_sha,
        "languageCode": track.get("languageCode"),
        "trackKind": track.get("kind") or "manual",
        "durationSeconds": duration_seconds,
        "firstStartMs": first_start,
        "lastEndMs": last_end,
        "coverageRatio": round(last_end / (duration_seconds * 1000), 6) if duration_seconds else None,
        "titleEvidence": details.get("title"),
    }


def chunk_cues(source: dict[str, Any], cues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    bucket: list[dict[str, Any]] = []
    words = 0

    def flush() -> None:
        nonlocal bucket, words
        if not bucket:
            return
        start_ms = int(bucket[0]["start_ms"])
        end_ms = max(int(cue["end_ms"]) for cue in bucket)
        text_parts: list[str] = []
        cue_points: list[list[int]] = []
        char_offset = 0
        for cue in bucket:
            cue_text = str(cue["text"]).strip()
            if text_parts:
                char_offset += 1
            cue_char_start = char_offset
            text_parts.append(cue_text)
            char_offset += len(cue_text)
            cue_start_ms = int(cue["start_ms"])
            cue_end_ms = int(cue["end_ms"])
            cue_points.append(
                [
                    cue_start_ms - start_ms,
                    max(0, cue_end_ms - cue_start_ms),
                    cue_char_start,
                    len(cue_text),
                ]
            )
        text = " ".join(text_parts)
        digest = hashlib.sha256(
            f"{source['id']}:{start_ms}:{end_ms}:{text}".encode("utf-8")
        ).hexdigest()[:18]
        chunks.append(
            {
                "id": f"chunk_{digest}",
                "sourceId": source["id"],
                "sourceTitle": source["title"],
                "sourceKind": source["kind"],
                "canonicalUrl": source["canonicalUrl"],
                "thumbnailUrl": source["thumbnailUrl"],
                "startMs": start_ms,
                "endMs": end_ms,
                "text": text,
                "provenance": "transcript",
                "cuePoints": cue_points,
            }
        )
        bucket = []
        words = 0

    for cue in cues:
        cue_words = len(str(cue["text"]).split())
        projected_duration = int(cue["end_ms"]) - int(bucket[0]["start_ms"]) if bucket else 0
        if bucket and (words + cue_words > 360 or projected_duration > 90_000):
            flush()
        bucket.append(cue)
        words += cue_words
        if int(bucket[-1]["end_ms"]) - int(bucket[0]["start_ms"]) >= 45_000 and words >= 220:
            flush()
    flush()
    return chunks


def build_chunks(
    sources: list[dict[str, Any]],
    manifest: dict[str, Any],
    transcript_dir: Path,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    chunks: list[dict[str, Any]] = []
    counts: dict[str, int] = {}
    for source in sources:
        video_id = source["externalId"]
        item = manifest["items"].get(video_id) or {}
        if item.get("status") != "kept":
            source["transcriptStatus"] = "failed"
            source["segmentCount"] = 0
            continue
        payload = json.loads((transcript_dir / item["cueFile"]).read_text("utf-8"))
        source_chunks = chunk_cues(source, payload["cues"])
        source["transcriptStatus"] = "indexed"
        source["segmentCount"] = len(source_chunks)
        counts[source["id"]] = len(source_chunks)
        chunks.extend(source_chunks)
    chunks.sort(key=lambda chunk: (chunk["sourceId"], chunk["startMs"], chunk["id"]))
    return chunks, counts


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--sources", type=Path, default=DEFAULT_SOURCES)
    parser.add_argument("--private-sources", type=Path, default=DEFAULT_PRIVATE_SOURCES)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--transcripts", type=Path, default=DEFAULT_TRANSCRIPTS)
    parser.add_argument("--raw-xml", type=Path, default=DEFAULT_RAW_XML)
    parser.add_argument("--chunks", type=Path, default=DEFAULT_CHUNKS)
    parser.add_argument("--receipt", type=Path, default=DEFAULT_RECEIPT)
    parser.add_argument("--workers", type=int, default=5)
    parser.add_argument("--max-attempts", type=int, default=3)
    args = parser.parse_args()
    workers = max(1, min(args.workers, 5))
    max_attempts = max(1, min(args.max_attempts, 3))

    records = audit_records(args.input)
    inventory_sources = [source_from_record(record) for record in records]
    public_sources = [source for source in inventory_sources if source["visibility"] == "public"]
    private_sources = [source for source in inventory_sources if source["visibility"] == "unlisted"]
    if len(public_sources) != 518 or len(private_sources) != 15:
        raise ValueError(
            f"privacy partition must be 518 public and 15 unlisted; found "
            f"{len(public_sources)} public and {len(private_sources)} unlisted"
        )
    args.transcripts.mkdir(parents=True, exist_ok=True)
    args.raw_xml.mkdir(parents=True, exist_ok=True)
    args.lock.parent.mkdir(parents=True, exist_ok=True)
    lock = args.lock.open("a+")
    fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
    started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    try:
        manifest = load_manifest(args.manifest)
        api_key, key_source = discover_api_key(public_sources[0]["externalId"])
        manifest.update(
            {
                "schemaVersion": 1,
                "channelId": OWNER_CHANNEL_ID,
                "handle": HANDLE,
                "sourceInventory": str(args.input.relative_to(ROOT)),
                "sourceInventorySha256": sha256_bytes(args.input.read_bytes()),
                "apiKeySource": key_source,
                "client": "ANDROID",
                "clientVersion": ANDROID_CLIENT_VERSION,
                "workers": workers,
                "maxAttemptsPerItem": max_attempts,
                "startedAt": manifest.get("startedAt") or started,
                "lastRunStartedAt": started,
            }
        )
        atomic_write_json(args.manifest, manifest)

        for source in private_sources:
            video_id = source["externalId"]
            prior = manifest["items"].get(video_id) or {}
            manifest["items"][video_id] = {
                "status": "staged_unlisted",
                "visibility": "unlisted",
                "attempts": int(prior.get("attempts", 0)),
                "titleEvidence": source["title"],
                "durationSeconds": source.get("durationSeconds"),
                "publishedAt": source.get("publishedAt"),
                "playlistMemberships": source["discovery"]["playlistMemberships"],
                "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }

        pending: list[dict[str, Any]] = []
        for source in public_sources:
            item = manifest["items"].get(source["externalId"]) or {}
            if is_resumable_success(item, args.transcripts, args.raw_xml):
                continue
            if item.get("status") == "qa_rejected":
                continue
            if int(item.get("attempts", 0)) >= max_attempts:
                continue
            pending.append(source)

        def bounded(source: dict[str, Any]) -> tuple[str, dict[str, Any]]:
            video_id = source["externalId"]
            prior = manifest["items"].get(video_id) or {}
            attempts = int(prior.get("attempts", 0))
            errors: list[str] = list(prior.get("errors") or [])
            while attempts < max_attempts:
                attempts += 1
                try:
                    result = fetch_transcript(source, api_key, args.transcripts, args.raw_xml)
                    result.update({"attempts": attempts, "errors": errors, "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
                    return video_id, result
                except Exception as error:
                    errors.append(f"attempt {attempts}: {type(error).__name__}: {error}")
                    if attempts < max_attempts:
                        time.sleep(0.5 * attempts)
            return video_id, {
                "status": "discarded",
                "attempts": attempts,
                "errors": errors,
                "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }

        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(bounded, source) for source in pending]
            for future in concurrent.futures.as_completed(futures):
                video_id, result = future.result()
                manifest["items"][video_id] = result
                manifest["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                atomic_write_json(args.manifest, manifest)

        for source in public_sources:
            item = manifest["items"].get(source["externalId"]) or {}
            coverage = item.get("coverageRatio")
            if item.get("status") == "kept" and isinstance(coverage, (int, float)) and coverage < 0.8:
                item["status"] = "qa_rejected"
                item["qaEvidence"] = {
                    "check": "caption timestamp coverage >= 0.8",
                    "observedCoverageRatio": coverage,
                    "cueCount": item.get("cueCount"),
                    "firstStartMs": item.get("firstStartMs"),
                    "lastEndMs": item.get("lastEndMs"),
                    "durationSeconds": item.get("durationSeconds"),
                }

        chunks, _ = build_chunks(public_sources, manifest, args.transcripts)
        for source in private_sources:
            source["transcriptStatus"] = "metadata_only"
            source["segmentCount"] = 0
        source_payload = {
            "schemaVersion": 1,
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "channelId": OWNER_CHANNEL_ID,
            "handle": HANDLE,
            "sourceInventorySha256": manifest["sourceInventorySha256"],
            "visibility": "public",
            "sources": public_sources,
        }
        atomic_write_json(args.sources, source_payload)
        private_source_payload = {
            "schemaVersion": 1,
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "channelId": OWNER_CHANNEL_ID,
            "handle": HANDLE,
            "sourceInventorySha256": manifest["sourceInventorySha256"],
            "visibility": "unlisted",
            "publicationStatus": "staged_private_not_approved",
            "sources": private_sources,
        }
        atomic_write_json(args.private_sources, private_source_payload)
        atomic_write_json(args.chunks, chunks)

        public_items = [manifest["items"].get(source["externalId"], {}) for source in public_sources]
        kept = [item for item in public_items if item.get("status") == "kept"]
        qa_rejected = [
            {"id": source["externalId"], "title": source["title"], **manifest["items"].get(source["externalId"], {})}
            for source in public_sources
            if manifest["items"].get(source["externalId"], {}).get("status") == "qa_rejected"
        ]
        discarded = [
            {"id": source["externalId"], "title": source["title"], **manifest["items"].get(source["externalId"], {})}
            for source in public_sources
            if manifest["items"].get(source["externalId"], {}).get("status") == "discarded"
        ]
        source_duration = sum(int(item.get("durationSeconds") or 0) for item in kept)
        transcript_span_ms = sum(
            max(
                0,
                min(
                    int(item.get("lastEndMs") or 0),
                    int(item.get("durationSeconds") or 0) * 1000,
                )
                - int(item.get("firstStartMs") or 0),
            )
            for item in kept
        )
        fetched = kept + [manifest["items"][item["id"]] for item in qa_rejected]
        completed = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        receipt = {
            "schemaVersion": 1,
            "startedAt": started,
            "completedAt": completed,
            "scope": {
                "ownerChannelId": OWNER_CHANNEL_ID,
                "inventorySources": 533,
                "publicTranscriptTarget": 518,
                "unlistedStagedNotPublished": 15,
                "thirdPartyExcluded": 14,
                "unavailableExcluded": 12,
                "mediaDownloaded": False,
                "workers": workers,
                "maxAttemptsPerItem": max_attempts,
            },
            "result": "success" if len(kept) == len(public_sources) else "exhausted",
            "counts": {
                "inventorySources": len(inventory_sources),
                "publicSources": len(public_sources),
                "stagedUnlistedSources": len(private_sources),
                "kept": len(kept),
                "captionTracksFetched": len(fetched),
                "transcriptIndexed": len(kept),
                "qaRejected": len(qa_rejected),
                "discarded": len(discarded),
                "chunks": len(chunks),
                "rawCues": sum(int(item.get("cueCount") or 0) for item in fetched),
                "englishTracks": sum(str(item.get("languageCode", "")).startswith("en") for item in fetched),
                "manualTracks": sum(item.get("trackKind") == "manual" for item in fetched),
                "asrTracks": sum(item.get("trackKind") == "asr" for item in fetched),
            },
            "coverage": {
                "sourceDurationSeconds": source_duration,
                "sourceDurationHours": round(source_duration / 3600, 6),
                "transcriptSpanSeconds": round(transcript_span_ms / 1000, 3),
                "transcriptSpanHours": round(transcript_span_ms / 3_600_000, 6),
                "weightedCoverageRatio": round(transcript_span_ms / (source_duration * 1000), 6) if source_duration else None,
                "lowCoverage": qa_rejected,
            },
            "artifacts": {},
            "qaRejected": qa_rejected,
            "discarded": discarded,
        }
        for label, path in {
            "sourceInventory": args.input,
            "sources": args.sources,
            "privateSources": args.private_sources,
            "manifest": args.manifest,
            "chunks": args.chunks,
        }.items():
            data = path.read_bytes()
            receipt["artifacts"][label] = {
                "path": str(path.relative_to(ROOT)),
                "bytes": len(data),
                "sha256": sha256_bytes(data),
            }
        atomic_write_json(args.receipt, receipt)
        manifest["completedAt"] = completed
        manifest["result"] = receipt["result"]
        manifest["kept"] = len(kept)
        manifest["qaRejected"] = len(qa_rejected)
        manifest["discarded"] = len(discarded)
        atomic_write_json(args.manifest, manifest)
        # Refresh the manifest digest after its terminal update.
        receipt["artifacts"]["manifest"] = {
            "path": str(args.manifest.relative_to(ROOT)),
            "bytes": args.manifest.stat().st_size,
            "sha256": sha256_bytes(args.manifest.read_bytes()),
        }
        atomic_write_json(args.receipt, receipt)
        print(json.dumps(receipt, ensure_ascii=False, indent=2))
    finally:
        fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
        lock.close()


if __name__ == "__main__":
    main()
