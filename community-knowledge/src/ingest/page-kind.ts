import type { PageKind } from "../types";

const PAGE_TYPE_MAP: Record<string, PageKind> = {
  skill_card: "skill_card",
  asset_pointer: "asset_pointer",
  prompt_playbook: "prompt_playbook",
  concept_lesson: "concept_lesson",
  lesson_page: "lesson_page",
  video_lesson: "lesson_page"
};

export function inferPageKind(input: {
  pageType?: string;
  bodyLength: number;
  hasZip: boolean;
  hasGithub: boolean;
  hasTranscript: boolean;
}): PageKind {
  const mapped = input.pageType ? PAGE_TYPE_MAP[input.pageType.trim().toLowerCase()] : undefined;
  if (mapped) return mapped;

  if (input.hasZip) return "skill_card";
  if (!input.bodyLength && input.hasGithub) return "asset_pointer";
  if (input.bodyLength < 200 && input.hasGithub) return "asset_pointer";
  if (input.bodyLength > 1500 && !input.hasZip && !input.hasTranscript) return "prompt_playbook";
  if (input.hasTranscript) return "lesson_page";
  return "concept_lesson";
}
