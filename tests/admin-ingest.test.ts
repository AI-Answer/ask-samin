import { describe, expect, it } from "vitest";

import { normalizeSimpleIngest } from "../lib/admin-ingest";
import { simpleAdminIngestRequestSchema } from "../lib/validation";

describe("simple admin-ingest visibility", () => {
  it("keeps a URL-bearing source private unless publication is explicit", () => {
    const payload = normalizeSimpleIngest({
      kind: "video",
      title: "Unlisted creator lesson",
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      persist: true,
      isPublic: false
    });

    expect(payload.sources[0].isPublic).toBe(false);
  });

  it("preserves an explicit public approval", () => {
    const payload = normalizeSimpleIngest({
      kind: "document",
      title: "Approved public guide",
      url: "https://example.com/guide",
      persist: true,
      isPublic: true
    });

    expect(payload.sources[0].isPublic).toBe(true);
  });

  it("rejects unsafe URL schemes and public records without a canonical URL", () => {
    expect(
      simpleAdminIngestRequestSchema.safeParse({
        kind: "web",
        title: "Unsafe link",
        url: "javascript:alert(1)",
        isPublic: true,
        persist: false
      }).success
    ).toBe(false);

    expect(
      simpleAdminIngestRequestSchema.safeParse({
        kind: "document",
        title: "Missing public URL",
        isPublic: true,
        persist: false
      }).success
    ).toBe(false);
  });
});
