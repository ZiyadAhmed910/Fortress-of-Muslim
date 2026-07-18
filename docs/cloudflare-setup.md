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

For the first Worker deployment, grant:

```text
Account > Workers Scripts > Edit
```

Limit the token to the Fortress Platform Cloudflare account. D1, R2, Queues, Analytics and DNS permissions will be added only when those resources are introduced.

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

## 6. Run the First Test Deployment

Open **Actions > Deploy Fortress Platform API to test > Run workflow** and select `dev`.

The workflow deploys `fortress-platform-api-test` and prints its `workers.dev` URL. Verify:

```text
https://<worker-host>/health
https://<worker-host>/v1
https://<worker-host>/v1/duas?limit=2
```

After this succeeds, every relevant push to `dev` deploys the test API automatically. Relevant pushes to `main` deploy `fortress-platform-api-production`.

## 7. Connect Custom Domains Later

After the Cloudflare DNS zone has been prepared safely, the Worker environments connect:

```text
api-test.fortressofmuslim.org -> fortress-platform-api-test
api.fortressofmuslim.org      -> fortress-platform-api-production
```

The custom domains are declared in `apps/api/wrangler.jsonc`, allowing GitHub deployments to keep routing and Worker versions synchronized. The `workers.dev` hostname remains available for diagnostics.
