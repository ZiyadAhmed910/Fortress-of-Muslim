import { z } from 'zod';

export const API_VERSION = 'v1' as const;
export const PLATFORM_NAME = 'Fortress Platform' as const;
export const PLATFORM_VERSION = '0.16.0' as const;
export const CURRENT_DATASET_ID = 'dataset.hisn.legacy.2026-07-11-v2' as const;

export const contentSegmentSchema = z.object({
  kind: z.enum(['arabic', 'transliteration', 'translation', 'comment']),
  text: z.string(),
});

export const duaSummarySchema = z.object({
  id: z.string(),
  legacyId: z.string(),
  sequence: z.number().int().positive(),
  title: z.string(),
  partCount: z.number().int().nonnegative(),
  verificationStatus: z.literal('verified'),
  revisionNumber: z.number().int().positive(),
  publishedAt: z.string(),
  canonicalUrl: z.string().url(),
});

export const duaSchema = duaSummarySchema.extend({
  parts: z.array(z.array(contentSegmentSchema)),
});

export const duaPartSchema = z.object({
  duaId: z.string(),
  position: z.number().int().positive(),
  segmentCount: z.number().int().nonnegative(),
  segments: z.array(contentSegmentSchema),
});

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const searchSchema = paginationSchema.extend({
  q: z.string().trim().min(2).max(200),
});

export const partPositionSchema = z.coerce.number().int().positive();

export const contentTypeSchema = z.enum(['dua', 'hadith']);

export const collectionSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  contentType: contentTypeSchema,
  title: z.string(),
  titleArabic: z.string().nullable(),
  recordCount: z.number().int().nonnegative(),
  bookCount: z.number().int().nonnegative(),
  chapterCount: z.number().int().nonnegative(),
  verificationStatus: z.enum(['pending', 'verified', 'rejected', 'deprecated']),
});

export const hadithSummarySchema = z.object({
  id: z.string(),
  sequence: z.number().int().positive(),
  displayNumber: z.string(),
  title: z.string(),
  collection: z.object({ slug: z.string(), title: z.string() }),
  book: z.object({ number: z.string().nullable(), title: z.string() }).nullable(),
  chapter: z.object({ number: z.string().nullable(), title: z.string() }).nullable(),
  narrator: z.string().nullable(),
  grade: z.object({ value: z.string(), authority: z.string().nullable() }).nullable(),
  verificationStatus: z.literal('verified'),
  revisionNumber: z.number().int().positive(),
  publishedAt: z.string(),
  canonicalUrl: z.string().url(),
});

export const hadithSchema = hadithSummarySchema.extend({
  segments: z.array(contentSegmentSchema),
  references: z.array(z.object({
    type: z.string(),
    locator: z.string(),
  })),
});

export const hadithListSchema = paginationSchema.extend({
  collection: z.string().trim().min(1).max(80).optional(),
});

export const hadithSearchSchema = hadithListSchema.extend({
  q: z.string().trim().min(2).max(200),
});

export const askQuestionSchema = z.object({
  question: z.string().trim().min(5).max(500),
});

export const vectorIndexBatchSchema = z.object({
  cursor: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});

export type ContentSegment = z.infer<typeof contentSegmentSchema>;
export type DuaSummary = z.infer<typeof duaSummarySchema>;
export type Dua = z.infer<typeof duaSchema>;
export type DuaPart = z.infer<typeof duaPartSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type ContentType = z.infer<typeof contentTypeSchema>;
export type CollectionSummary = z.infer<typeof collectionSummarySchema>;
export type HadithSummary = z.infer<typeof hadithSummarySchema>;
export type Hadith = z.infer<typeof hadithSchema>;
export type AskQuestion = z.infer<typeof askQuestionSchema>;
