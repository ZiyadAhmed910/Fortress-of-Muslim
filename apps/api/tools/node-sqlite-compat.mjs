export function withNodeSqliteCompatibility(sql) {
  // Cloudflare D1 supports FTS5, while Node's experimental SQLite build may omit it.
  return sql.replace(
    /CREATE VIRTUAL TABLE content_search_fts USING fts5\([\s\S]*?\n\);/,
    `CREATE TABLE content_search_fts (
      logical_id TEXT,
      dataset_id TEXT,
      content_type TEXT,
      collection_slug TEXT,
      title TEXT,
      body TEXT,
      narrator TEXT
    );`,
  ).replace(
    /CREATE VIRTUAL TABLE canonical_search_fts USING fts5\([\s\S]*?\n\);/,
    `CREATE TABLE canonical_search_fts (
      canonical_id TEXT,
      revision_id TEXT,
      content_type TEXT,
      collection_slug TEXT,
      title TEXT,
      body TEXT,
      narrator TEXT
    );`,
  );
}
