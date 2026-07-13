import { z } from "zod";

const httpUrlSchema = z
  .string()
  .trim()
  .max(4_000)
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "URL must use http or https");

export const sourceKindSchema = z.enum([
  "video",
  "short",
  "community_call",
  "document",
  "web"
]);

const provenanceSchema = z.enum(["transcript", "creator_export", "metadata", "document"]);

const knowledgeSourceSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    externalId: z.string().trim().min(1).max(500),
    kind: sourceKindSchema,
    title: z.string().trim().min(1).max(1_000),
    canonicalUrl: httpUrlSchema,
    thumbnailUrl: httpUrlSchema.optional(),
    description: z.string().max(20_000).optional(),
    publishedAt: z.string().max(100).optional(),
    durationSeconds: z.number().int().nonnegative().max(10_000_000).optional(),
    transcriptStatus: z.enum(["indexed", "metadata_only", "processing", "failed"]),
    segmentCount: z.number().int().nonnegative().max(10_000_000),
    tags: z.array(z.string().trim().min(1).max(100)).max(100),
    isPublic: z.boolean().optional()
  })
  .strict();

const knowledgeChunkSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    sourceId: z.string().trim().min(1).max(200),
    sourceTitle: z.string().trim().min(1).max(1_000),
    sourceKind: sourceKindSchema,
    canonicalUrl: httpUrlSchema,
    thumbnailUrl: httpUrlSchema.optional(),
    startMs: z.number().int().nonnegative().max(100_000_000),
    endMs: z.number().int().nonnegative().max(100_000_000),
    text: z.string().trim().min(1).max(50_000),
    provenance: provenanceSchema
  })
  .strict();

const ingestSegmentSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    sourceId: z.string().trim().min(1).max(200),
    startMs: z.number().int().nonnegative().max(100_000_000),
    endMs: z.number().int().nonnegative().max(100_000_000),
    speaker: z.string().trim().max(500).optional(),
    rawText: z.string().min(1).max(50_000),
    normalizedText: z.string().min(1).max(50_000).optional(),
    provenance: provenanceSchema,
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export const searchRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(2_000),
    limit: z.number().int().min(1).max(20).optional(),
    kinds: z.array(sourceKindSchema).max(5).optional()
  })
  .strict();

export const chatRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(2_000),
    messages: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().trim().min(1).max(4_000)
          })
          .strict()
      )
      .max(12)
      .optional()
  })
  .strict();

export const adminIngestRequestSchema = z
  .object({
    mode: z.enum(["preview", "persist"]).default("preview"),
    sources: z.array(knowledgeSourceSchema).max(1_000).default([]),
    segments: z.array(ingestSegmentSchema).max(5_000).default([]),
    chunks: z.array(knowledgeChunkSchema).max(5_000).default([])
  })
  .strict();

export const simpleAdminIngestRequestSchema = z
  .object({
    kind: sourceKindSchema,
    title: z.string().trim().min(1).max(1_000),
    url: httpUrlSchema.optional(),
    externalId: z.string().trim().min(1).max(500).optional(),
    text: z.string().trim().min(1).max(500_000).optional(),
    persist: z.boolean().default(false),
    isPublic: z.boolean().default(false)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.isPublic && !value.url) {
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: "A public source requires an http(s) canonical URL."
      });
    }

    if (value.isPublic && (value.kind === "video" || value.kind === "short") && value.url) {
      const hostname = new URL(value.url).hostname.toLowerCase();
      const isYouTube =
        hostname === "youtu.be" || hostname === "youtube.com" || hostname.endsWith(".youtube.com");
      if (!isYouTube) {
        context.addIssue({
          code: "custom",
          path: ["url"],
          message: "Public video and Short sources must use a YouTube URL."
        });
      }
    }
  });
