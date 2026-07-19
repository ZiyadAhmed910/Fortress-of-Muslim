import { describe, expect, it } from 'vitest';
import { executeRecordQuery, type RecordQueryDefinition } from '../src/lib/record-query';

const definition: RecordQueryDefinition = {
  id: 'qry-test', queryKind: 'record_query', objectName: 'duas', selectedFields: ['id', 'title', 'sequence'],
  filters: [{ field: 'verificationStatus', operator: 'eq', source: 'parameter', value: 'status' }],
  sort: { field: 'sequence', direction: 'desc' }, maxRows: 25,
};

describe('record query compiler', () => {
  it('compiles allowlisted fields while binding caller parameters', async () => {
    let sql = ''; let bindings: unknown[] = [];
    const database = { prepare(statement: string) { sql = statement; return { bind(...values: unknown[]) { bindings = values; return { all: async () => ({ results: [{ id: 'dua.hisn.001', title: 'When waking up', sequence: 1 }] }) }; } }; } } as unknown as D1Database;
    const result = await executeRecordQuery(database, definition, { status: "verified' OR 1=1 --" });

    expect(sql).not.toContain("verified' OR 1=1");
    expect(sql).toContain('record.verification_status = ?');
    expect(bindings).toEqual(["verified' OR 1=1 --", 25]);
    expect(result).toHaveLength(1);
  });

  it('rejects missing endpoint parameters', async () => {
    const database = {} as D1Database;
    await expect(executeRecordQuery(database, definition, {})).rejects.toThrow('Required query parameter is missing');
  });
});
