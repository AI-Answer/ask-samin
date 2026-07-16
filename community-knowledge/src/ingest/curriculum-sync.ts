import type { CurriculumNode } from "../types";

export function slugifySegment(value: string): string {
  return (
    value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "node"
  );
}

export function buildCurriculumNodes(input: {
  sourceId: string;
  title: string;
  curriculumPath: string[];
  groupSlug?: string;
  courseId?: string;
  externalId?: string;
}): CurriculumNode[] {
  const { sourceId, curriculumPath, groupSlug, courseId, externalId } = input;
  if (curriculumPath.length === 0) return [];

  const nodes: CurriculumNode[] = [];
  let parentId: string | null = null;
  const prefix =
    groupSlug && courseId ? `${groupSlug}__${courseId}` : groupSlug ? `group__${groupSlug}` : "path";

  for (let index = 0; index < curriculumPath.length; index += 1) {
    const segment = curriculumPath[index];
    const slug = slugifySegment(segment);
    const isLast = index === curriculumPath.length - 1;
    const pathKey = curriculumPath.slice(0, index + 1).map(slugifySegment).join("__");
    const nodeId = `${prefix}__${pathKey}`;

    let nodeType: CurriculumNode["nodeType"];
    if (isLast) {
      nodeType = "lesson";
    } else if (index === 0) {
      nodeType = "course";
    } else {
      nodeType = "folder";
    }

    nodes.push({
      id: nodeId,
      parentId,
      title: segment,
      slug,
      order: index,
      nodeType,
      sourceId: isLast ? sourceId : undefined,
      groupSlug,
      courseId,
      externalId: isLast ? externalId : undefined
    });
    parentId = nodeId;
  }

  return nodes;
}
