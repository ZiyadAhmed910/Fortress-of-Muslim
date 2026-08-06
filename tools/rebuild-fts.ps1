param(
  [ValidateSet('test', 'production')]
  [string]$Environment = 'test',
  [string]$ProductionApproval
)

# Rebuilds canonical_search_fts (apps/api/migrations/0006_canonical_editorial.sql) from canonical
# records. FTS5 virtual tables are excluded from D1 exports (Cloudflare cannot export a database
# containing virtual tables -- see tools/backup-d1.ps1 and docs/incident-response.md), so after a
# disaster-recovery restore from a SQL export into a replacement database, search is either missing
# entirely or stale. Time Travel restores do not need this: they preserve FTS5 and database
# internals directly (see tools/restore-d1.ps1).
#
# This mirrors, exactly, the full-rebuild SQL the application already runs itself during Hadith
# book verification (apps/auth/src/editorial-plane.ts, the DELETE FROM canonical_search_fts /
# INSERT INTO canonical_search_fts ... WHERE state.verified_at IS NOT NULL AND state.workflow_state
# IN ('approved', 'published') pair) rather than inventing new logic -- that code path is already
# exercised in production every time a book is verified, so this reuses proven behavior instead of
# adding an independent, untested implementation of the same intent.
#
# content_search_fts (apps/api/migrations/0004_corpus_ingestion.sql) is a superseded legacy FTS
# table with zero application references (confirmed via docs/codebase-map) and is intentionally not
# touched here.

$ErrorActionPreference = 'Stop'
if ($Environment -eq 'production' -and $ProductionApproval -ne 'REBUILD-PRODUCTION-FTS') {
  throw 'Production rebuild requires -ProductionApproval REBUILD-PRODUCTION-FTS.'
}

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$npxCommand = Get-Command npx.cmd -ErrorAction SilentlyContinue
if (-not $npxCommand) { $npxCommand = Get-Command npx -ErrorAction Stop }
$database = "fortress-platform-$Environment"
$config = 'apps/api/wrangler.jsonc'

function Invoke-D1Query {
  param([string]$Sql)
  $json = & $npxCommand.Source wrangler d1 execute $database --remote --env $Environment --config $config --command $Sql --json
  if ($LASTEXITCODE -ne 0) { throw "D1 query failed against $database." }
  return $json | ConvertFrom-Json
}

$expectedResult = Invoke-D1Query "SELECT COUNT(*) AS count FROM editorial_record_state WHERE verified_at IS NOT NULL AND workflow_state IN ('approved','published')"
$expected = $expectedResult[0].results[0].count
Write-Host "Expected FTS row count (verified + approved/published editorial state): $expected"

$rebuildSql = @'
CREATE VIRTUAL TABLE IF NOT EXISTS canonical_search_fts USING fts5(
  canonical_id UNINDEXED,
  revision_id UNINDEXED,
  content_type UNINDEXED,
  collection_slug UNINDEXED,
  title,
  body,
  narrator,
  tokenize = 'unicode61 remove_diacritics 2'
);
DELETE FROM canonical_search_fts;
INSERT INTO canonical_search_fts (
  canonical_id, revision_id, content_type, collection_slug, title, body, narrator
)
SELECT canonical.canonical_id, revision.id, canonical.content_type,
       COALESCE(collection.slug, CASE WHEN canonical.content_type = 'dua' THEN 'hisn' ELSE 'unknown' END),
       revision.title, COALESCE(GROUP_CONCAT(segment.text, ' '), ''),
       COALESCE(metadata.narrator, '')
FROM canonical_records canonical
JOIN content_revisions revision ON revision.id = canonical.current_revision_id
JOIN editorial_record_state state ON state.canonical_id = canonical.canonical_id
LEFT JOIN revision_metadata metadata ON metadata.revision_id = revision.id
LEFT JOIN collections collection ON collection.id = metadata.collection_id
LEFT JOIN revision_parts part ON part.revision_id = revision.id
LEFT JOIN revision_segments segment ON segment.revision_part_id = part.id
WHERE state.verified_at IS NOT NULL AND state.workflow_state IN ('approved', 'published')
GROUP BY canonical.canonical_id, revision.id;
'@

$sqlPath = Join-Path ([System.IO.Path]::GetTempPath()) "fortress-fts-rebuild-$Environment-$(Get-Date -Format 'yyyyMMdd-HHmmss').sql"
Set-Content -LiteralPath $sqlPath -Value $rebuildSql -Encoding utf8
try {
  Write-Host "Rebuilding canonical_search_fts on $database..."
  & $npxCommand.Source wrangler d1 execute $database --remote --env $Environment --config $config --file $sqlPath --yes
  if ($LASTEXITCODE -ne 0) { throw "FTS rebuild failed for $database." }
} finally {
  Remove-Item -LiteralPath $sqlPath -Force -ErrorAction SilentlyContinue
}

$actualResult = Invoke-D1Query 'SELECT COUNT(*) AS count FROM canonical_search_fts'
$actual = $actualResult[0].results[0].count
Write-Host "Actual canonical_search_fts row count after rebuild: $actual"

if ($actual -ne $expected) {
  throw "FTS rebuild row count mismatch: expected $expected, got $actual. Do not return this database to active traffic until this is understood."
}

Write-Host "FTS rebuild verified: $actual rows match the expected verified/published editorial record count."
