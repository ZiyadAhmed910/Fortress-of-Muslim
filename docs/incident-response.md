# Fortress Platform Incident Response

This runbook covers availability, authentication, data integrity, abusive traffic, and failed deployments. It applies to test and production.

## First Response

1. Record the start time, affected host, symptoms, and a correlation or `X-Request-ID`.
2. Open Admin Console > Operations Monitor. Check errors, latency, rate limits, queues, active sessions, and service state.
3. Limit the blast radius. Put an affected Worker-enforced service into maintenance; do not disable the Admin Console.
4. Preserve evidence. Export both D1 databases and retain Cloudflare Worker logs before changing data.
5. Revoke compromised sessions, API keys, OAuth clients, or devices from Admin Console.

## Backup

Create an encrypted-at-rest local export outside Git:

```powershell
.\tools\backup-d1.ps1 -Environment test
.\tools\backup-d1.ps1 -Environment production
```

Each run captures exact D1 Time Travel bookmarks, exports the identity database, and exports all durable content application tables. FTS5 virtual and shadow tables are intentionally excluded because Cloudflare cannot export a database containing virtual tables; search indexes are derived data and must be rebuilt from canonical records after disaster recovery. The manifest records the export mode, Git commit, bookmarks, and SHA-256 checksums. `.fortress-backups/` is intentionally ignored by Git. Move production backups to an access-controlled encrypted store according to the operator retention policy.
The default per-database export timeout is 30 minutes and can be changed with `-ExportTimeoutMinutes`. A timed-out export is terminated, its incomplete file is removed, and no manifest is produced.

## Restore

Always restore test first and run the full soak. Active databases are restored only through D1 Time Travel, which preserves FTS5 and database internals. The script records the current bookmark before rollback so the rollback itself can be reversed.

```powershell
.\tools\restore-d1.ps1 -Database content -Environment test -Bookmark <manifest-bookmark>
.\tools\restore-d1.ps1 -Database identity -Environment production -Timestamp 2026-07-23T12:00:00Z -ProductionApproval RESTORE-PRODUCTION
```

Never restore identity and content databases from unrelated timestamps without documenting why. Time Travel is retained by Cloudflare for a limited window. SQL exports are durable disaster-recovery artifacts and must be imported into a new replacement database, verified, have search indexes rebuilt, and then be rebound; they are never executed over an active database by this script. After restoration, run `npm run soak:test`, inspect editorial counts and authentication, and verify API/MCP reads before returning the service to active.

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

## Recovery Exit

The incident can close after service health, authentication, editorial queues, API/MCP requests, and PWA update checks are green; monitoring remains stable for the agreed observation window; and the timeline, root cause, affected records, remediation, and follow-up owner are recorded.

## Drill Log

Backup and restore must be exercised against test before they are trusted for a real incident. Record each drill here.

| Date (UTC) | Environment | What was tested | Result |
| --- | --- | --- | --- |
| 2026-08-06 | test | Ran `backup-d1.ps1` for real against `fortress-identity-test` and `fortress-platform-test` (manifest + SHA-256 checksums verified against downloaded files). Created a throwaway marker table in `fortress-platform-test` after the backup bookmark, then ran `restore-d1.ps1 -Database content -Bookmark <backup bookmark>` to roll it back with D1 Time Travel. | Restore removed the marker table as expected; `npm run soak:test` passed 5/5 rounds across all 9 surfaces immediately after. Confirms the backup bookmark capture, restore script, and pre-restore rollback capture all work end-to-end. Identity-DB restore and disaster-recovery-style rebuild-from-SQL-export were not exercised in this drill — see the FTS rebuild automation work before relying on the SQL-export path. |
