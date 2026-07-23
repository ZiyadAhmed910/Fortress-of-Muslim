import { WorkerEntrypoint } from 'cloudflare:workers';
import { app } from './app';
import { executeRecordQuery } from './lib/record-query';
import { answerQuestion, indexNextPendingBatch } from './rag';
import { D1ContentRepository } from './repositories/d1-content-repository';
import type { Bindings } from './types';

export default class ApiWorker extends WorkerEntrypoint<Bindings> {
  fetch(request: Request) { return app.fetch(request, this.env, this.ctx); }

  scheduled() {
    this.ctx.waitUntil(indexNextPendingBatch(this.env));
  }

  async executeMcpTool(tool: { toolType: string; standardToolName?: string; namedQueryId?: string }, args: Record<string, unknown>, ownerUserId: string) {
    const repository = new D1ContentRepository(this.env.CONTENT_DB);
    if (tool.toolType === 'named_query' && tool.namedQueryId) {
      const definition = await this.env.AUTH.getNamedQuery(tool.namedQueryId, ownerUserId);
      if (!definition) throw new Error('Named query is unavailable.');
      if (definition.queryKind === 'record_query') return executeRecordQuery(this.env.CONTENT_DB, definition, Object.fromEntries(Object.entries(args).map(([key, value]) => [key, String(value)])));
      throw new Error('Only record-query tools are supported.');
    }
    const name = tool.standardToolName;
    if (name === 'get_dua') return repository.getDua(String(args.id ?? ''));
    if (name === 'get_dua_evidence') return repository.getDuaEvidence(String(args.id ?? ''));
    if (name === 'find_dua') return {
      query: String(args.query ?? ''),
      matches: await repository.findDuasByTitle(String(args.query ?? ''), fuzzyLimit(args.limit)),
    };
    if (name === 'search_duas') return (await repository.searchDuas(String(args.query ?? ''), 0, limit(args.limit))).items;
    if (name === 'list_duas') return repository.listDuas(0, limit(args.limit));
    if (name === 'random_dua') return repository.getRandomDua();
    if (name === 'list_collections') return repository.listCollections(contentType(args.type));
    if (name === 'list_hadith') return repository.listHadith(optionalString(args.collection), 0, limit(args.limit));
    if (name === 'search_hadith') return (await repository.searchHadith(String(args.query ?? ''), optionalString(args.collection), 0, limit(args.limit))).items;
    if (name === 'get_hadith') return repository.getHadith(String(args.id ?? ''));
    if (name === 'ask_fortress') {
      const question = String(args.question ?? '').trim();
      if (question.length < 5 || question.length > 500) throw new Error('Question must contain between 5 and 500 characters.');
      return answerQuestion(this.env, repository, question, `mcp:${ownerUserId}`);
    }
    if (name === 'current_dataset') return repository.getCurrentDataset();
    throw new Error('Tool is not supported by the Fortress API runtime.');
  }
}

function limit(value: unknown) { return Math.min(50, Math.max(1, Number(value) || 20)); }
function fuzzyLimit(value: unknown) { return Math.min(3, Math.max(1, Number(value) || 1)); }
function optionalString(value: unknown) { const result = String(value ?? '').trim(); return result || undefined; }
function contentType(value: unknown) { const result = optionalString(value); return result === 'dua' || result === 'hadith' ? result : undefined; }
