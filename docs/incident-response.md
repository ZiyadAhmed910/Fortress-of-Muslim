# Fortress Platform Incident Response

This runbook covers availability, authentication, data integrity, abusive traffic, and failed deployments. It applies to test and production.

## First Response

1. Record the start time, affected host, symptoms, and a correlation or `X-Request-ID`.
2. Open Admin Console > Operations Monitor. Check errors, latency, rate limits, queues, active sessions, and service state.
3. Limit the blast radius. Put an affected Worker-enforced service into maintenance; do not disable the Admin Console.
4. Preserve evidence. Export both D1 databases and retain Cloudflare Worker logs before changing data.
5. Revoke compromised sessions, API keys, OAuth clients, or devices from Admin Console.

## Backup

**Scheduled**: `.github/workflows/scheduled-backup.yml` runs `backup-d1.ps1` for both environments daily and uploads the encrypted result to the `fortress-platform-backups` R2 bucket, with a 30-day (adjustable) lifecycle-rule retention policy. See `docs/cloudflare-setup.md` step 9 for one-time setup (bucket, token permission, `FORTRESS_BACKUP_KEY` secret). It runs behind the same `CLOUDFLARE_DEPLOY_ENABLED` switch as every other deployment job.

**Manual / ad hoc**: create a local export outside Git:

```powershell
$env:FORTRESS_BACKUP_KEY = '<the same key from the FORTRESS_BACKUP_KEY secret, or a separate one for manual exports>'
.\tools\backup-d1.ps1 -Environment test
.\tools\backup-d1.ps1 -Environment production
```

Each run captures exact D1 Time Travel bookmarks, exports the identity database, and exports all durable content application tables. FTS5 virtual and shadow tables are intentionally excluded because Cloudflare cannot export a database containing virtual tables; search indexes are derived data and must be rebuilt from canonical records after disaster recovery (`tools/rebuild-fts.ps1`). The manifest records the export mode, Git commit, bookmarks, and SHA-256 checksums (of the encrypted file, when a key is provided) and whether the export was actually encrypted. `.fortress-backups/` is intentionally ignored by Git.

`-EncryptionKeyBase64` (or `$env:FORTRESS_BACKUP_KEY`) is optional but strongly recommended: without it, the export is written as **plain, unencrypted SQL** — the script warns loudly when this happens rather than silently claiming a guarantee it isn't providing. When a key is given, the plaintext export is deleted immediately after encryption; only the `.sql.enc` file (AES-256-CBC + a separate HMAC-SHA256 integrity tag, streamed so it handles the full-size content export without loading it into memory) ever touches disk. Generate a key with `. tools/lib/backup-crypto.ps1; New-FortressBackupKey`, and decrypt with `tools\decrypt-backup.ps1` — it verifies the integrity tag before writing any plaintext and refuses to decrypt on a mismatch (wrong key, corruption, or tampering all fail the same documented way, on purpose).

The default per-database export timeout is 30 minutes and can be changed with `-ExportTimeoutMinutes`. A timed-out export is terminated, its incomplete file is removed, and no manifest is produced.

## Restore

Always restore test first and run the full soak. Active databases are restored only through D1 Time Travel, which preserves FTS5 and database internals. The script records the current bookmark before rollback so the rollback itself can be reversed.

```powershell
.\tools\restore-d1.ps1 -Database content -Environment test -Bookmark <manifest-bookmark>
.\tools\restore-d1.ps1 -Database identity -Environment production -Timestamp 2026-07-23T12:00:00Z -ProductionApproval RESTORE-PRODUCTION
```

Never restore identity and content databases from unrelated timestamps without documenting why. Time Travel is retained by Cloudflare for a limited window (this is why the scheduled R2 backups exist -- for recovery beyond that window, or if Time Travel itself is unavailable). SQL exports are durable disaster-recovery artifacts and must be imported into a new replacement database, verified, have search indexes rebuilt, and then be rebound; they are never executed over an active database by this script.

Restoring from a scheduled R2 backup instead of Time Travel: download and decrypt it first.

```powershell
npx wrangler r2 object get fortress-platform-backups/<file>.sql.enc --file .fortress-backups/<file>.sql.enc --remote
.\tools\decrypt-backup.ps1 -InputPath .fortress-backups\<file>.sql.enc
```

`decrypt-backup.ps1` verifies the integrity tag before writing anything and throws on any mismatch -- treat that as a real incident (wrong key, corrupted upload, or tampering), not a retry-and-move-on situation.

After importing a SQL export into a replacement content database, rebuild `canonical_search_fts` before returning the database to active traffic:

```powershell
.\tools\rebuild-fts.ps1 -Environment test
.\tools\rebuild-fts.ps1 -Environment production -ProductionApproval REBUILD-PRODUCTION-FTS
```

This creates the FTS5 virtual table if it is missing (D1 exports exclude virtual tables, so a fresh replacement database will not have it), then rebuilds it from `canonical_records`/`content_revisions`/`editorial_record_state` using the same SQL the application itself runs during Hadith book verification, and fails loudly if the resulting row count does not match the expected verified/approved-or-published editorial record count. A Time Travel restore does not need this step — Time Travel preserves FTS5 directly.

After restoration (and, if applicable, the FTS rebuild), run `npm run soak:test`, inspect editorial counts and authentication, and verify API/MCP reads before returning the service to active.

## Deployment Rollback

1. Identify the last known-good Git commit and deployed Worker version.
2. Prefer Cloudflare Worker version rollback for an application-only incident.
3. Revert the faulty Git commit on `dev`, run `npm run check`, deploy test, and complete the soak.
4. Promote the verified repair through the normal production workflow.
5. Restore D1 only when the incident changed persistent data and an application rollback cannot repair it.

## Traffic and Credential Incidents

- Revoke the individual credential first; suspend the owner only when account-level compromise or abuse is likely.
- Review API key request counts, 429 responses, top routes, OAuth clients, and active sessions.
- Rotate platform secrets through Cloudflare, never through Git.
- Keep maintenance responses generic. Do not expose internal errors, database names, tokens, IP addresses, or recovery codes.

## Account Recovery (MFA lockout)

The Admin role requires two-factor authentication (0.20 item 6): `apps/auth/src/admin-plane.ts`'s `requiresMfaEnrollment` blocks every `/v1/admin/*` route except a caller's own `GET /v1/admin/session` for an Admin-role user without TOTP enabled. Editor and Reviewer stay optional. TOTP setup, passkeys, and one-time backup codes are managed in the Developer Portal under Account security -- this gate never touches that flow, so anyone who can still sign in can always reach it.

Normal recovery -- lost TOTP device, backup codes still available: sign in, use a backup code at the 2FA challenge, then re-enroll a new authenticator immediately.

Full lockout -- both the TOTP device and backup codes are lost: Better Auth's `twoFactor` plugin gates sign-in itself once enabled, so this is a platform-level lockout, not something this gate alone controls, and self-service recovery is not built (add it before there are non-owner Admins depending on this). Recovery requires direct D1 access:

```powershell
npx wrangler d1 execute fortress-identity-test --remote --env test --config apps/auth/wrangler.jsonc --command "UPDATE `"user`" SET twoFactorEnabled = 0 WHERE email = '<locked-out-admin-email>'"
npx wrangler d1 execute fortress-identity-test --remote --env test --config apps/auth/wrangler.jsonc --command "DELETE FROM twoFactor WHERE userId = (SELECT id FROM `"user`" WHERE email = '<locked-out-admin-email>')"
```

Confirm the requester's identity out of band before running this (it disables their second factor). The affected admin must sign in and re-enroll MFA immediately afterward -- until they do, `requiresMfaEnrollment` blocks them from every admin route again on the next request. Record the action in the audit trail manually (this recovery path is outside the application, so it does not write an `audit_events` row itself).

The platform owner (`ziyadahmed910@gmail.com`, `bootstrapDefaultAdmin`) is exempt from being removed as Admin, but is **not** exempt from this MFA gate -- they must enable MFA like any other Admin before this ships to an environment they use.

## Recovery Exit

The incident can close after service health, authentication, editorial queues, API/MCP requests, and PWA update checks are green; monitoring remains stable for the agreed observation window; and the timeline, root cause, affected records, remediation, and follow-up owner are recorded.

## Drill Log

Backup and restore must be exercised against test before they are trusted for a real incident. Record each drill here.

| Date (UTC) | Environment | What was tested | Result |
| --- | --- | --- | --- |
| 2026-08-06 | test | Ran `backup-d1.ps1` for real against `fortress-identity-test` and `fortress-platform-test` (manifest + SHA-256 checksums verified against downloaded files). Created a throwaway marker table in `fortress-platform-test` after the backup bookmark, then ran `restore-d1.ps1 -Database content -Bookmark <backup bookmark>` to roll it back with D1 Time Travel. | Restore removed the marker table as expected; `npm run soak:test` passed 5/5 rounds across all 9 surfaces immediately after. Confirms the backup bookmark capture, restore script, and pre-restore rollback capture all work end-to-end. Identity-DB restore and disaster-recovery-style rebuild-from-SQL-export were not exercised in this drill — see the FTS rebuild automation entry below. |
| 2026-08-06 | test | Ran the new `rebuild-fts.ps1` for real against `fortress-platform-test` (not a dry run) to validate the FTS-rebuild-after-DR automation. | Found and corrected a genuine 1-row drift: `canonical_search_fts` had 268 rows, current `editorial_record_state` (verified + approved/published) had 269. Rebuild brought it to 269 and the row-count verification passed. Confirmed the live API stayed healthy and search (`/v1/duas/search`) kept working immediately after. The virtual-table-recreation path (simulating a true post-SQL-export scenario where the table doesn't exist at all) was not exercised, since the table already existed on test — only the data-rebuild path was proven live. |
