#!/usr/bin/env python3
"""Convert creator-owned transcript exports into timestamped search chunks.

Accepted filenames begin with an 11-character YouTube video id and end in
.vtt, .srt, .json, or .txt. Timed formats preserve exact cues. Plain text is
accepted for search but deliberately receives a zero timestamp.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import fcntl
import hashlib
import html
import json
import re
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "imports"
DEFAULT_OUTPUT = ROOT / "data" / "transcripts" / "chunks.json"
STATE_DIR = ROOT / ".cache" / "ingestion"
MANIFEST_PATH = STATE_DIR / "manifest.json"
LOCK_PATH = STATE_DIR / "manifest.lock"
VIDEO_ID_RE = re.compile(r"(?:^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{11})(?:[^A-Za-z0-9_-]|$)")
TIMESTAMP_RE = re.compile(
    r"(?P<start>\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3})\s+-->\s+"
    r"(?P<end>\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3})"
)
TAG_RE = re.compile(r"<[^>]+>")


@dataclass(frozen=True)
class Cue:
    start_ms: int
    end_ms: int
    text: str


def timestamp_ms(value: str) -> int:
    parts = value.replace(",", ".").split(":")
    if len(parts) == 2:
        hours = 0
        minutes, seconds = parts
    else:
        hours, minutes, seconds = parts
    return int((int(hours) * 3600 + int(minutes) * 60 + float(seconds)) * 1000)


def clean_text(value: str) -> str:
    value = html.unescape(TAG_RE.sub("", value))
    value = re.sub(r"\s+", " ", value).strip()
    return value


def parse_timed_text(text: str) -> list[Cue]:
    cues: list[Cue] = []
    lines = text.replace("\r\n", "\n").split("\n")
    index = 0
    while index < len(lines):
        match = TIMESTAMP_RE.search(lines[index])
        if not match:
            index += 1
            continue
        index += 1
        body: list[str] = []
        while index < len(lines) and lines[index].strip():
            body.append(lines[index])
            index += 1
        value = clean_text(" ".join(body))
        if value:
            cues.append(Cue(timestamp_ms(match["start"]), timestamp_ms(match["end"]), value))
    return cues


def parse_json_payload(payload: object) -> list[Cue]:
    rows = payload.get("segments", payload) if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        raise ValueError("JSON transcript must be an array or contain a segments array")
    cues: list[Cue] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        text = clean_text(str(row.get("text", "")))
        start = row.get("start_ms", row.get("start", 0))
        end = row.get("end_ms", row.get("end"))
        duration = row.get("duration_ms", row.get("duration", 0))
        start_ms = int(float(start) * (1 if "start_ms" in row else 1000))
        if end is not None:
            end_ms = int(float(end) * (1 if "end_ms" in row else 1000))
        else:
            end_ms = start_ms + int(float(duration) * (1 if "duration_ms" in row else 1000))
        if text:
            cues.append(Cue(start_ms, max(start_ms, end_ms), text))
    return cues


def source_id(file: Path) -> str:
    match = VIDEO_ID_RE.search(file.stem)
    if not match:
        raise ValueError("filename must contain an 11-character YouTube video id")
    return f"youtube_{match.group(1)}"


def read_cues(file: Path) -> list[Cue]:
    text = file.read_text("utf-8-sig")
    suffix = file.suffix.lower()
    if suffix in {".vtt", ".srt"}:
        return parse_timed_text(text)
    if suffix == ".json":
        return parse_json_payload(json.loads(text))
    value = clean_text(text)
    return [Cue(0, 0, value)] if value else []


def chunk_cues(source: str, cues: list[Cue]) -> list[dict]:
    chunks: list[dict] = []
    bucket: list[Cue] = []
    words = 0

    def flush() -> None:
        nonlocal bucket, words
        if not bucket:
            return
        start_ms = bucket[0].start_ms
        end_ms = bucket[-1].end_ms
        text = " ".join(cue.text for cue in bucket)
        digest = hashlib.sha256(f"{source}:{start_ms}:{end_ms}:{text}".encode()).hexdigest()[:18]
        video_id = source.removeprefix("youtube_")
        chunks.append(
            {
                "id": f"chunk_{digest}",
                "sourceId": source,
                "sourceTitle": video_id,
                "sourceKind": "video",
                "canonicalUrl": f"https://www.youtube.com/watch?v={video_id}",
                "thumbnailUrl": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
                "startMs": start_ms,
                "endMs": end_ms,
                "text": text,
                "provenance": "creator_export",
            }
        )
        bucket = []
        words = 0

    for cue in cues:
        cue_words = len(cue.text.split())
        projected_duration = cue.end_ms - bucket[0].start_ms if bucket else 0
        if bucket and (words + cue_words > 360 or projected_duration > 90_000):
            flush()
        bucket.append(cue)
        words += cue_words
        if bucket[-1].end_ms - bucket[0].start_ms >= 45_000 and words >= 220:
            flush()
    flush()
    return chunks


def process(file: Path) -> tuple[str, list[dict]]:
    sid = source_id(file)
    cues = read_cues(file)
    if not cues:
        raise ValueError("transcript contained no usable cues")
    return sid, chunk_cues(sid, cues)


def locked_manifest() -> tuple[object, dict]:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    lock = LOCK_PATH.open("a+")
    fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
    try:
        manifest = json.loads(MANIFEST_PATH.read_text()) if MANIFEST_PATH.exists() else {"files": {}}
    except json.JSONDecodeError:
        manifest = {"files": {}}
    return lock, manifest


def save_manifest(lock: object, manifest: dict) -> None:
    manifest["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")
    fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
    lock.close()


def candidates(directory: Path) -> Iterable[Path]:
    for suffix in ("*.vtt", "*.srt", "*.json", "*.txt"):
        yield from directory.rglob(suffix)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--workers", type=int, default=5)
    args = parser.parse_args()
    files = sorted(set(candidates(args.input)))
    lock, manifest = locked_manifest()
    existing = json.loads(args.output.read_text()) if args.output.exists() else []
    chunks_by_source = {}
    for chunk in existing:
        chunks_by_source.setdefault(chunk["sourceId"], []).append(chunk)

    def bounded(file: Path) -> tuple[Path, str, list[dict] | Exception]:
        last_error: Exception | None = None
        for attempt in range(1, 4):
            try:
                sid, chunks = process(file)
                return file, sid, chunks
            except Exception as error:  # bounded retry receipt records the final evidence
                last_error = error
                if attempt < 3:
                    time.sleep(0.05 * attempt)
        return file, "", last_error or RuntimeError("unknown ingestion failure")

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(args.workers, 12))) as pool:
        for file, sid, result in pool.map(bounded, files):
            key = str(file.relative_to(ROOT) if file.is_relative_to(ROOT) else file)
            if isinstance(result, Exception):
                manifest["files"][key] = {"status": "discarded", "attempts": 3, "evidence": str(result)}
                continue
            chunks_by_source[sid] = result
            manifest["files"][key] = {
                "status": "kept",
                "attempts": 1,
                "source_id": sid,
                "chunks": len(result),
            }

    flattened = [chunk for source_chunks in chunks_by_source.values() for chunk in source_chunks]
    flattened.sort(key=lambda chunk: (chunk["sourceId"], chunk["startMs"], chunk["id"]))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(flattened, indent=2) + "\n")
    save_manifest(lock, manifest)
    kept = sum(1 for item in manifest["files"].values() if item["status"] == "kept")
    discarded = sum(1 for item in manifest["files"].values() if item["status"] == "discarded")
    print(json.dumps({"files": len(files), "kept": kept, "discarded": discarded, "chunks": len(flattened)}))


if __name__ == "__main__":
    main()
