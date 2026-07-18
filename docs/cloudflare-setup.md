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

## 7. Run the First Test Deployment

Open **Actions > Deploy Fortress Platform API to test > Run workflow** and select `dev`.

The workflow deploys `fortress-platform-api-test` and prints its `workers.dev` URL. Verify:

```text
https://<worker-host>/health
https://<worker-host>/v1
https://<worker-host>/v1/duas?limit=2
```

After this succeeds, every relevant push to `dev` deploys the test API automatically. Relevant pushes to `main` deploy `fortress-platform-api-production`.

## 8. Connect Custom Domains

After the Cloudflare DNS zone has been prepared safely, the Worker environments connect:

```text
api-test.fortressofmuslim.org -> fortress-platform-api-test
api.fortressofmuslim.org      -> fortress-platform-api-production
```

The custom domains are declared in `apps/api/wrangler.jsonc`, allowing GitHub deployments to keep routing and Worker versions synchronized. The `workers.dev` hostname remains available for diagnostics.
