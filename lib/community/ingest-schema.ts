import { z } from "zod";

export const lessonSchema = z.object({
  id: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  url: z.string().url().max(2_000),
  curriculumPath: z.array(z.string().trim().min(1)).max(20).optional(),
  html: z.string().max(500_000).optional(),
  markdown: z.string().max(500_000).optional(),
  transcript: z.string().max(2_000_000).optional(),
  videoLink: z.string().url().max(2_000).optional(),
  videoId: z.string().trim().max(200).optional(),
  publish: z.boolean().optional(),
  groupSlug: z.string().trim().max(100).optional(),
  courseId: z.string().trim().max(100).optional(),
  sourceType: z
    .enum([
      "lesson_page",
      "community_post",
      "call_recording",
      "video",
      "curator_note",
      "resource_link"
    ])
    .optional(),
  pageKind: z
    .enum(["lesson_page", "skill_card", "asset_pointer", "prompt_playbook", "concept_lesson"])
    .optional(),
  pageType: z.string().trim().max(100).optional(),
  summary: z.string().max(10_000).optional(),
  resources: z.unknown().optional(),
  githubUrl: z.string().url().max(2_000).optional()
});

export const ingestLessonsSchema = z.array(lessonSchema).min(1).max(150);
