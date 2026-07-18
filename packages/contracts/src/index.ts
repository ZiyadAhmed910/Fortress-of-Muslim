import { z } from 'zod';

export const API_VERSION = 'v1' as const;
export const PLATFORM_NAME = 'Fortress Platform' as const;
export const PLATFORM_VERSION = '0.2.0' as const;
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
  verificationStatus: z.enum(['pending', 'verified', 'rejected', 'deprecated']),
});

export const duaSchema = duaSummarySchema.extend({
  parts: z.array(z.array(contentSegmentSchema)),
});

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type ContentSegment = z.infer<typeof contentSegmentSchema>;
export type DuaSummary = z.infer<typeof duaSummarySchema>;
export type Dua = z.infer<typeof duaSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
