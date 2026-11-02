# OCE — GitHub → Apps Script automatic sync

OCE now treats the GitHub `apps-script/` directory as the source of truth for the Apps Script runtime.

The workflow `.github/workflows/apps-script-sync.yml` uses `@google/clasp` to:

1. validate every `.gs` file and the Apps Script manifest;
2. push the GitHub Apps Script source to the existing OCE Apps Script project;
3. update the existing web-app deployment rather than creating a new deployment;
4. verify the canonical OCE Collector Gateway `/exec?action=health` endpoint.

This preserves the existing web-app URL when the existing deployment ID is supplied.

## One-time setup

### 1. Enable the Apps Script API

Using the Google account that owns/edits the OCE Apps Script project, enable the Apps Script API in Apps Script user settings:

`https://script.google.com/home/usersettings`

### 2. Authenticate clasp locally

Install the same major Node.js version used by CI (Node.js 24 is recommended), then run:

```bash
npx @google/clasp@3.4.1 login
```

Complete the Google authorization in the browser.

This creates an OAuth credential file named `.clasprc.json` in the user's profile/home directory. **Never commit this file and never paste it into chat, an issue, a pull request, or a public repository.**

### 3. Confirm the OCE project

The repository `.clasp.json` targets the existing OCE Apps Script project and uses `apps-script/` as its root directory.

The project editor is:

`https://script.google.com/home/projects/1__bAterCWQop83g_fgfml8ggBQwd6Wzxl45veH_9Kk3rVBbSeHsG-qs/edit`

### 4. Find the existing web-app deployment ID

From the OCE project directory, run:

```bash
npx @google/clasp@3.4.1 list-deployments
```

Identify the deployment that corresponds to the current canonical OCE `/exec` URL.

Do **not** create a new deployment for this setup. The workflow is designed to update the existing deployment.

### 5. Add two GitHub Actions secrets

In the GitHub repository settings, open **Secrets and variables → Actions → New repository secret**.

Create:

- `CLASPRC_JSON` — paste the complete contents of the local `.clasprc.json` file.
- `OCE_APPS_SCRIPT_DEPLOYMENT_ID` — the existing OCE web-app deployment ID.

These values are consumed only by GitHub Actions. They are never stored in the repository source.

## After setup

Every push to `main` that changes `apps-script/**` automatically runs the sync workflow.

The workflow will stop before changing Apps Script if either secret is missing. This prevents an accidental source push without a valid deployment configuration.

The final smoke test checks:

```text
?action=health
```

and expects the OCE Collector Gateway service to report `ok: true`.

## Rollback

A recovery branch was created before the bridge was installed:

`recovery-before-clasp-bridge-2026-11-02`

The Apps Script project can also be rolled back by restoring a known-good Git commit and rerunning the sync workflow.

## Security notes

- `UrlScraper.gs` remains protected by the existing public-source-only safeguards.
- GitHub is the source of truth for Apps Script source files.
- Google OAuth credentials are GitHub Secrets, not repository files.
- The deployment ID is supplied as a secret so the canonical `/exec` deployment can be updated without changing its URL.
- The workflow does not enable or add any new Apps Script runtime scopes.
- `clasp push` is not an atomic Apps Script API operation, so production changes should continue to pass the repository validation workflow first.
