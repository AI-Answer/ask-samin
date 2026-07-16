import type { SourceAsset, SourceAssetType } from "../types";

interface RawResourceRecord {
  type?: string;
  file_id?: string;
  file_name?: string;
  name?: string;
  url?: string;
  link?: string;
}

function assetTypeFromRecord(record: RawResourceRecord): SourceAssetType {
  const typeHint = record.type?.trim().toLowerCase();
  const name = (record.file_name ?? record.name ?? "").toLowerCase();
  const url = (record.url ?? record.link ?? "").toLowerCase();

  if (typeHint === "zip" || name.endsWith(".zip")) return "zip";
  if (typeHint === "github" || url.includes("github.com")) return "github";
  if (typeHint === "video") return "video";
  return "url";
}

function normalizeResources(raw: unknown): RawResourceRecord[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter((entry): entry is RawResourceRecord => Boolean(entry) && typeof entry === "object");
  }
  if (typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    if (Array.isArray(record.files)) {
      return normalizeResources(record.files);
    }
    if (Array.isArray(record.items)) {
      return normalizeResources(record.items);
    }
    return [record as RawResourceRecord];
  }
  return [];
}

export function parseSourceAssets(input: {
  sourceId: string;
  resources?: unknown;
  githubUrl?: string;
  videoUrl?: string;
}): SourceAsset[] {
  const assets: SourceAsset[] = [];
  const seen = new Set<string>();

  const push = (asset: Omit<SourceAsset, "id">) => {
    const key = `${asset.assetType}:${asset.fileId ?? ""}:${asset.url ?? ""}:${asset.fileName ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    assets.push({ ...asset, id: `${input.sourceId}__asset_${assets.length}` });
  };

  for (const record of normalizeResources(input.resources)) {
    push({
      sourceId: input.sourceId,
      assetType: assetTypeFromRecord(record),
      fileId: record.file_id?.trim() || undefined,
      fileName: (record.file_name ?? record.name)?.trim() || undefined,
      url: (record.url ?? record.link)?.trim() || undefined
    });
  }

  if (input.githubUrl?.trim()) {
    push({
      sourceId: input.sourceId,
      assetType: "github",
      url: input.githubUrl.trim()
    });
  }

  if (input.videoUrl?.trim()) {
    push({
      sourceId: input.sourceId,
      assetType: "video",
      url: input.videoUrl.trim()
    });
  }

  return assets;
}

export function assetsSummary(assets: SourceAsset[]): string {
  if (assets.length === 0) return "";
  return assets
    .map((asset) => {
      const label = asset.fileName ?? asset.fileId ?? asset.url ?? asset.assetType;
      return `- ${asset.assetType}: ${label}`;
    })
    .join("\n");
}
