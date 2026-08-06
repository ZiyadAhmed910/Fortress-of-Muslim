# Codebase Map (generated)

Generated 2026-08-06T15:34:52.265Z by `tools/generate-codebase-map.mjs`. Regenerate with:

```powershell
npm run map:build
```

This is a navigational index, not a substitute for reading the file you are about to
change. It answers "where do I look," and flags structural anomalies worth a second
look before trusting them. See `CLAUDE.md` and `docs/project-overview.md` for narrative context.

## Anomalies worth checking

A table/view referenced by exactly one non-defining file is a common shape for stale or
orphaned code paths reading from the wrong schema (this is exactly how the
`record-query.ts` bug looked before it was fixed -- see `docs/project-overview.md`).
Not all of these are bugs; verify before assuming.

- **access_requests** (table) — defined in `apps/auth/migrations/0002_control_plane.sql`, only referenced by `apps/auth/src/admin-plane.ts`
- **apikey** (table) — defined in `apps/auth/migrations/0001_identity.sql`, only referenced by `apps/auth/src/admin-plane.ts`
- **canonical_publication_history** (table) — defined in `apps/api/migrations/0006_canonical_editorial.sql`, only referenced by `apps/auth/src/editorial-plane.ts`
- **content_parts** (table) — defined in `apps/api/migrations/0001_content_schema.sql`, only referenced by `apps/auth/src/editorial-plane.ts`
- **content_records** (table) — defined in `apps/api/migrations/0001_content_schema.sql`, only referenced by `apps/auth/src/editorial-plane.ts`
- **content_segments** (table) — defined in `apps/api/migrations/0001_content_schema.sql`, only referenced by `apps/auth/src/editorial-plane.ts`
- **correction_history** (table) — defined in `apps/api/migrations/0003_canonical_knowledge.sql`, only referenced by `apps/api/src/repositories/d1-content-repository.ts`
- **dataset_versions** (table) — defined in `apps/api/migrations/0001_content_schema.sql`, only referenced by `apps/auth/src/editorial-plane.ts`
- **disagreement_queue** (table) — defined in `apps/api/migrations/0006_canonical_editorial.sql`, only referenced by `apps/auth/src/admin-plane.ts`
- **field_reviews** (table) — defined in `apps/api/migrations/0006_canonical_editorial.sql`, only referenced by `apps/auth/src/editorial-plane.ts`
- **languages** (table) — defined in `apps/api/migrations/0003_canonical_knowledge.sql`, only referenced by `apps/auth/src/admin-plane.ts`
- **mcp_server_registrations** (table) — defined in `apps/auth/migrations/0002_control_plane.sql`, only referenced by `apps/auth/src/index.ts`
- **oauthAccessToken** (table) — defined in `apps/auth/migrations/0001_identity.sql`, only referenced by `apps/auth/src/index.ts`
- **oauthRefreshToken** (table) — defined in `apps/auth/migrations/0001_identity.sql`, only referenced by `apps/auth/src/index.ts`
- **operational_alerts** (table) — defined in `apps/auth/migrations/0009_operational_alerts.sql`, only referenced by `apps/auth/src/admin-plane.ts`
- **publication_batch_items** (table) — defined in `apps/api/migrations/0006_canonical_editorial.sql`, only referenced by `apps/auth/src/editorial-plane.ts`
- **publication_batches** (table) — defined in `apps/api/migrations/0006_canonical_editorial.sql`, only referenced by `apps/auth/src/editorial-plane.ts`
- **rag_daily_usage** (table) — defined in `apps/api/migrations/0005_rag_usage.sql`, only referenced by `apps/api/src/rag.ts`
- **rate_limit_counters** (table) — defined in `apps/auth/migrations/0010_rate_limits.sql`, only referenced by `apps/auth/src/index.ts`
- **record_placements** (table) — defined in `apps/api/migrations/0003_canonical_knowledge.sql`, only referenced by `apps/auth/src/editorial-plane.ts`
- **session** (table) — defined in `apps/auth/migrations/0001_identity.sql`, only referenced by `apps/auth/src/admin-plane.ts`

## Files

| File | Lang | Lines | Routes | Exports |
| --- | --- | --- | --- | --- |
| `apps/admin/public/app.js` | js | 1270 |  |  |
| `apps/api/migrations/0001_content_schema.sql` | sql | 62 |  |  |
| `apps/api/migrations/0002_import_legacy_dataset.sql` | sql | 1566 |  |  |
| `apps/api/migrations/0003_canonical_knowledge.sql` | sql | 305 |  |  |
| `apps/api/migrations/0004_corpus_ingestion.sql` | sql | 45 |  |  |
| `apps/api/migrations/0005_rag_usage.sql` | sql | 10 |  |  |
| `apps/api/migrations/0006_canonical_editorial.sql` | sql | 427 |  |  |
| `apps/api/migrations/0007_rag_index_state.sql` | sql | 20 |  |  |
| `apps/api/migrations/0008_publication_snapshots.sql` | sql | 15 |  |  |
| `apps/api/migrations/0009_single_verification.sql` | sql | 28 |  |  |
| `apps/api/migrations/0010_api_content_visibility.sql` | sql | 32 |  |  |
| `apps/api/migrations/0011_public_read_indexes.sql` | sql | 12 |  |  |
| `apps/api/migrations/0012_normalize_single_verification_states.sql` | sql | 5 |  |  |
| `apps/api/migrations/0013_verify_and_publish_hisn.sql` | sql | 152 |  |  |
| `apps/api/migrations/0014_book_editorial_and_manual_records.sql` | sql | 31 |  |  |
| `apps/api/src/app.ts` | ts | 615 | 26 | function createApp, const app |
| `apps/api/src/index.ts` | ts | 51 |  | class ApiWorker |
| `apps/api/src/lib/fuzzy-title.ts` | ts | 75 |  | type TitleCandidate, type RankedTitle, function rankDuaTitles |
| `apps/api/src/lib/pagination.ts` | ts | 15 |  | function encodeCursor, function decodeCursor |
| `apps/api/src/lib/record-query.ts` | ts | 58 |  | type RecordQueryDefinition, function executeRecordQuery |
| `apps/api/src/rag.ts` | ts | 455 |  | type RagSource, function indexRecordBatch, function indexNextPendingBatch, function getRagStatus, function answerQuestion, class RagRateLimitError |
| `apps/api/src/repositories/content-repository.ts` | ts | 57 |  | type DatasetSummary, type DuaTitleMatch, type RagRecordMatch, type RecordEvidence, interface ContentRepository |
| `apps/api/src/repositories/d1-content-repository.ts` | ts | 583 |  | class D1ContentRepository |
| `apps/api/src/types.ts` | ts | 70 |  | type Bindings, type ApiVariables |
| `apps/api/test/api.test.ts` | ts | 589 |  |  |
| `apps/api/test/fuzzy-title.test.ts` | ts | 30 |  |  |
| `apps/api/test/rag-index.test.ts` | ts | 62 |  |  |
| `apps/api/test/rag-quality.test.ts` | ts | 77 |  |  |
| `apps/api/test/record-query.test.ts` | ts | 27 |  |  |
| `apps/auth/auth.config.ts` | ts | 19 |  | const auth, default export |
| `apps/auth/migrations/0001_identity.sql` | sql | 81 |  |  |
| `apps/auth/migrations/0002_control_plane.sql` | sql | 89 |  |  |
| `apps/auth/migrations/0003_developer_console.sql` | sql | 51 |  |  |
| `apps/auth/migrations/0004_admin_console.sql` | sql | 34 |  |  |
| `apps/auth/migrations/0005_query_and_mcp_toolsets.sql` | sql | 43 |  |  |
| `apps/auth/migrations/0006_editorial_roles.sql` | sql | 19 |  |  |
| `apps/auth/migrations/0007_platform_roles.sql` | sql | 67 |  |  |
| `apps/auth/migrations/0008_account_security.sql` | sql | 34 |  |  |
| `apps/auth/migrations/0009_operational_alerts.sql` | sql | 21 |  |  |
| `apps/auth/migrations/0010_rate_limits.sql` | sql | 26 |  |  |
| `apps/auth/src/admin-plane.ts` | ts | 802 | 22 | function requiresMfaEnrollment, function handleAdminPlane |
| `apps/auth/src/auth.ts` | ts | 114 |  | const FORTRESS_SCOPES, function createAuth |
| `apps/auth/src/editorial-plane.ts` | ts | 2131 | 29 | type EditorialRole, function handleEditorialPlane, class EditorialForbiddenError |
| `apps/auth/src/index.ts` | ts | 705 | 20 | class AuthWorker |
| `apps/auth/src/security.ts` | ts | 33 |  | function isMutation, function isTrustedBrowserMutation, function hasOversizedBody |
| `apps/auth/src/types.ts` | ts | 78 |  | type AuthEnvironment, type Bindings, type ServiceState, type McpToolDefinition, type KeyVerification, type TokenVerification, +2 more |
| `apps/auth/test/admin-mfa-gate.test.ts` | ts | 29 |  |  |
| `apps/auth/test/editorial-pilot.test.ts` | ts | 364 |  |  |
| `apps/auth/test/security.test.ts` | ts | 43 |  |  |
| `apps/developers/public/app.js` | js | 63 |  |  |
| `apps/developers/public/console.js` | js | 528 |  |  |
| `apps/developers/public/device.js` | js | 6 |  |  |
| `apps/developers/public/oauth.js` | js | 104 |  |  |
| `apps/mcp/src/index.ts` | ts | 74 | 2 | default export |
| `apps/status/public/app.js` | js | 131 |  |  |
| `packages/contracts/src/index.ts` | ts | 130 |  | const API_VERSION, const PLATFORM_NAME, const PLATFORM_VERSION, const CURRENT_DATASET_ID, const contentSegmentSchema, const editorialWorkflowStateSchema, +25 more |
| `packages/portal-ui/assets/portal.js` | js | 42 |  |  |
| `pwa-website/js/app.js` | js | 142 |  |  |
| `pwa-website/js/assistant.js` | js | 38 |  |  |
| `pwa-website/js/categories.js` | js | 144 |  |  |
| `pwa-website/js/constants.js` | js | 4 |  |  |
| `pwa-website/js/data.js` | js | 13 |  |  |
| `pwa-website/js/dom.js` | js | 60 |  |  |
| `pwa-website/js/filters.js` | js | 25 |  |  |
| `pwa-website/js/hadith.js` | js | 153 |  |  |
| `pwa-website/js/home.js` | js | 177 |  |  |
| `pwa-website/js/modes.js` | js | 34 |  |  |
| `pwa-website/js/online.js` | js | 21 |  |  |
| `pwa-website/js/pwa.js` | js | 101 |  |  |
| `pwa-website/js/reader.js` | js | 129 |  |  |
| `pwa-website/js/routes.js` | js | 29 |  |  |
| `pwa-website/js/settings.js` | js | 32 |  |  |
| `pwa-website/js/state.js` | js | 22 |  |  |
| `pwa-website/js/userData.js` | js | 74 |  |  |
| `pwa-website/js/utils.js` | js | 23 |  |  |
| `pwa-website/sw.js` | js | 99 |  |  |

## Routes

| Method | Path | Style | File:Line |
| --- | --- | --- | --- |
| (any) | `` | manual (pattern) | `apps/auth/src/admin-plane.ts:164` |
| USE | `*` | hono | `apps/api/src/app.ts:33` |
| USE | `*` | hono | `apps/api/src/app.ts:39` |
| GET | `/` | hono | `apps/api/src/app.ts:140` |
| (any) | `/.well-known/oauth-protected-resource` | manual (exact) | `apps/mcp/src/index.ts:38` |
| (any) | `/^\/v1\/admin\/alerts\/([^/]+` | manual (pattern) | `apps/auth/src/admin-plane.ts:172` |
| (any) | `/^\/v1\/admin\/editorial\/assignments\/([^/]+` | manual (pattern) | `apps/auth/src/editorial-plane.ts:58` |
| (any) | `/^\/v1\/admin\/editorial\/batches\/([^/]+` | manual (pattern) | `apps/auth/src/editorial-plane.ts:140` |
| (any) | `/^\/v1\/admin\/editorial\/batches\/([^/]+` | manual (pattern) | `apps/auth/src/editorial-plane.ts:149` |
| (any) | `/^\/v1\/admin\/editorial\/batches\/([^/]+` | manual (pattern) | `apps/auth/src/editorial-plane.ts:153` |
| (any) | `/^\/v1\/admin\/editorial\/books\/([^/]+` | manual (pattern) | `apps/auth/src/editorial-plane.ts:82` |
| (any) | `/^\/v1\/admin\/editorial\/datasets\/([^/]+` | manual (pattern) | `apps/auth/src/editorial-plane.ts:166` |
| (any) | `/^\/v1\/admin\/editorial\/records\/([^/]+` | manual (pattern) | `apps/auth/src/editorial-plane.ts:92` |
| (any) | `/^\/v1\/admin\/editorial\/records\/([^/]+` | manual (pattern) | `apps/auth/src/editorial-plane.ts:96` |
| (any) | `/^\/v1\/admin\/editorial\/records\/([^/]+` | manual (pattern) | `apps/auth/src/editorial-plane.ts:100` |
| (any) | `/^\/v1\/admin\/editorial\/records\/([^/]+` | manual (pattern) | `apps/auth/src/editorial-plane.ts:108` |
| (any) | `/^\/v1\/admin\/editorial\/records\/([^/]+` | manual (pattern) | `apps/auth/src/editorial-plane.ts:113` |
| (any) | `/^\/v1\/admin\/editorial\/records\/([^/]+` | manual (pattern) | `apps/auth/src/editorial-plane.ts:118` |
| (any) | `/^\/v1\/admin\/editorial\/records\/([^/]+` | manual (pattern) | `apps/auth/src/editorial-plane.ts:122` |
| (any) | `/^\/v1\/admin\/rate-limits\/([a-z-]+` | manual (pattern) | `apps/auth/src/admin-plane.ts:158` |
| (any) | `/^\/v1\/admin\/services\/([a-z-]+` | manual (pattern) | `apps/auth/src/admin-plane.ts:152` |
| (any) | `/^\/v1\/admin\/sessions\/([^/]+` | manual (pattern) | `apps/auth/src/admin-plane.ts:147` |
| (any) | `/^\/v1\/admin\/users\/([^/]+` | manual (pattern) | `apps/auth/src/admin-plane.ts:140` |
| (any) | `/^\/v1\/control\/devices\/([^/]+` | manual (pattern) | `apps/auth/src/index.ts:172` |
| (any) | `/^\/v1\/control\/mcp\/toolsets\/([^/]+` | manual (pattern) | `apps/auth/src/index.ts:269` |
| (any) | `/^\/v1\/control\/mcp\/toolsets\/([^/]+` | manual (pattern) | `apps/auth/src/index.ts:283` |
| (any) | `/^\/v1\/control\/mcp\/toolsets\/([^/]+` | manual (pattern) | `apps/auth/src/index.ts:298` |
| (any) | `/^\/v1\/control\/named-queries\/([^/]+` | manual (pattern) | `apps/auth/src/index.ts:233` |
| (any) | `/^\/v1\/control\/oauth-clients\/([^/]+` | manual (pattern) | `apps/auth/src/index.ts:181` |
| GET | `/health` | hono | `apps/api/src/app.ts:149` |
| (any) | `/health` | manual (exact) | `apps/auth/src/index.ts:51` |
| (any) | `/health` | manual (exact) | `apps/mcp/src/index.ts:37` |
| GET | `/health/database` | hono | `apps/api/src/app.ts:157` |
| GET | `/v1` | hono | `apps/api/src/app.ts:195` |
| USE | `/v1/*` | hono | `apps/api/src/app.ts:138` |
| USE | `/v1/*` | hono | `apps/api/src/app.ts:170` |
| (any) | `/v1/admin/` | manual (prefix) | `apps/auth/src/index.ts:67` |
| (any) | `/v1/admin/` | manual (prefix) | `apps/auth/src/index.ts:78` |
| (any) | `/v1/admin/` | manual (prefix) | `apps/auth/src/index.ts:81` |
| GET | `/v1/admin/alerts` | manual (exact) | `apps/auth/src/admin-plane.ts:137` |
| GET | `/v1/admin/audit` | manual (exact) | `apps/auth/src/admin-plane.ts:136` |
| (any) | `/v1/admin/content` | manual (prefix) | `apps/auth/src/admin-plane.ts:119` |
| (any) | `/v1/admin/editorial` | manual (prefix) | `apps/auth/src/editorial-plane.ts:23` |
| GET | `/v1/admin/editorial/assignments` | manual (exact) | `apps/auth/src/editorial-plane.ts:51` |
| POST | `/v1/admin/editorial/assignments` | manual (exact) | `apps/auth/src/editorial-plane.ts:54` |
| GET | `/v1/admin/editorial/batches` | manual (exact) | `apps/auth/src/editorial-plane.ts:66` |
| POST | `/v1/admin/editorial/batches` | manual (exact) | `apps/auth/src/editorial-plane.ts:69` |
| GET | `/v1/admin/editorial/books` | manual (exact) | `apps/auth/src/editorial-plane.ts:48` |
| GET | `/v1/admin/editorial/datasets` | manual (exact) | `apps/auth/src/editorial-plane.ts:163` |
| GET | `/v1/admin/editorial/lookups` | manual (exact) | `apps/auth/src/editorial-plane.ts:37` |
| GET | `/v1/admin/editorial/overview` | manual (exact) | `apps/auth/src/editorial-plane.ts:25` |
| GET | `/v1/admin/editorial/queue` | manual (exact) | `apps/auth/src/editorial-plane.ts:34` |
| GET | `/v1/admin/editorial/rag` | manual (exact) | `apps/auth/src/editorial-plane.ts:28` |
| POST | `/v1/admin/editorial/records` | manual (exact) | `apps/auth/src/editorial-plane.ts:40` |
| POST | `/v1/admin/editorial/records/bulk-decision` | manual (exact) | `apps/auth/src/editorial-plane.ts:44` |
| GET | `/v1/admin/editorial/roles` | manual (exact) | `apps/auth/src/editorial-plane.ts:73` |
| PATCH | `/v1/admin/editorial/roles` | manual (exact) | `apps/auth/src/editorial-plane.ts:77` |
| GET | `/v1/admin/editorial/workload` | manual (exact) | `apps/auth/src/editorial-plane.ts:31` |
| GET | `/v1/admin/operations` | manual (exact) | `apps/auth/src/admin-plane.ts:125` |
| GET | `/v1/admin/overview` | manual (exact) | `apps/auth/src/admin-plane.ts:124` |
| GET | `/v1/admin/rate-limits` | manual (exact) | `apps/auth/src/admin-plane.ts:138` |
| (any) | `/v1/admin/references` | manual (prefix) | `apps/auth/src/admin-plane.ts:118` |
| GET | `/v1/admin/resources` | manual (exact) | `apps/auth/src/admin-plane.ts:129` |
| GET | `/v1/admin/search` | manual (exact) | `apps/auth/src/admin-plane.ts:127` |
| GET | `/v1/admin/services` | manual (exact) | `apps/auth/src/admin-plane.ts:135` |
| GET | `/v1/admin/session` | manual (exact) | `apps/auth/src/admin-plane.ts:80` |
| GET | `/v1/admin/sessions` | manual (exact) | `apps/auth/src/admin-plane.ts:126` |
| (any) | `/v1/admin/sources` | manual (prefix) | `apps/auth/src/admin-plane.ts:117` |
| GET | `/v1/admin/taxonomy` | manual (exact) | `apps/auth/src/admin-plane.ts:130` |
| POST | `/v1/admin/taxonomy` | manual (exact) | `apps/auth/src/admin-plane.ts:131` |
| GET | `/v1/admin/users` | manual (exact) | `apps/auth/src/admin-plane.ts:128` |
| POST | `/v1/ask` | hono | `apps/api/src/app.ts:442` |
| GET | `/v1/ask/status` | hono | `apps/api/src/app.ts:463` |
| GET | `/v1/collections` | hono | `apps/api/src/app.ts:229` |
| GET | `/v1/control/devices` | manual (exact) | `apps/auth/src/index.ts:138` |
| POST | `/v1/control/devices` | manual (exact) | `apps/auth/src/index.ts:148` |
| GET | `/v1/control/mcp-servers` | manual (exact) | `apps/auth/src/index.ts:107` |
| POST | `/v1/control/mcp-servers` | manual (exact) | `apps/auth/src/index.ts:117` |
| GET | `/v1/control/mcp/catalog` | manual (exact) | `apps/auth/src/index.ts:247` |
| GET | `/v1/control/mcp/toolsets` | manual (exact) | `apps/auth/src/index.ts:249` |
| POST | `/v1/control/mcp/toolsets` | manual (exact) | `apps/auth/src/index.ts:261` |
| GET | `/v1/control/named-queries` | manual (exact) | `apps/auth/src/index.ts:207` |
| POST | `/v1/control/named-queries` | manual (exact) | `apps/auth/src/index.ts:219` |
| GET | `/v1/control/profile` | manual (exact) | `apps/auth/src/index.ts:100` |
| GET | `/v1/datasets/current` | hono | `apps/api/src/app.ts:214` |
| GET | `/v1/duas` | hono | `apps/api/src/app.ts:239` |
| GET | `/v1/duas/:id` | hono | `apps/api/src/app.ts:368` |
| GET | `/v1/duas/:id/evidence` | hono | `apps/api/src/app.ts:319` |
| GET | `/v1/duas/:id/parts` | hono | `apps/api/src/app.ts:325` |
| GET | `/v1/duas/:id/parts/:position` | hono | `apps/api/src/app.ts:339` |
| GET | `/v1/duas/random` | hono | `apps/api/src/app.ts:303` |
| GET | `/v1/duas/search` | hono | `apps/api/src/app.ts:272` |
| GET | `/v1/hadith` | hono | `apps/api/src/app.ts:383` |
| GET | `/v1/hadith/:id` | hono | `apps/api/src/app.ts:436` |
| GET | `/v1/hadith/resolve` | hono | `apps/api/src/app.ts:418` |
| GET | `/v1/hadith/search` | hono | `apps/api/src/app.ts:400` |
| POST | `/v1/internal/vector-index` | hono | `apps/api/src/app.ts:469` |
| GET | `/v1/queries/:id` | hono | `apps/api/src/app.ts:480` |
| USE | `/v1/queries/*` | hono | `apps/api/src/app.ts:107` |

## Schema (tables/views -> referencing files)

| Name | Kind | Defined in | Referenced by (excl. definer) |
| --- | --- | --- | --- |
| a | unknown | `(not defined in scanned files)` | `apps/admin/public/app.js`, `apps/auth/src/index.ts` |
| access_requests | table | `apps/auth/migrations/0002_control_plane.sql` | `apps/auth/src/admin-plane.ts` |
| account | table | `apps/auth/migrations/0001_identity.sql` | (none) |
| any | unknown | `(not defined in scanned files)` | `apps/admin/public/app.js` |
| api_current_content | view | `apps/api/migrations/0010_api_content_visibility.sql`, `apps/api/migrations/0013_verify_and_publish_hisn.sql` | `apps/api/src/lib/record-query.ts`, `apps/api/src/repositories/d1-content-repository.ts` |
| api_published_content | view | `apps/api/migrations/0010_api_content_visibility.sql`, `apps/api/migrations/0013_verify_and_publish_hisn.sql` | (none) |
| apikey | table | `apps/auth/migrations/0001_identity.sql` | `apps/auth/src/admin-plane.ts` |
| audit_events | table | `apps/auth/test/editorial-pilot.test.ts`, `apps/auth/migrations/0002_control_plane.sql` | `apps/auth/src/admin-plane.ts`, `apps/auth/src/editorial-plane.ts`, `apps/auth/src/index.ts` |
| books | table | `apps/api/migrations/0003_canonical_knowledge.sql` | `apps/api/src/repositories/d1-content-repository.ts`, `apps/auth/src/editorial-plane.ts`, `apps/auth/test/editorial-pilot.test.ts` |
| canonical_dataset_items | table | `apps/api/migrations/0008_publication_snapshots.sql` | `apps/api/src/rag.ts`, `apps/auth/src/editorial-plane.ts`, `apps/auth/test/editorial-pilot.test.ts` |
| canonical_dataset_versions | table | `apps/api/migrations/0006_canonical_editorial.sql` | `apps/api/src/rag.ts`, `apps/api/src/repositories/d1-content-repository.ts`, `apps/auth/src/editorial-plane.ts` |
| canonical_publication_history | table | `apps/api/migrations/0006_canonical_editorial.sql` | `apps/auth/src/editorial-plane.ts` |
| canonical_publications | table | `apps/api/migrations/0006_canonical_editorial.sql` | `apps/api/src/rag.ts`, `apps/api/src/repositories/d1-content-repository.ts`, `apps/api/test/rag-index.test.ts`, `apps/auth/src/admin-plane.ts`, `apps/auth/src/editorial-plane.ts` |
| canonical_records | table | `apps/api/migrations/0006_canonical_editorial.sql` | `apps/api/src/lib/record-query.ts`, `apps/api/src/rag.ts`, `apps/api/src/repositories/d1-content-repository.ts`, `apps/auth/src/admin-plane.ts`, `apps/auth/src/editorial-plane.ts` |
| canonical_references | table | `apps/api/migrations/0006_canonical_editorial.sql` | `apps/api/src/repositories/d1-content-repository.ts`, `apps/auth/src/editorial-plane.ts`, `apps/auth/test/editorial-pilot.test.ts` |
| canonical_search_fts | virtual_table | `apps/auth/test/editorial-pilot.test.ts`, `apps/auth/test/editorial-pilot.test.ts`, `apps/api/migrations/0006_canonical_editorial.sql` | `apps/api/src/repositories/d1-content-repository.ts`, `apps/auth/src/editorial-plane.ts` |
| chapters | table | `apps/api/migrations/0003_canonical_knowledge.sql` | `apps/api/src/repositories/d1-content-repository.ts`, `apps/auth/src/editorial-plane.ts`, `apps/auth/test/editorial-pilot.test.ts` |
| collections | table | `apps/api/migrations/0003_canonical_knowledge.sql` | `apps/api/src/rag.ts`, `apps/api/src/repositories/d1-content-repository.ts`, `apps/auth/src/editorial-plane.ts`, `apps/auth/test/editorial-pilot.test.ts` |
| content_audit_events | table | `apps/api/migrations/0003_canonical_knowledge.sql` | `apps/auth/src/admin-plane.ts`, `apps/auth/src/editorial-plane.ts`, `apps/auth/test/editorial-pilot.test.ts` |
| content_parts | table | `apps/api/migrations/0001_content_schema.sql` | `apps/auth/src/editorial-plane.ts` |
| content_records | table | `apps/api/migrations/0001_content_schema.sql` | `apps/auth/src/editorial-plane.ts` |
| content_revisions | table | `apps/api/migrations/0006_canonical_editorial.sql` | `apps/api/src/lib/record-query.ts`, `apps/api/src/rag.ts`, `apps/api/src/repositories/d1-content-repository.ts`, `apps/auth/src/admin-plane.ts`, `apps/auth/src/editorial-plane.ts` |
| content_search_fts | virtual_table | `apps/auth/test/editorial-pilot.test.ts`, `apps/auth/test/editorial-pilot.test.ts`, `apps/api/migrations/0004_corpus_ingestion.sql` | (none) |
| content_segments | table | `apps/api/migrations/0001_content_schema.sql` | `apps/auth/src/editorial-plane.ts` |
| contributors | table | `apps/api/migrations/0003_canonical_knowledge.sql` | (none) |
| correction_history | table | `apps/api/migrations/0003_canonical_knowledge.sql` | `apps/api/src/repositories/d1-content-repository.ts` |
| cross_references | table | `apps/api/migrations/0003_canonical_knowledge.sql` | (none) |
| dataset_sources | table | `apps/api/migrations/0003_canonical_knowledge.sql` | (none) |
| dataset_versions | table | `apps/api/migrations/0001_content_schema.sql` | `apps/auth/src/editorial-plane.ts` |
| developer_profiles | table | `apps/auth/migrations/0002_control_plane.sql` | `apps/auth/src/admin-plane.ts`, `apps/auth/src/index.ts` |
| device_registrations | table | `apps/auth/migrations/0003_developer_console.sql` | `apps/auth/src/admin-plane.ts`, `apps/auth/src/index.ts` |
| deviceCode | table | `apps/auth/migrations/0003_developer_console.sql` | (none) |
| disagreement_queue | table | `apps/api/migrations/0006_canonical_editorial.sql` | `apps/auth/src/admin-plane.ts` |
| dua_metadata | table | `apps/api/migrations/0003_canonical_knowledge.sql` | (none) |
| editorial_assignments | table | `apps/api/migrations/0006_canonical_editorial.sql` | `apps/auth/src/editorial-plane.ts`, `apps/auth/test/editorial-pilot.test.ts` |
| editorial_record_state | table | `apps/api/migrations/0006_canonical_editorial.sql` | `apps/auth/src/admin-plane.ts`, `apps/auth/src/editorial-plane.ts`, `apps/auth/test/editorial-pilot.test.ts` |
| editorial_role_grants | table | `apps/auth/migrations/0006_editorial_roles.sql` | (none) |
| every | unknown | `(not defined in scanned files)` | `apps/auth/test/admin-mfa-gate.test.ts` |
| field_reviews | table | `apps/api/migrations/0006_canonical_editorial.sql` | `apps/auth/src/editorial-plane.ts` |
| hadith_grades | table | `apps/api/migrations/0004_corpus_ingestion.sql` | (none) |
| hadith_metadata | table | `apps/api/migrations/0003_canonical_knowledge.sql` | (none) |
| invitation | table | `apps/auth/migrations/0001_identity.sql` | (none) |
| its | unknown | `(not defined in scanned files)` | `apps/auth/src/admin-plane.ts` |
| jwks | table | `apps/auth/migrations/0001_identity.sql` | (none) |
| languages | table | `apps/api/migrations/0003_canonical_knowledge.sql` | `apps/auth/src/admin-plane.ts` |
| mcp_server_registrations | table | `apps/auth/migrations/0002_control_plane.sql` | `apps/auth/src/index.ts` |
| mcp_tool_definitions | table | `apps/auth/migrations/0002_control_plane.sql` | (none) |
| mcp_toolset_tools | table | `apps/auth/migrations/0005_query_and_mcp_toolsets.sql` | `apps/auth/src/admin-plane.ts`, `apps/auth/src/index.ts` |
| mcp_toolsets | table | `apps/auth/migrations/0005_query_and_mcp_toolsets.sql` | `apps/auth/src/admin-plane.ts`, `apps/auth/src/index.ts` |
| member | table | `apps/auth/migrations/0001_identity.sql` | (none) |
| named_queries | table | `apps/auth/migrations/0003_developer_console.sql` | `apps/auth/src/admin-plane.ts`, `apps/auth/src/index.ts` |
| natural | unknown | `(not defined in scanned files)` | `apps/api/test/fuzzy-title.test.ts` |
| oauthAccessToken | table | `apps/auth/migrations/0001_identity.sql` | `apps/auth/src/index.ts` |
| oauthClient | table | `apps/auth/migrations/0001_identity.sql` | `apps/auth/src/admin-plane.ts`, `apps/auth/src/auth.ts`, `apps/auth/src/index.ts` |
| oauthClientAssertion | table | `apps/auth/migrations/0001_identity.sql` | (none) |
| oauthClientResource | table | `apps/auth/migrations/0001_identity.sql` | (none) |
| oauthConsent | table | `apps/auth/migrations/0001_identity.sql` | (none) |
| oauthRefreshToken | table | `apps/auth/migrations/0001_identity.sql` | `apps/auth/src/index.ts` |
| oauthResource | table | `apps/auth/migrations/0001_identity.sql` | (none) |
| operational_alerts | table | `apps/auth/migrations/0009_operational_alerts.sql` | `apps/auth/src/admin-plane.ts` |
| organization | table | `apps/auth/migrations/0001_identity.sql` | (none) |
| passkey | table | `apps/auth/migrations/0008_account_security.sql` | (none) |
| plan_limits | table | `apps/auth/migrations/0010_rate_limits.sql` | `apps/auth/src/admin-plane.ts`, `apps/auth/src/index.ts` |
| platform | unknown | `(not defined in scanned files)` | `apps/admin/public/app.js` |
| platform_admins | table | `apps/auth/migrations/0004_admin_console.sql` | (none) |
| platform_role_grants | table | `apps/auth/test/editorial-pilot.test.ts`, `apps/auth/migrations/0007_platform_roles.sql` | `apps/auth/src/admin-plane.ts`, `apps/auth/src/editorial-plane.ts`, `apps/auth/src/index.ts` |
| platform_services | table | `apps/auth/migrations/0004_admin_console.sql` | `apps/auth/src/admin-plane.ts`, `apps/auth/src/index.ts` |
| publication_batch_items | table | `apps/api/migrations/0006_canonical_editorial.sql` | `apps/auth/src/editorial-plane.ts` |
| publication_batches | table | `apps/api/migrations/0006_canonical_editorial.sql` | `apps/auth/src/editorial-plane.ts` |
| publication_history | table | `apps/api/migrations/0003_canonical_knowledge.sql` | (none) |
| rag_daily_usage | table | `apps/api/migrations/0005_rag_usage.sql` | `apps/api/src/rag.ts` |
| rag_index_state | table | `apps/api/migrations/0007_rag_index_state.sql` | `apps/api/src/rag.ts`, `apps/auth/src/admin-plane.ts`, `apps/auth/src/editorial-plane.ts`, `apps/auth/test/editorial-pilot.test.ts` |
| rate_limit_counters | table | `apps/auth/migrations/0010_rate_limits.sql` | `apps/auth/src/index.ts` |
| record_numberings | table | `apps/api/migrations/0004_corpus_ingestion.sql` | (none) |
| record_placements | table | `apps/api/migrations/0003_canonical_knowledge.sql` | `apps/auth/src/editorial-plane.ts` |
| record_search_metadata | table | `apps/api/migrations/0003_canonical_knowledge.sql` | (none) |
| record_taxonomy | table | `apps/api/migrations/0003_canonical_knowledge.sql` | `apps/api/src/repositories/d1-content-repository.ts`, `apps/auth/src/admin-plane.ts` |
| review_decisions | table | `apps/api/migrations/0006_canonical_editorial.sql` | `apps/api/src/repositories/d1-content-repository.ts`, `apps/auth/src/editorial-plane.ts`, `apps/auth/test/editorial-pilot.test.ts` |
| revision_metadata | table | `apps/api/migrations/0006_canonical_editorial.sql` | `apps/api/src/rag.ts`, `apps/api/src/repositories/d1-content-repository.ts`, `apps/auth/src/editorial-plane.ts` |
| revision_parts | table | `apps/api/migrations/0006_canonical_editorial.sql` | `apps/api/src/lib/record-query.ts`, `apps/api/src/rag.ts`, `apps/api/src/repositories/d1-content-repository.ts`, `apps/auth/src/editorial-plane.ts` |
| revision_segments | table | `apps/api/migrations/0006_canonical_editorial.sql` | `apps/api/src/rag.ts`, `apps/api/src/repositories/d1-content-repository.ts`, `apps/auth/src/editorial-plane.ts` |
| segment_translations | table | `apps/api/migrations/0003_canonical_knowledge.sql` | (none) |
| session | table | `apps/auth/migrations/0001_identity.sql` | `apps/auth/src/admin-plane.ts` |
| SET | unknown | `(not defined in scanned files)` | `apps/api/src/rag.ts`, `apps/auth/src/admin-plane.ts`, `apps/auth/src/editorial-plane.ts`, `apps/auth/src/index.ts` |
| source_materials | table | `apps/api/migrations/0003_canonical_knowledge.sql` | (none) |
| source_references | table | `apps/api/migrations/0003_canonical_knowledge.sql` | (none) |
| taxonomy_terms | table | `apps/api/migrations/0003_canonical_knowledge.sql` | `apps/api/src/repositories/d1-content-repository.ts`, `apps/auth/src/admin-plane.ts` |
| the | unknown | `(not defined in scanned files)` | `apps/admin/public/app.js`, `apps/api/src/rag.ts`, `apps/auth/src/admin-plane.ts`, `apps/auth/test/editorial-pilot.test.ts`, `apps/status/public/app.js`, `pwa-website/js/app.js` |
| this | unknown | `(not defined in scanned files)` | `apps/auth/src/editorial-plane.ts`, `apps/status/public/app.js` |
| travel | unknown | `(not defined in scanned files)` | `apps/api/test/fuzzy-title.test.ts` |
| twoFactor | table | `apps/auth/migrations/0008_account_security.sql` | (none) |
| usage_events | table | `apps/auth/migrations/0002_control_plane.sql` | `apps/auth/src/admin-plane.ts`, `apps/auth/src/index.ts` |
| user | table | `apps/auth/test/editorial-pilot.test.ts`, `apps/auth/migrations/0001_identity.sql` | `apps/auth/src/admin-plane.ts`, `apps/auth/src/editorial-plane.ts` |
| vector | unknown | `(not defined in scanned files)` | `apps/api/test/api.test.ts` |
| verification | table | `apps/auth/migrations/0001_identity.sql` | (none) |
| verification_records | table | `apps/api/migrations/0003_canonical_knowledge.sql` | (none) |
