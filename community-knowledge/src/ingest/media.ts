import { hashContent } from "../chunking/markdown";
import type { MediaAsset, MediaExtractability, MediaProvider, MediaTranscriptStatus } from "../types";

export function detectVideoProvider(payload: {
  videoLink?: string;
  videoId?: string;
  html?: string;
  localRef?: string;
}): MediaProvider {
  const link = payload.videoLink ?? "";
  const html = payload.html ?? "";
  if (payload.localRef) return "local_ref";
  if (/wistia/i.test(link) || /wistia/i.test(html)) return "wistia";
  if (/loom\.com/i.test(link) || /loom/i.test(html)) return "loom";
  if (/youtube\.com|youtu\.be/i.test(link) || /youtube/i.test(html)) return "youtube";
  if (payload.videoId && !link) return "skool_native";
  return link ? "unknown" : "none";
}

export function mediaExtractabilityForProvider(
  provider: MediaProvider
): { extractability: MediaExtractability; transcriptStatus: MediaTranscriptStatus; blockedReason?: string } {
  switch (provider) {
    case "wistia":
    case "loom":
    case "youtube":
      return { extractability: "extractable", transcriptStatus: "none" };
    case "skool_native":
      return {
        extractability: "blocked",
        transcriptStatus: "blocked",
        blockedReason: "Native Skool-hosted video — 401/403 on direct probe"
      };
    case "local_ref":
      return { extractability: "pending", transcriptStatus: "none" };
    case "unknown":
      return {
        extractability: "unknown",
        transcriptStatus: "none",
        blockedReason: "Unknown video provider — manual review required"
      };
    default:
      return { extractability: "pending", transcriptStatus: "none" };
  }
}

export function buildMediaAsset(input: {
  sourceId: string;
  provider: MediaProvider;
  externalId?: string;
  url?: string;
  durationMs?: number;
  fingerprint?: string;
}): MediaAsset | null {
  if (input.provider === "none") return null;

  const tier = mediaExtractabilityForProvider(input.provider);
  const id = `${input.sourceId}__media_${input.provider}_${hashContent(
    [input.externalId, input.url, input.provider].filter(Boolean).join("\u0000")
  ).slice(0, 16)}`;

  return {
    id,
    sourceId: input.sourceId,
    provider: input.provider,
    externalId: input.externalId,
    url: input.url,
    durationMs: input.durationMs,
    fingerprint: input.fingerprint,
    extractability: tier.extractability,
    downloadStatus: tier.extractability === "extractable" ? "pending" : "skipped",
    transcriptStatus: tier.transcriptStatus,
    blockedReason: tier.blockedReason
  };
}

export function buildMediaAssetsFromLesson(input: {
  sourceId: string;
  videoLink?: string;
  videoId?: string;
  html?: string;
}): MediaAsset[] {
  const provider = detectVideoProvider(input);
  const asset = buildMediaAsset({
    sourceId: input.sourceId,
    provider,
    externalId: input.videoId,
    url: input.videoLink
  });
  return asset ? [asset] : [];
}
