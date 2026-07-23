import { describe, expect, it } from 'vitest';
import { indexNextPendingBatch } from '../src/rag';

describe('canonical RAG indexing', () => {
  it('embeds a verified Hadith with content type metadata', async () => {
    const upserts: Array<Record<string, unknown>> = [];
    const database = {
      prepare(sql: string) {
        const statement = {
          bind: (..._values: unknown[]) => statement,
          first: async () => {
            if (sql.includes('canonical_dataset_versions')) {
              return { id: 'canonical.mixed.test', recordCount: 1 };
            }
            if (sql.includes('rag_index_state')) {
              return { indexedCount: 0, status: 'pending' };
            }
            return null;
          },
          all: async () => ({
            results: sql.includes('FROM canonical_publications')
              ? [{
                recordId: 'hadith.bukhari.1',
                contentType: 'hadith',
                collectionSlug: 'bukhari',
                title: 'Actions are judged by intentions',
                narrator: 'Umar bin Al-Khattab',
                translation: 'Actions are judged by intentions.',
                arabic: 'Test Arabic',
                datasetId: 'canonical.mixed.test',
              }]
              : [],
          }),
          run: async () => ({ success: true }),
        };
        return statement;
      },
    };
    const env = {
      CONTENT_DB: database,
      AI: { run: async () => ({ data: [[0.1, 0.2, 0.3]] }) },
      VECTOR_INDEX: {
        upsert: async (items: Array<Record<string, unknown>>) => { upserts.push(...items); },
      },
    } as never;

    const result = await indexNextPendingBatch(env);

    expect(result).toMatchObject({ datasetId: 'canonical.mixed.test', indexed: 1, complete: true });
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      id: 'hadith.bukhari.1',
      namespace: 'canonical.mixed.test',
      metadata: {
        recordId: 'hadith.bukhari.1',
        contentType: 'hadith',
        collection: 'bukhari',
      },
    });
  });
});
