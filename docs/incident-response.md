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

Each run exports identity and content databases and writes a manifest with the Git commit and SHA-256 checksums. `.fortress-backups/` is intentionally ignored by Git. Move production backups to an access-controlled encrypted store according to the operator retention policy.

## Restore

Always restore test first and run the full soak. The restore script creates a fresh pre-restore backup before applying an export.

```powershell
.\tools\restore-d1.ps1 -Database content -Environment test -BackupFile .fortress-backups\<file>.sql -ExpectedSha256 <hash>
.\tools\restore-d1.ps1 -Database identity -Environment production -BackupFile <secure-path> -ExpectedSha256 <hash> -ProductionApproval RESTORE-PRODUCTION
```

Never restore identity and content databases from unrelated timestamps without documenting why. After restoration, run `npm run soak:test`, inspect editorial counts and authentication, and verify API/MCP reads before returning the service to active.

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
