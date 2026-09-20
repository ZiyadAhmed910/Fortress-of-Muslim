import { describe, expect, it } from 'vitest';
import { EMBEDDING_CALL_TOKEN_BUDGET, embeddingCalls, indexNextPendingBatch } from '../src/rag';

// Workers AI charges an embedding call as inputs x the longest input, and refuses one over the
// model's context. This is the shape of the batch that failed on test after 0018 published a new
// dataset: fifty readings, one of them (dua.hisn.004) 2,768 characters long.
const failingBatch = Array.from({ length: 50 }, (_, index) => 'x'.repeat(index === 3 ? 2768 : 300 + index * 20));
const paddedCost = (texts: string[]) => texts.length * Math.max(...texts.map((text) => text.length));

describe('embedding call sizing', () => {
  it('splits a batch so no call exceeds the padded budget', () => {
    const calls = embeddingCalls(failingBatch);
    expect(calls.length).toBeGreaterThan(1);
    for (const call of calls) expect(paddedCost(call)).toBeLessThanOrEqual(EMBEDDING_CALL_TOKEN_BUDGET);
  });

  it('keeps every text, in order', () => {
    expect(embeddingCalls(failingBatch).flat()).toEqual(failingBatch);
  });

  it('still sends a single text on its own, however long', () => {
    expect(embeddingCalls(['x'.repeat(4000)])).toEqual([['x'.repeat(4000)]]);
    expect(embeddingCalls([])).toEqual([]);
  });

  it('indexes the batch that failed, giving each record its own vector', async () => {
    const rows = failingBatch.map((text, index) => ({
      recordId: `dua.hisn.${String(index + 1).padStart(3, '0')}`,
      contentType: 'dua', collectionSlug: 'hisn', title: `Reading ${index + 1}`, narrator: null,
      translation: text, arabic: null, datasetId: 'canonical.roles.test',
    }));
    const upserts: Array<{ id: string; values: number[] }> = [];
    const database = {
      prepare(sql: string) {
        const statement = {
          bind: (..._values: unknown[]) => statement,
          first: async () => (sql.includes('canonical_dataset_versions')
            ? { id: 'canonical.roles.test', recordCount: 50 }
            : sql.includes('rag_index_state') ? { indexedCount: 0, status: 'failed' } : null),
          all: async () => ({ results: sql.includes('FROM canonical_publications') ? rows : [] }),
          run: async () => ({ success: true }),
        };
        return statement;
      },
    };
    const env = {
      CONTENT_DB: database,
      AI: {
        // Behaves like Workers AI: refuses an over-budget call. Each vector records its input's length.
        run: async (_model: string, input: { text: string[] }) => {
          if (paddedCost(input.text) > EMBEDDING_CALL_TOKEN_BUDGET) throw new Error('3030: Max context reached');
          return { data: input.text.map((text) => [text.length]) };
        },
      },
      VECTOR_INDEX: { upsert: async (items: Array<{ id: string; values: number[] }>) => { upserts.push(...items); } },
    } as never;

    const result = await indexNextPendingBatch(env);

    expect(result).toMatchObject({ indexed: 50, complete: true });
    expect(upserts.map((item) => item.id)).toEqual(rows.map((row) => row.recordId));
    const reading4 = upserts.find((item) => item.id === 'dua.hisn.004')!;
    expect(reading4.values[0]).toBeGreaterThan(2768);   // its own text, not a neighbour's
  });
});

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
