export type RecordQueryDefinition = {
  id: string;
  queryKind?: 'legacy' | 'record_query';
  objectName?: 'duas' | 'hadith';
  selectedFields?: string[];
  filters?: Array<{ field: string; operator: string; source: 'literal' | 'parameter'; value: string }>;
  sort?: { field: string; direction: 'asc' | 'desc' };
  parameterSchema?: Array<{ name: string; type: 'string' | 'number'; required: boolean }>;
  maxRows?: number;
};

type FieldDef = { expression: string; type: 'string' | 'number' };

// Fields common to both content types -- every column here comes off canonical_records/
// content_revisions, which both duas and hadith share.
const sharedFields: Record<string, FieldDef> = {
  id: { expression: 'publication.canonical_id', type: 'string' },
  legacyId: { expression: 'revision.legacy_id', type: 'string' },
  sequence: { expression: 'revision.sequence', type: 'number' },
  title: { expression: 'revision.title', type: 'string' },
  verificationStatus: { expression: 'publication.verification_status', type: 'string' },
  partCount: { expression: '(SELECT COUNT(*) FROM revision_parts part WHERE part.revision_id = revision.id)', type: 'number' },
};

const OBJECT_CONFIG: Record<'duas' | 'hadith', { contentType: 'dua' | 'hadith'; fields: Record<string, FieldDef>; joins: string }> = {
  duas: { contentType: 'dua', fields: sharedFields, joins: '' },
  hadith: {
    contentType: 'hadith',
    fields: {
      ...sharedFields,
      narrator: { expression: 'metadata.narrator', type: 'string' },
      grade: { expression: 'metadata.grade', type: 'string' },
      gradingAuthority: { expression: 'metadata.grading_authority', type: 'string' },
      displayNumber: { expression: 'metadata.display_number', type: 'string' },
      collection: { expression: 'collection.slug', type: 'string' },
      bookNumber: { expression: 'book.book_number', type: 'string' },
      chapterNumber: { expression: 'chapter.chapter_number', type: 'string' },
    },
    joins: `
      LEFT JOIN revision_metadata metadata ON metadata.revision_id = revision.id
      LEFT JOIN collections collection ON collection.id = metadata.collection_id
      LEFT JOIN books book ON book.id = metadata.book_id
      LEFT JOIN chapters chapter ON chapter.id = metadata.chapter_id`,
  },
};

export async function executeRecordQuery(database: D1Database, definition: RecordQueryDefinition, input: Record<string, string>) {
  if (definition.queryKind !== 'record_query') throw new Error('Unsupported record query definition.');
  const config = OBJECT_CONFIG[definition.objectName ?? 'duas'];
  if (!config) throw new Error('Unsupported record query definition.');
  const fields = config.fields;
  const selected = (definition.selectedFields ?? []).filter((field) => fields[field]);
  if (!selected.length) throw new Error('The query has no valid selected fields.');
  const selectSql = selected.map((field) => `${fields[field]!.expression} AS "${field}"`).join(', ');
  const predicates = [`canonical.content_type = '${config.contentType}'`];
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
    ${config.joins}
    WHERE ${predicates.join(' AND ')} ORDER BY ${sortField.expression} ${direction} LIMIT ?`)
    .bind(...bindings, limit).all<Record<string, unknown>>();
  return result.results;
}

function escapeLike(value: string) { return value.replace(/[\\%_]/g, (character) => `\\${character}`); }
