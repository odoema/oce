# OCE — GitHub → Apps Script automatic sync

OCE now treats the GitHub `apps-script/` directory as the source of truth for the Apps Script runtime.

The workflow `.github/workflows/apps-script-sync.yml` uses `@google/clasp` to:

1. validate every `.gs` file and the Apps Script manifest;
2. push the GitHub Apps Script source to the existing OCE Apps Script project;
3. update the existing OCE web-app deployment instead of creating a new deployment;
4. verify the canonical OCE Collector Gateway `/exec?action=health` endpoint.

The current canonical deployment ID is already wired into the workflow, so no second deployment secret is needed.

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

### 4. Add the GitHub Actions secret

In the GitHub repository settings, open **Secrets and variables → Actions → New repository secret**.

Create exactly one secret:

- `CLASPRC_JSON` — paste the complete contents of the local `.clasprc.json` file.

The current canonical deployment ID is already configured in the workflow and is not required as a secret.

### 5. Optional local deployment check

From the OCE repository root:

```bash
npx @google/clasp@3.4.1 list-deployments
```

You should see the existing deployment used by the canonical OCE `/exec` URL.

## After setup

Every push to `main` that changes `apps-script/**` automatically runs the sync workflow.

The workflow stops before changing Apps Script if `CLASPRC_JSON` is missing. It also verifies that the known canonical deployment exists before pushing source.

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
- Google OAuth credentials are stored only as a GitHub Actions secret, not in repository source.
- The workflow keeps the existing canonical deployment ID rather than creating a new web-app URL.
- The workflow does not enable or add any new Apps Script runtime scopes.
- `clasp push` is not an atomic Apps Script API operation, so production changes should continue to pass the repository validation workflow first.
