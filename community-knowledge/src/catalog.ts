import seedCatalog from "../data/seed/catalog.json";
import type { CurriculumNode, SeedCatalog } from "./types";

export function getSeedCatalog(): SeedCatalog {
  return seedCatalog as SeedCatalog;
}

export function getCurriculumNodes(): CurriculumNode[] {
  return getSeedCatalog().curriculumNodes;
}

export function listRecentUpdates(limit = 10) {
  return [...getSeedCatalog().sources]
    .filter((source) => source.visibility === "published")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit)
    .map((source) => ({
      id: source.id,
      title: source.title,
      sourceType: source.sourceType,
      canonicalUrl: source.canonicalUrl,
      updatedAt: source.updatedAt,
      curriculumPath: source.curriculumPath
    }));
}
