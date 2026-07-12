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

Required:

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
