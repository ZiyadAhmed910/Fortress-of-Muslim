export type RecordQueryDefinition = {
  id: string;
  queryKind?: 'legacy' | 'record_query';
  objectName?: 'duas';
  selectedFields?: string[];
  filters?: Array<{ field: string; operator: string; source: 'literal' | 'parameter'; value: string }>;
  sort?: { field: string; direction: 'asc' | 'desc' };
  parameterSchema?: Array<{ name: string; type: 'string' | 'number'; required: boolean }>;
  maxRows?: number;
};

const fields: Record<string, { expression: string; type: 'string' | 'number' }> = {
  id: { expression: 'publication.canonical_id', type: 'string' },
  legacyId: { expression: 'revision.legacy_id', type: 'string' },
  sequence: { expression: 'revision.sequence', type: 'number' },
  title: { expression: 'revision.title', type: 'string' },
  verificationStatus: { expression: 'publication.verification_status', type: 'string' },
  partCount: { expression: '(SELECT COUNT(*) FROM revision_parts part WHERE part.revision_id = revision.id)', type: 'number' },
};

export async function executeRecordQuery(database: D1Database, definition: RecordQueryDefinition, input: Record<string, string>) {
  if (definition.queryKind !== 'record_query' || definition.objectName !== 'duas') throw new Error('Unsupported record query definition.');
  const selected = (definition.selectedFields ?? []).filter((field) => fields[field]);
  if (!selected.length) throw new Error('The query has no valid selected fields.');
  const selectSql = selected.map((field) => `${fields[field]!.expression} AS "${field}"`).join(', ');
  const predicates = ["canonical.content_type = 'dua'"];
  const bindings: unknown[] = [];

  for (const filter of definition.filters ?? []) {
    const field = fields[filter.field];
    if (!field) throw new Error('The query contains an unsupported field.');
    const rawValue = filter.source === 'parameter' ? input[filter.value] : filter.value;
    if (rawValue === undefined || rawValue === '') throw new Error(`Required query parameter is missing: ${filter.value}`);
    const value = field.type === 'number' ? Number(rawValue) : rawValue;
    if (field.type === 'number' && !Number.isFinite(value)) throw new Error(`Query parameter must be numeric: ${filter.value}`);
    const expression = field.expression;
    if (filter.operator === 'eq') { predicates.push(`${expression} = ?`); bindings.push(value); }
    else if (filter.operator === 'neq') { predicates.push(`${expression} != ?`); bindings.push(value); }
    else if (filter.operator === 'contains' && field.type === 'string') { predicates.push(`${expression} LIKE ? ESCAPE '\\' COLLATE NOCASE`); bindings.push(`%${escapeLike(String(value))}%`); }
    else if (filter.operator === 'starts_with' && field.type === 'string') { predicates.push(`${expression} LIKE ? ESCAPE '\\' COLLATE NOCASE`); bindings.push(`${escapeLike(String(value))}%`); }
    else if (['gt', 'gte', 'lt', 'lte'].includes(filter.operator)) { const operators = { gt: '>', gte: '>=', lt: '<', lte: '<=' }; predicates.push(`${expression} ${operators[filter.operator as keyof typeof operators]} ?`); bindings.push(value); }
    else if (filter.operator === 'in') { const values = String(value).split(',').map((item) => item.trim()).filter(Boolean).slice(0, 50); if (!values.length) throw new Error('An IN filter cannot be empty.'); predicates.push(`${expression} IN (${values.map(() => '?').join(',')})`); bindings.push(...values); }
    else throw new Error(`Operator ${filter.operator} is not valid for ${filter.field}.`);
  }

  const sortField = fields[definition.sort?.field ?? 'sequence'] ?? fields.sequence!;
  const direction = definition.sort?.direction === 'desc' ? 'DESC' : 'ASC';
  const limit = Math.min(200, Math.max(1, definition.maxRows ?? 50));
  const result = await database.prepare(`SELECT ${selectSql} FROM api_current_content publication
    JOIN canonical_records canonical ON canonical.canonical_id = publication.canonical_id
    JOIN content_revisions revision ON revision.id = publication.revision_id
    WHERE ${predicates.join(' AND ')} ORDER BY ${sortField.expression} ${direction} LIMIT ?`)
    .bind(...bindings, limit).all<Record<string, unknown>>();
  return result.results;
}

function escapeLike(value: string) { return value.replace(/[\\%_]/g, (character) => `\\${character}`); }
