#!/usr/bin/env tsx
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

import { detectVideoProvider } from "../src/ingest/media";
import type { CoverageInventoryEntry } from "../src/types";

const execFileAsync = promisify(execFile);

interface SkoolLessonJson {
  id?: string;
  title?: string;
  url?: string;
  html?: string;
  videoLink?: string;
  videoId?: string;
}

async function skoolAvailable(): Promise<boolean> {
  const cli = process.env.SKOOL_CLI ?? "skool";
  try {
    await execFileAsync(cli, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function fetchLessonsFromSkool(communitySlug: string): Promise<SkoolLessonJson[]> {
  const cli = process.env.SKOOL_CLI ?? "skool";
  const { stdout: coursesRaw } = await execFileAsync(cli, ["list-courses", "-g", communitySlug, "--json"]);
  const courses = JSON.parse(coursesRaw) as Array<{ id: string; title?: string }>;
  const lessons: SkoolLessonJson[] = [];

  for (const course of courses) {
    const { stdout: lessonsRaw } = await execFileAsync(cli, [
      "list-lessons",
      "-g",
      communitySlug,
      "--course",
      course.title ?? course.id,
      "--json"
    ]);
    const courseLessons = JSON.parse(lessonsRaw) as Array<{ id: string; title?: string; url?: string }>;
    for (const lesson of courseLessons) {
      const { stdout: lessonRaw } = await execFileAsync(cli, [
        "get-lesson",
        "-g",
        communitySlug,
        "--id",
        lesson.id,
        "--json"
      ]);
      lessons.push(JSON.parse(lessonRaw) as SkoolLessonJson);
    }
  }

  return lessons;
}

function inventoryFromLessons(lessons: SkoolLessonJson[]): CoverageInventoryEntry[] {
  return lessons.map((lesson) => {
    const provider = detectVideoProvider({
      videoLink: lesson.videoLink,
      videoId: lesson.videoId,
      html: lesson.html
    });
    const hasText = Boolean(lesson.html?.replace(/<[^>]+>/g, "").trim());
    let tier: CoverageInventoryEntry["tier"] = 1;
    let extractableNow = hasText;
    let blockedReason: string | undefined;

    if (provider === "wistia" || provider === "loom" || provider === "youtube") {
      tier = 2;
      extractableNow = true;
    } else if (provider === "skool_native") {
      tier = 4;
      extractableNow = false;
      blockedReason = "Native Skool-hosted video — 401/403 on direct probe";
    } else if (provider === "unknown" && lesson.videoLink) {
      tier = 4;
      extractableNow = false;
      blockedReason = "Unknown video provider — manual review required";
    }

    return {
      lessonId: lesson.id ?? "unknown",
      title: lesson.title ?? "Untitled",
      canonicalUrl: lesson.url ?? "",
      hasText,
      videoProvider: provider,
      extractableNow,
      blockedReason,
      tier
    };
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const inputFlag = args.find((arg) => arg.startsWith("--input="))?.split("=")[1];
  const outputDir = path.resolve("data/inventory");
  await mkdir(outputDir, { recursive: true });

  let lessons: SkoolLessonJson[];

  if (inputFlag) {
    lessons = JSON.parse(await readFile(inputFlag, "utf8")) as SkoolLessonJson[];
  } else {
    const communitySlug = process.env.COMMUNITY_SLUG ?? args[0];
    if (!communitySlug) {
      console.error("Usage: npm run coverage:inventory -- <community-slug>");
      console.error("   or: npm run coverage:inventory -- --input=lessons.json");
      process.exit(1);
    }
    if (!(await skoolAvailable())) {
      console.error("skool CLI not found. Export lessons JSON and pass --input=lessons.json");
      process.exit(1);
    }
    lessons = await fetchLessonsFromSkool(communitySlug);
  }

  const inventory = inventoryFromLessons(lessons);
  const summary = {
    total: inventory.length,
    extractableNow: inventory.filter((entry) => entry.extractableNow).length,
    blocked: inventory.filter((entry) => !entry.extractableNow).length,
    byTier: {
      tier1: inventory.filter((entry) => entry.tier === 1).length,
      tier2: inventory.filter((entry) => entry.tier === 2).length,
      tier3: inventory.filter((entry) => entry.tier === 3).length,
      tier4: inventory.filter((entry) => entry.tier === 4).length
    }
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(outputDir, `coverage-${timestamp}.json`);
  await writeFile(jsonPath, JSON.stringify({ summary, inventory }, null, 2));

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Wrote ${jsonPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
