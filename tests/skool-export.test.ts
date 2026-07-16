import { describe, expect, it } from "vitest";

import { mapSkoolPageToLesson } from "../lib/community/skool-export";

describe("skool export mapper", () => {
  it("maps vault page fields into lesson export", () => {
    const lesson = mapSkoolPageToLesson(
      {
        page_id: "page-1",
        title: "Playwright Skill",
        url: "https://www.skool.com/claude/classroom/page-1",
        course_path: ["WEB SKILLS"],
        page_type: "skill_card",
        desc_raw: "Browser automation pack",
        resources_field: [{ type: "zip", file_id: "abc", file_name: "playwright.zip" }]
      },
      { groupSlug: "claude", courseId: "64307591", courseTitle: "Claude Skills Vault" }
    );

    expect(lesson.curriculumPath).toEqual(["Claude Skills Vault", "WEB SKILLS"]);
    expect(lesson.pageType).toBe("skill_card");
    expect(lesson.summary).toBe("Browser automation pack");
    expect(lesson.resources).toEqual([
      { type: "zip", file_id: "abc", file_name: "playwright.zip" }
    ]);
  });
});
