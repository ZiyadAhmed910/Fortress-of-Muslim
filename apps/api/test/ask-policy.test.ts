import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chooseAskModel, extractAnswerText, loadAskSettings, mergeCandidates, rankByRelevance } from '../src/rag';

// Ask spends real money per answer, and the good model spends it about twice as fast as the cheap
// one. The policy is: use the better model until a set share of its daily allowance is gone, then
// hand over -- nobody is refused an answer because the good model ran out.
const settings = {
  perIpDailyLimit: 20,
  primaryModel: '@cf/openai/gpt-oss-120b',
  primaryDailyLimit: 80,
  primarySwitchPercent: 75,
  secondaryModel: '@cf/openai/gpt-oss-20b',
  secondaryDailyLimit: 600,
};

describe('choosing which model answers', () => {
  it('uses the better model while its share of the day is unspent', () => {
    expect(chooseAskModel(settings, {}).model).toBe('@cf/openai/gpt-oss-120b');
    expect(chooseAskModel(settings, { '@cf/openai/gpt-oss-120b': 59 }).tier).toBe('primary');
  });

  it('hands over at the switch point, not at the limit', () => {
    // 75% of 80 is 60: the last quarter of the allowance stays in reserve for embeddings, indexing
    // and the cheaper model, which is the point of having a switch point at all.
    expect(chooseAskModel(settings, { '@cf/openai/gpt-oss-120b': 60 }).model).toBe('@cf/openai/gpt-oss-20b');
  });

  it('still answers once both allowances are spent', () => {
    const spent = { '@cf/openai/gpt-oss-120b': 80, '@cf/openai/gpt-oss-20b': 600 };
    const choice = chooseAskModel(settings, spent);
    expect(choice.tier).toBe('fallback');
    expect(choice.model).toBe('@cf/meta/llama-3.2-3b-instruct');
  });

  it('treats 0 as unlimited', () => {
    const unlimited = { ...settings, primaryDailyLimit: 0 };
    expect(chooseAskModel(unlimited, { '@cf/openai/gpt-oss-120b': 100_000 }).tier).toBe('primary');
  });

  it('counts each model separately, so a busy day on one does not spend the other', () => {
    expect(chooseAskModel(settings, { '@cf/openai/gpt-oss-20b': 599 }).model).toBe('@cf/openai/gpt-oss-120b');
  });
});

describe('the policy stored in the database', () => {
  const askMigration = () => {
    const database = new Database(':memory:');
    database.exec(readFileSync(resolve(__dirname, '../migrations/0019_ask_controls.sql'), 'utf8'));
    return database;
  };

  it('ships defaults an environment can answer questions with', () => {
    const row = askMigration().prepare('SELECT * FROM ask_settings WHERE id = 1').get() as Record<string, unknown>;
    expect(row.per_ip_daily_limit).toBe(20);
    expect(row.primary_model).toBe('@cf/openai/gpt-oss-120b');
    expect(row.secondary_model).toBe('@cf/openai/gpt-oss-20b');
    expect(row.primary_switch_percent).toBe(75);
  });

  it('holds exactly one row of settings', () => {
    const database = askMigration();
    expect(() => database.prepare('INSERT INTO ask_settings (id) VALUES (2)').run()).toThrow();
  });

  it('refuses a switch point that is not a percentage', () => {
    const database = askMigration();
    expect(() => database.prepare('UPDATE ask_settings SET primary_switch_percent = 0 WHERE id = 1').run()).toThrow();
    expect(() => database.prepare('UPDATE ask_settings SET primary_switch_percent = 101 WHERE id = 1').run()).toThrow();
  });

  it('refuses a negative limit but allows 0, which means unlimited', () => {
    const database = askMigration();
    expect(() => database.prepare('UPDATE ask_settings SET per_ip_daily_limit = -1 WHERE id = 1').run()).toThrow();
    database.prepare('UPDATE ask_settings SET per_ip_daily_limit = 0 WHERE id = 1').run();
    expect((database.prepare('SELECT per_ip_daily_limit AS n FROM ask_settings').get() as { n: number }).n).toBe(0);
  });

  it('falls back to defaults rather than failing when the table is missing', async () => {
    // An environment that has not run the migration yet must still answer questions.
    const bare = { prepare: () => ({ first: async () => { throw new Error('no such table'); } }) } as never;
    expect((await loadAskSettings(bare)).primaryModel).toBe('@cf/openai/gpt-oss-120b');
  });
});

describe('reranking what retrieval found', () => {
  const dua = (id: string, title: string, text: string) => ({
    record: {
      id,
      title,
      parts: [[{ kind: 'translation' as const, text }]],
      legacyId: id,
      sequence: 1,
      readingRole: 'supplication' as const,
      partCount: 1,
      verificationStatus: 'verified' as const,
      workflowState: 'verified' as const,
      verifiedBy: null,
      verifiedAt: null,
      revisionNumber: 1,
      publishedAt: null,
      canonicalUrl: 'https://fortressofmuslim.org/' + id,
    },
    contentType: 'dua' as const,
    score: 0.7,
    retrieval: 'vector' as const,
  });
  const candidates = [
    dua('dua.hisn.017', 'Before undressing', 'In the Name of Allah.'),
    dua('dua.hisn.015', 'Before entering the bathroom', 'O Allah, I seek protection in You from evil.'),
    dua('dua.hisn.020', 'Upon entering the mosque', 'O Allah, open the gates of Your mercy for me.'),
  ];
  const rerankerScoring = (score: (text: string) => number) => ({
    AI: {
      run: async (_model: string, input: { contexts: Array<{ text: string }> }) => ({
        response: input.contexts.map((context, id) => ({ id, score: score(context.text) })),
      }),
    },
  }) as never;

  it('keeps what answers the question and drops what merely sits near it', async () => {
    // The reported case: asked about a toilet, all three of these are plausible neighbours in
    // embedding space, and the old score floor let every one of them through as a citation.
    const env = rerankerScoring((text) => (/bathroom/i.test(text) ? 0.92 : 0.04));
    const { records, reranked } = await rankByRelevance(env, 'what do I say before entering the toilet', candidates);
    expect(reranked).toBe(true);
    expect(records.map((record) => record.record.id)).toEqual(['dua.hisn.015']);
    expect(records[0]!.score).toBeCloseTo(0.92);
  });

  it('orders by how well each source answers, not by how it was found', async () => {
    const env = rerankerScoring((text) => (/mosque/i.test(text) ? 0.9 : /bathroom/i.test(text) ? 0.6 : 0.45));
    const { records } = await rankByRelevance(env, 'entering the mosque', candidates);
    expect(records.map((record) => record.record.title)).toEqual([
      'Upon entering the mosque',
      'Before entering the bathroom',
      'Before undressing',
    ]);
  });

  it('cuts the tail that is nowhere near the best match', async () => {
    // The reported failure: one good match, and five others close enough in embedding space to be
    // retrieved and nowhere near close enough to cite.
    const env = rerankerScoring((text) => (/mosque/i.test(text) ? 0.9 : 0.2));
    const { records } = await rankByRelevance(env, 'entering the mosque', candidates);
    expect(records.map((record) => record.record.title)).toEqual(['Upon entering the mosque']);
  });

  it('keeps a weak best match rather than answering nothing at all', async () => {
    // A cross-encoder scores an indirectly-worded question far lower against the very reading that
    // answers it. "I cannot sleep at night" scored every candidate under a tidy-looking floor and
    // returned nothing for a question the book does answer.
    const env = rerankerScoring((text) => (/bathroom/i.test(text) ? 0.09 : 0.02));
    const { records } = await rankByRelevance(env, 'somewhere to wash', candidates);
    expect(records.map((record) => record.record.title)).toEqual(['Before entering the bathroom']);
  });

  it('says nothing rather than citing six near-misses', async () => {
    const env = rerankerScoring(() => 0.02);
    const { records } = await rankByRelevance(env, 'how do I file a tax return', candidates);
    expect(records).toEqual([]);
  });

  it('keeps answering when the reranker is unavailable', async () => {
    const env = { AI: { run: async () => { throw new Error('model unavailable'); } } } as never;
    const { records, reranked } = await rankByRelevance(env, 'anything', candidates);
    expect(reranked).toBe(false);
    expect(records).toHaveLength(3);
  });

  it('merges both retrieval paths without a score floor of its own', () => {
    // Vector and lexical scores are not comparable to each other; the floor that used to judge them
    // together is what let loosely-related readings through. Everything goes to the reranker.
    const merged = mergeCandidates([candidates[0]!], [{ ...candidates[1]!, retrieval: 'lexical' as const, score: 0.41 }]);
    expect(merged).toHaveLength(2);
    expect(merged.map((item) => item.record.id)).toContain('dua.hisn.015');
  });
});

describe('reading an answer out of whatever shape the model replied in', () => {
  // This was a silent failure in production: gpt-oss replies in OpenAI's chat-completions shape,
  // the code read { response }, and every answer quietly became the deterministic fallback. The
  // call succeeded, so nothing logged and nothing looked broken from the outside.
  it('reads the Llama shape', () => {
    expect(extractAnswerText({ response: '  Say Bismillah [1].  ' })).toBe('Say Bismillah [1].');
  });

  it('reads the chat-completions shape the gpt-oss models reply in', () => {
    expect(extractAnswerText({
      id: 'x', object: 'chat.completion', created: 1, model: '@cf/openai/gpt-oss-120b',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Say Bismillah [1].' }, finish_reason: 'stop' }],
    })).toBe('Say Bismillah [1].');
  });

  it('reads the Responses API shape, and never the reasoning', () => {
    const text = extractAnswerText({
      output: [
        { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'The user asks about the bathroom...' }] },
        { type: 'message', content: [{ type: 'output_text', text: 'Say Bismillah [1].' }] },
      ],
    });
    expect(text).toBe('Say Bismillah [1].');
    expect(text).not.toContain('The user asks');
  });

  it('returns nothing it cannot read, rather than a guess', () => {
    for (const shape of [null, undefined, {}, 'text', 42, { choices: [] }, { output: [] }]) {
      expect(extractAnswerText(shape)).toBe('');
    }
  });
});
