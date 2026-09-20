# Deployment Workflow

This repository is designed as a static PWA deployment.

## Branch model

- `feature/name-of-feature` or `Feature/name-of-feature`
  - Normal feature work.
  - A push to this branch creates a pull request into `dev`.
  - The workflow auto-merges the PR into `dev`.

- `dev`
  - Test branch.
  - Every push deploys `pwa-website/` to the Bluehost test site.
  - Intended target: `http://test.fortressofmuslim.org/`

- `main`
  - Production branch.
  - Every push deploys `pwa-website/` to the production Bluehost site.

## Required GitHub secrets

Add these in GitHub:

`Settings -> Secrets and variables -> Actions -> New repository secret`

Required for test deployment:

- `BLUEHOST_FTP_SERVER`
  - Example: `ftp.fortressofmuslim.org`

- `BLUEHOST_FTP_USERNAME`
  - FTP username from Bluehost.

- `BLUEHOST_FTP_PASSWORD`
  - FTP password from Bluehost.

- `BLUEHOST_TEST_DIR`
  - FTP destination folder for test site.
  - Example: `/public_html/test/`
  - The exact value depends on the Bluehost domain/subdomain configuration.

- `BLUEHOST_PROD_DIR`
  - FTP destination folder for production site.
  - Example: `/public_html/`

## Deployment source

Only the contents of `pwa-website/` are deployed.

Excluded from deploy:

- local server helper `serve.py`
- extraction tools under `tools/`
- visualization prototype files
- README/dev-only files

## Automated safeguards

Every platform check runs the complete typecheck and test suite plus `npm audit --omit=dev --audit-level=high`. Deployment jobs have bounded runtimes so a stalled provider cannot leave a workflow running indefinitely.

After deployment, GitHub Actions verifies the live environment:

- API, Auth, and MCP health responses must report `ok` and the exact repository platform version.
- Developer, Status, and Admin portals must return the Fortress brand and deployed Content Security Policy.
- Bluehost test and production PWA origins must return a successful HTTP response.

The smoke checks retry briefly because Cloudflare and Bluehost can take a few seconds to converge. A failed smoke check fails the deployment workflow and must be investigated before promotion.

Run the same platform checks manually with:

```powershell
npm run smoke:test:services
npm run smoke:test:portals
npm run smoke:production:services
npm run smoke:production:portals
```

## Promoting dev to production

When test is good:

```powershell
git checkout main
git merge dev
git push origin main
```

That push deploys production.

## Feature branch naming

Use:

```text
feature/name-of-feature
```

Examples:

```text
feature/mood-tags
feature/ruqyah-category
feature/export-favourites
```
