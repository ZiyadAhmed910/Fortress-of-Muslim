// Generates a navigational index of the repository: exported symbols and imports per
// TypeScript file (via the TS Compiler API, syntactic-only, no cross-file type checking),
// HTTP routes across every Worker (Hono-style and manual pathname-routing style), and a
// reverse index of every SQL table/view -> which files reference it (defined-in vs read/write).
//
// This is a *map*, not a substitute for reading the file you're about to change. Its job is
// to answer "where do I look" cheaply, and to surface anomalies (a table referenced by only
// one file while its siblings are referenced by many is exactly the shape of bug this caught
// in apps/api/src/lib/record-query.ts on 2026-08-06 -- see docs/incident-response.md).
//
// Usage: node tools/generate-codebase-map.mjs
// Output: docs/codebase-map/index.json (full data), docs/codebase-map/README.md (summary).

import ts from 'typescript';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'docs', 'codebase-map');
const EXCLUDE_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.wrangler', '.fortress-backups', 'private-acquisition-do-not-commit', 'sunnah-data-fast-do-not-deploy']);
const SCAN_ROOTS = ['apps', 'packages', 'pwa-website', 'tools'];

function walk(dir, exts, results = []) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) walk(full, exts, results);
    else if (exts.some((ext) => entry.endsWith(ext))) results.push(full);
  }
  return results;
}

function relPath(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/');
}

// ---- TypeScript files: exports + imports via the compiler API (syntactic only) ----

function analyzeTsFile(absPath, text) {
  const source = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const exportsList = [];
  const importsList = [];

  function hasExportModifier(node) {
    return Boolean(node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
  }

  source.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      importsList.push(node.moduleSpecifier.text);
    } else if (ts.isExportAssignment(node)) {
      exportsList.push(node.isExportEquals ? 'export = ...' : 'default export');
    } else if (hasExportModifier(node)) {
      if (ts.isFunctionDeclaration(node) && node.name) exportsList.push(`function ${node.name.text}`);
      else if (ts.isClassDeclaration(node) && node.name) exportsList.push(`class ${node.name.text}`);
      else if (ts.isInterfaceDeclaration(node)) exportsList.push(`interface ${node.name.text}`);
      else if (ts.isTypeAliasDeclaration(node)) exportsList.push(`type ${node.name.text}`);
      else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) exportsList.push(`const ${decl.name.text}`);
        }
      }
    }
  });

  return { exports: exportsList, imports: importsList };
}

// ---- Route extraction (regex-based; robust to Hono-style and manual pathname-routing) ----

function extractRoutes(text, filePath) {
  const routes = [];
  const lines = text.split('\n');
  const honoPattern = /\bapp\.(get|post|put|patch|delete|use)\(\s*['"`]([^'"`]+)['"`]/;
  const pathnamePattern = /url\.pathname\s*(===|\.startsWith\(|\.match\()\s*['"`]?([^'"`)]+)['"`]?/;
  const methodPattern = /request\.method\s*===\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]/;

  lines.forEach((line, index) => {
    const hono = line.match(honoPattern);
    if (hono) {
      routes.push({ style: 'hono', method: hono[1].toUpperCase(), path: hono[2], file: filePath, line: index + 1 });
      return;
    }
    const pathname = line.match(pathnamePattern);
    if (pathname) {
      const method = line.match(methodPattern);
      const matchKind = pathname[1] === '===' ? 'exact' : pathname[1].includes('startsWith') ? 'prefix' : 'pattern';
      routes.push({ style: 'manual', method: method ? method[1] : '(any)', path: pathname[2], matchKind, file: filePath, line: index + 1 });
    }
  });
  return routes;
}

// ---- SQL table/view extraction (full-text regex; SQL is often embedded in multi-line template literals) ----

function extractSqlReferences(text) {
  const defines = []; // { name, kind: 'table' | 'view' }
  const references = new Set();

  const createPattern = /CREATE\s+(VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
  const viewPattern = /CREATE\s+VIEW\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
  const refPattern = /\b(?:FROM|JOIN|INTO|UPDATE)\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;

  let match;
  while ((match = createPattern.exec(text))) defines.push({ name: match[2], kind: match[1] ? 'virtual_table' : 'table' });
  while ((match = viewPattern.exec(text))) defines.push({ name: match[1], kind: 'view' });
  while ((match = refPattern.exec(text))) references.add(match[1]);

  return { defines, references: [...references] };
}

// ---- Main ----

function main() {
  const tsFiles = SCAN_ROOTS.flatMap((root) => walk(path.join(ROOT, root), ['.ts']).filter((f) => !f.endsWith('.d.ts')));
  const jsFiles = SCAN_ROOTS.flatMap((root) => walk(path.join(ROOT, root), ['.js']));
  const sqlFiles = SCAN_ROOTS.flatMap((root) => walk(path.join(ROOT, root), ['.sql']));

  const files = [];
  const routes = [];
  const schema = new Map(); // tableName -> { kind, definedIn: [], referencedBy: Set }

  function touchSchema(name) {
    if (!schema.has(name)) schema.set(name, { kind: null, definedIn: [], referencedBy: new Set() });
    return schema.get(name);
  }

  for (const absPath of [...tsFiles, ...jsFiles]) {
    const text = readFileSync(absPath, 'utf8');
    const rel = relPath(absPath);
    const lineCount = text.split('\n').length;
    const isTs = absPath.endsWith('.ts');
    const { exports: exportsList, imports: importsList } = isTs ? analyzeTsFile(absPath, text) : { exports: [], imports: [] };
    const fileRoutes = extractRoutes(text, rel);
    routes.push(...fileRoutes);
    const { defines, references } = extractSqlReferences(text);
    for (const def of defines) {
      const entry = touchSchema(def.name);
      entry.kind = def.kind;
      entry.definedIn.push(rel);
    }
    for (const ref of references) {
      touchSchema(ref).referencedBy.add(rel);
    }
    files.push({
      path: rel,
      lines: lineCount,
      language: isTs ? 'ts' : 'js',
      exports: exportsList,
      imports: importsList,
      routeCount: fileRoutes.length,
    });
  }

  for (const absPath of sqlFiles) {
    const text = readFileSync(absPath, 'utf8');
    const rel = relPath(absPath);
    const { defines } = extractSqlReferences(text);
    for (const def of defines) {
      const entry = touchSchema(def.name);
      entry.kind = def.kind;
      entry.definedIn.push(rel);
    }
    files.push({ path: rel, lines: text.split('\n').length, language: 'sql', exports: [], imports: [], routeCount: 0 });
  }

  const schemaOut = [...schema.entries()]
    .map(([name, entry]) => ({
      name,
      kind: entry.kind ?? 'unknown',
      definedIn: entry.definedIn,
      referencedBy: [...entry.referencedBy].sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const anomalies = schemaOut.filter((t) => {
    if (t.definedIn.length === 0) return false; // referenced but never defined here (view of a view, typo, etc. -- still noteworthy but noisy)
    const nonDefiningRefs = t.referencedBy.filter((f) => !t.definedIn.includes(f));
    return nonDefiningRefs.length === 1;
  });

  mkdirSync(OUT_DIR, { recursive: true });

  // Idempotent regen: reuse the previous timestamp when nothing substantive changed, so
  // running this on a whim (as CLAUDE.md asks) doesn't produce a timestamp-only diff every time.
  const payload = { files, routes, schema: schemaOut };
  const payloadText = JSON.stringify(payload);
  const jsonPath = path.join(OUT_DIR, 'index.json');
  let generatedAt = new Date().toISOString();
  let unchanged = false;
  try {
    const previous = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const { generatedAt: previousGeneratedAt, ...previousPayload } = previous;
    if (JSON.stringify(previousPayload) === payloadText) {
      generatedAt = previousGeneratedAt;
      unchanged = true;
    }
  } catch {
    // No previous file, or it didn't parse -- treat as a fresh generation.
  }

  const jsonOut = { generatedAt, ...payload };
  writeFileSync(jsonPath, JSON.stringify(jsonOut, null, 2) + '\n');
  writeFileSync(path.join(OUT_DIR, 'README.md'), renderMarkdown(jsonOut, anomalies));

  console.log(`Mapped ${files.length} files (${tsFiles.length} ts, ${jsFiles.length} js, ${sqlFiles.length} sql), ${routes.length} routes, ${schemaOut.length} schema objects.`);
  console.log(unchanged ? 'No structural changes since the last run.' : `Content changed -- generatedAt updated to ${generatedAt}.`);
  if (anomalies.length) console.log(`${anomalies.length} single-referencer table(s) flagged -- see docs/codebase-map/README.md.`);
}

function renderMarkdown(data, anomalies) {
  const lines = [];
  lines.push('# Codebase Map (generated)');
  lines.push('');
  lines.push(`Generated ${data.generatedAt} by \`tools/generate-codebase-map.mjs\`. Regenerate with:`);
  lines.push('');
  lines.push('```powershell');
  lines.push('npm run map:build');
  lines.push('```');
  lines.push('');
  lines.push('This is a navigational index, not a substitute for reading the file you are about to');
  lines.push('change. It answers "where do I look," and flags structural anomalies worth a second');
  lines.push('look before trusting them. See `CLAUDE.md` and `docs/project-overview.md` for narrative context.');
  lines.push('');

  if (anomalies.length) {
    lines.push('## Anomalies worth checking');
    lines.push('');
    lines.push('A table/view referenced by exactly one non-defining file is a common shape for stale or');
    lines.push('orphaned code paths reading from the wrong schema (this is exactly how the');
    lines.push('`record-query.ts` bug looked before it was fixed -- see `docs/project-overview.md`).');
    lines.push('Not all of these are bugs; verify before assuming.');
    lines.push('');
    for (const table of anomalies) {
      const soleRef = table.referencedBy.find((f) => !table.definedIn.includes(f));
      lines.push(`- **${table.name}** (${table.kind}) — defined in \`${table.definedIn.join('`, `')}\`, only referenced by \`${soleRef}\``);
    }
    lines.push('');
  }

  lines.push('## Files');
  lines.push('');
  lines.push('| File | Lang | Lines | Routes | Exports |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const file of [...data.files].sort((a, b) => a.path.localeCompare(b.path))) {
    const exportsSummary = file.exports.length > 6 ? `${file.exports.slice(0, 6).join(', ')}, +${file.exports.length - 6} more` : file.exports.join(', ');
    lines.push(`| \`${file.path}\` | ${file.language} | ${file.lines} | ${file.routeCount || ''} | ${exportsSummary} |`);
  }
  lines.push('');

  lines.push('## Routes');
  lines.push('');
  lines.push('| Method | Path | Style | File:Line |');
  lines.push('| --- | --- | --- | --- |');
  for (const route of [...data.routes].sort((a, b) => a.path.localeCompare(b.path))) {
    lines.push(`| ${route.method} | \`${route.path}\` | ${route.style}${route.matchKind ? ` (${route.matchKind})` : ''} | \`${route.file}:${route.line}\` |`);
  }
  lines.push('');

  lines.push('## Schema (tables/views -> referencing files)');
  lines.push('');
  lines.push('| Name | Kind | Defined in | Referenced by (excl. definer) |');
  lines.push('| --- | --- | --- | --- |');
  for (const table of data.schema) {
    const externalRefs = table.referencedBy.filter((f) => !table.definedIn.includes(f));
    lines.push(`| ${table.name} | ${table.kind} | \`${table.definedIn.join('`, `') || '(not defined in scanned files)'}\` | ${externalRefs.length ? `\`${externalRefs.join('`, `')}\`` : '(none)'} |`);
  }
  lines.push('');

  return lines.join('\n');
}

main();
