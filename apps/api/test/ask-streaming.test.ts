import { describe, expect, it } from 'vitest';
import type { ContentRepository } from '../src/repositories/content-repository';
import { extractDeltaText, streamAnswer } from '../src/rag';

// Ask spends real seconds per question -- an embedding, a vector query, a lexical query, a reranker
// pass, then a model writing prose. None of that is overhead that can be tuned away, but a reader
// used to see a blank panel for all of it. Streaming does not make the work shorter; it makes the
// waiting legible. These cover the contract a client can rely on while that happens.

const dua = (id: string, title: string, translation: string) => ({
  id,
  legacyId: id,
  sequence: 1,
  title,
  readingRole: 'supplication' as const,
  partCount: 1,
  verificationStatus: 'verified' as const,
  workflowState: 'verified' as const,
  verifiedBy: 'reviewer',
  verifiedAt: '2026-07-23T00:00:00.000Z',
  revisionNumber: 1,
  publishedAt: '2026-07-23T00:00:00.000Z',
  canonicalUrl: `https://fortressofmuslim.org/${id}`,
  parts: [[{ kind: 'translation' as const, text: translation }]],
});

const source = dua('dua.hisn.010', 'Before entering the bathroom', 'O Allah, I seek protection in You.');

/** A Workers AI streamed reply: server-sent frames carrying chat-completion deltas. */
const modelStream = (pieces: string[]) => new ReadableStream<Uint8Array>({
  start(controller) {
    const encoder = new TextEncoder();
    for (const piece of pieces) {
      const chunk = { choices: [{ index: 0, delta: { content: piece } }] };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
    }
    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    controller.close();
  },
});

const repositoryWith = (recordCount: number) => ({
  getCurrentDataset: async () => ({
    id: 'canonical.stream.test',
    sourceName: 'Stream test',
    sourceVersion: '1',
    publicationStatus: 'active',
    verificationStatus: 'verified',
    recordCount,
    contentHash: 'stream',
    importedAt: '2026-07-23T00:00:00.000Z',
  }),
  searchForRag: async () => [{ id: source.id, contentType: 'dua' as const, score: 0.95 }],
  searchCurrentForRag: async () => [],
  getPublishedDua: async (id: string) => (id === source.id ? source : undefined),
  getPublishedHadith: async () => undefined,
} as unknown as ContentRepository);

const envWith = (pieces: string[], seen?: { models: string[] }) => ({
  CONTENT_DB: { prepare: () => ({ bind: () => ({ first: async () => ({ requestCount: 1 }), run: async () => ({}) }) }) },
  AI: {
    run: async (model: string, input: { stream?: boolean; contexts?: Array<{ text: string }> }) => {
      seen?.models.push(model);
      if (model.includes('bge-m3')) throw new Error('no vectors in this test');
      if (model.includes('reranker')) {
        return { response: (input.contexts ?? []).map((_context, id) => ({ id, score: 0.9 })) };
      }
      if (model.includes('llama')) return { response: '' };       // query expansion: no variants
      return input.stream ? modelStream(pieces) : { response: pieces.join('') };
    },
  },
  VECTOR_INDEX: { query: async () => { throw new Error('no vectors in this test'); } },
} as never);

/** Collects the server-sent events a stream produced, in order. */
async function collect(stream: ReadableStream<Uint8Array>) {
  const text = await new Response(stream).text();
  return text.split('\n\n').filter(Boolean).map((frame) => {
    const event = frame.match(/^event: (.+)$/m)?.[1] ?? '';
    const data = frame.match(/^data: (.+)$/m)?.[1] ?? '{}';
    return { event, data: JSON.parse(data) as Record<string, unknown> };
  });
}

describe('reading a delta out of whatever shape the model streams in', () => {
  it('reads the chat-completions delta the gpt-oss models stream', () => {
    expect(extractDeltaText({ choices: [{ index: 0, delta: { content: 'Say ' } }] })).toBe('Say ');
  });

  it('reads the Llama shape', () => {
    expect(extractDeltaText({ response: 'Bismillah' })).toBe('Bismillah');
  });

  it('reads the Responses API delta, and never the reasoning', () => {
    expect(extractDeltaText({ type: 'response.output_text.delta', delta: 'answer text' })).toBe('answer text');
    // A reasoning model streams its thinking as well. It must never reach a reader.
    expect(extractDeltaText({ type: 'response.reasoning_text.delta', delta: 'The user is asking...' })).toBe('');
  });

  it('returns nothing for a chunk it cannot read, rather than a guess', () => {
    for (const chunk of [null, undefined, {}, 'text', 42, { choices: [] }, { choices: [{ delta: {} }] }]) {
      expect(extractDeltaText(chunk)).toBe('');
    }
  });
});

describe('streaming an answer', () => {
  it('reports the stage, then the sources, then the answer as it is written', async () => {
    const events = await collect(streamAnswer(
      envWith(['Say Bismillah', ' before entering [1].']),
      repositoryWith(1),
      'what do I say before entering the toilet',
      'stream-test',
    ));
    expect(events.map((entry) => entry.event)).toEqual([
      'status', 'sources', 'status', 'delta', 'delta', 'done',
    ]);
    expect(events[0]!.data.stage).toBe('retrieving');
    expect(events[2]!.data.stage).toBe('writing');
  });

  it('sends the sources before a single word of the answer exists', async () => {
    // This is the point of the whole endpoint: retrieval finishes seconds before generation does,
    // and a reader can be looking at real citations during the wait instead of a blank panel.
    const events = await collect(streamAnswer(
      envWith(['Answer [1].']),
      repositoryWith(1),
      'what do I say before entering the toilet',
      'stream-test',
    ));
    const sourcesAt = events.findIndex((entry) => entry.event === 'sources');
    const firstDeltaAt = events.findIndex((entry) => entry.event === 'delta');
    expect(sourcesAt).toBeLessThan(firstDeltaAt);
    const sources = (events[sourcesAt]!.data as { sources: Array<{ title: string }> }).sources;
    expect(sources[0]!.title).toBe('Before entering the bathroom');
  });

  it('ends with the whole answer, so a client never has to stitch the pieces itself', async () => {
    const events = await collect(streamAnswer(
      envWith(['Say ', 'Bismillah ', 'first [1].']),
      repositoryWith(1),
      'what do I say before entering the toilet',
      'stream-test',
    ));
    const done = events.at(-1)!;
    expect(done.event).toBe('done');
    expect(done.data.answer).toBe('Say Bismillah first [1].');
    expect((done.data.meta as { generated: boolean }).generated).toBe(true);
  });

  it('replaces an answer that cites nothing, rather than letting it stand', async () => {
    // The citation rule does not relax because the text arrived a word at a time: it can only be
    // checked once the answer is complete, so the client is told to discard what it showed.
    const events = await collect(streamAnswer(
      envWith(['Just say it, no citation here.']),
      repositoryWith(1),
      'what do I say before entering the toilet',
      'stream-test',
    ));
    const replace = events.find((entry) => entry.event === 'replace');
    expect(replace).toBeTruthy();
    expect(replace!.data.answer).not.toContain('no citation here');
    const done = events.at(-1)!;
    expect((done.data.meta as { generated: boolean; model: string | null }).generated).toBe(false);
    expect((done.data.meta as { model: string | null }).model).toBeNull();
  });

  it('says so without calling a model when the dataset is empty', async () => {
    const seen = { models: [] as string[] };
    const events = await collect(streamAnswer(
      envWith(['unused'], seen),
      repositoryWith(0),
      'what do I say before entering the toilet',
      'stream-test',
    ));
    expect(events.map((entry) => entry.event)).toEqual(['status', 'sources', 'done']);
    expect(events.at(-1)!.data.answer).toContain('no published records yet');
    expect(seen.models).toEqual([]);
  });

  it('reports a failure in the stream, because the status code has already been sent', async () => {
    const broken = {
      CONTENT_DB: { prepare: () => { throw new Error('database unavailable'); } },
      AI: { run: async () => ({ response: '' }) },
      VECTOR_INDEX: { query: async () => { throw new Error('no'); } },
    } as never;
    const events = await collect(streamAnswer(broken, repositoryWith(1), 'a question about something', 'stream-test'));
    const failure = events.find((entry) => entry.event === 'error');
    expect(failure).toBeTruthy();
    expect(failure!.data.code).toBe('ask_failed');
  });

  it('still answers when the model stream itself dies mid-sentence', async () => {
    const dying = {
      CONTENT_DB: { prepare: () => ({ bind: () => ({ first: async () => ({ requestCount: 1 }), run: async () => ({}) }) }) },
      AI: {
        run: async (model: string, input: { stream?: boolean; contexts?: Array<{ text: string }> }) => {
          if (model.includes('bge-m3')) throw new Error('no vectors');
          if (model.includes('reranker')) return { response: (input.contexts ?? []).map((_c, id) => ({ id, score: 0.9 })) };
          if (model.includes('llama')) return { response: '' };
          if (input.stream) throw new Error('model stream failed');
          return { response: '' };
        },
      },
      VECTOR_INDEX: { query: async () => { throw new Error('no vectors'); } },
    } as never;
    const events = await collect(streamAnswer(dying, repositoryWith(1), 'what do I say before entering the toilet', 'stream-test'));
    const done = events.at(-1)!;
    expect(done.event).toBe('done');
    expect(done.data.answer).toBeTruthy();
    expect((done.data.meta as { generated: boolean }).generated).toBe(false);
  });
});
