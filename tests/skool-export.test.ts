import { describe, expect, it } from "vitest";

import { mapSkoolExportToLessons, normalizeIngestBody } from "@/lib/community/skool-export";

describe("skool export mapper", () => {
  it("maps skool_ingest.v1 pages to lesson payloads", () => {
    const lessons = mapSkoolExportToLessons({
      schema_version: "skool_ingest.v1",
      community: "claude",
      course: { short_id: "e63905c6" },
      pages: [
        {
          page_id: "abc123",
          title: "Day 01 intro",
          url: "https://www.skool.com/claude/classroom/e63905c6?md=abc123",
          course_path: ["Claude Masterclass", "Day 01"],
          html: "<p>Hello</p>",
          transcript: {
            status: "ok_captions",
            transcript_text: "[00:00] Welcome",
            method: "yt-dlp_captions"
          },
          video: { url: "https://home.wistia.com/medias/demo" }
        }
      ]
    });

    expect(lessons).toHaveLength(1);
    expect(lessons[0]).toMatchObject({
      id: "abc123",
      title: "Day 01 intro",
      transcript: "[00:00] Welcome",
      videoLink: "https://home.wistia.com/medias/demo",
      groupSlug: "claude",
      courseId: "e63905c6",
      publish: true
    });
  });

  it("accepts direct lessons[] in normalizeIngestBody", () => {
    const lessons = normalizeIngestBody({
      lessons: [
        {
          id: "x",
          title: "T",
          url: "https://example.com",
          publish: true
        }
      ]
    });
    expect(lessons).toHaveLength(1);
  });
});
