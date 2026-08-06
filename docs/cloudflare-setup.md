# Cloudflare Setup

This guide connects the Fortress Platform API to Cloudflare without changing the existing Bluehost PWA deployment.

## 1. Create the Cloudflare Account

Create or sign in to a Cloudflare account. The first Worker can use the account's `workers.dev` address, so moving the domain's nameservers is not required for the initial deployment.

Do not change nameservers until all existing Bluehost DNS records have been reviewed and copied. This avoids interrupting the website, email, or other Bluehost services.

## 2. Copy the Account ID

In the Cloudflare dashboard, open **Workers & Pages** and copy the **Account ID** shown in the account details.

The Account ID is an identifier, but it should still be stored in GitHub rather than committed into the repository.

## 3. Create a Deployment Token

Open **My Profile > API Tokens > Create Token > Custom token**.

For Worker and database deployment, grant:

```text
Account > Workers Scripts > Edit
Account > D1 > Edit
```

Limit the token to the Fortress Platform Cloudflare account. R2, Queues, Analytics and DNS permissions should be added only when those resources are introduced.

Copy the token immediately. Cloudflare will not display it again.

## 4. Add GitHub Actions Secrets

In `ZiyadAhmed910/Fortress-of-Muslim`, open:

```text
Settings > Secrets and variables > Actions > Secrets
```

Create these repository secrets:

```text
CLOUDFLARE_API_TOKEN     The custom token from step 3
CLOUDFLARE_ACCOUNT_ID    The Account ID from step 2
```

Never paste either value into a source file, issue, pull request, workflow log, or chat message.

## 5. Enable Cloudflare Deployment

Open the **Variables** tab beside repository secrets and create:

```text
Name:  CLOUDFLARE_DEPLOY_ENABLED
Value: true
```

The variable is an intentional safety switch. CI runs without it, but deployment jobs are skipped.

## 6. D1 Environments

The API uses two independent databases:

```text
fortress-platform-test          dev branch
fortress-platform-production    main branch
```

Their non-secret database IDs and `CONTENT_DB` bindings are declared in `apps/api/wrangler.jsonc`. Test data must never be migrated into the production database manually. The appropriate GitHub deployment applies outstanding migrations before releasing each Worker.

Identity and control-plane state uses two additional D1 databases:

```text
fortress-identity-test           dev branch
fortress-identity-production     main branch
```

Before the first deployment of each Auth Worker, create a unique Better Auth secret and store it directly as a Cloudflare Worker secret. Never reuse the test value in production:

```powershell
npx wrangler secret put BETTER_AUTH_SECRET --env test --config apps/auth/wrangler.jsonc
npx wrangler secret put BETTER_AUTH_SECRET --env production --config apps/auth/wrangler.jsonc
```

Routine deployments retain existing Worker secrets. The secret must never be placed in GitHub variables, committed Wrangler configuration, or browser JavaScript.

## 7. Run the First Test Deployment

Open **Actions > Deploy Fortress Platform API to test > Run workflow** and select `dev`.

The workflow deploys `fortress-platform-api-test` and prints its `workers.dev` URL. Verify:

```text
https://<worker-host>/health
https://<worker-host>/v1
https://<worker-host>/v1/duas?limit=2   # requires an API key or OAuth token
```

After this succeeds, every relevant push to `dev` deploys the test API automatically. Relevant pushes to `main` deploy `fortress-platform-api-production`.

## 8. Connect Custom Domains

After the Cloudflare DNS zone has been prepared safely, the Worker environments connect:

```text
api-test.fortressofmuslim.org -> fortress-platform-api-test
api.fortressofmuslim.org      -> fortress-platform-api-production
auth-test.fortressofmuslim.org -> fortress-platform-auth-test
auth.fortressofmuslim.org      -> fortress-platform-auth-production
```

The custom domains are declared in `apps/api/wrangler.jsonc`, allowing GitHub deployments to keep routing and Worker versions synchronized. The `workers.dev` hostname remains available for diagnostics.

Static portal domains are provisioned once with an authenticated Wrangler session using each portal's `wrangler.jsonc`. Routine GitHub deployments use `wrangler.ci.jsonc`, which updates assets without requesting zone-route permissions. This keeps the repository deployment token limited to Worker uploads after bootstrap.

## 9. Scheduled Encrypted Backups (R2)

`tools/backup-d1.ps1` can encrypt its output (AES-256-CBC with a separate HMAC-SHA256 integrity tag, streamed so it handles the 150MB+ content export without loading it into memory) and `.github/workflows/scheduled-backup.yml` runs it daily and uploads the result to Cloudflare R2. Both are inert until this section's setup is done.

**Extend the deployment token.** This is the moment `docs/cloudflare-setup.md` step 3 anticipated ("R2... permissions should be added only when those resources are introduced"). Reuse the existing `CLOUDFLARE_API_TOKEN` rather than creating a second one:

```text
My Profile > API Tokens > find the Fortress Platform deployment token > Edit
Add permission: Account > Workers R2 Storage > Edit
```

**Create the bucket** (one time, via an authenticated Wrangler session):

```powershell
npx wrangler r2 bucket create fortress-platform-backups
```

**Set a retention policy on the bucket** so old backups don't accumulate forever. R2 supports object lifecycle rules natively -- configure one rather than scripting deletion into the workflow:

```powershell
npx wrangler r2 bucket lifecycle add fortress-platform-backups --name expire-old-backups --expire-days 30
```

Adjust `--expire-days` to the retention window the operator actually wants; 30 days is a starting point, not a requirement.

**Generate and store the encryption key.** This key is the only thing that makes an R2 backup readable -- losing it makes every backup encrypted with it permanently unrecoverable, so it needs to live somewhere durable outside both Git and GitHub Actions (a password manager, at minimum):

```powershell
. tools/lib/backup-crypto.ps1
New-FortressBackupKey
```

**Add the GitHub secret:**

```text
Settings > Secrets and variables > Actions > Secrets > New repository secret
Name:  FORTRESS_BACKUP_KEY
Value: <the base64 key from the previous step>
```

Never paste the key into a source file, issue, pull request, workflow log, or chat message. The scheduled workflow already runs behind the same `CLOUDFLARE_DEPLOY_ENABLED` safety switch as every other deployment job in this repository, so it will not run at all until that variable is `true`.

**Restore path:** `tools/decrypt-backup.ps1 -InputPath <file>.sql.enc` decrypts a downloaded backup (`npx wrangler r2 object get fortress-platform-backups/<file> --file <local-path> --remote` first). It verifies the integrity tag before writing anything to disk and refuses to decrypt on a mismatch. See `docs/incident-response.md` for the full restore procedure.
