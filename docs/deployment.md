# Deployment

## 1. Apps Script code

**Option A: GitHub Actions (recommended).** Repository secrets:

| Secret | Value |
|---|---|
| `OCE_SCRIPT_ID` | Apps Script project ID (*Project Settings → IDs*) |
| `CLASPRC_JSON` | Contents of `~/.clasprc.json` after `clasp login` |
| `OCE_DEPLOYMENT_ID` | ID of the existing web app deployment (*Deploy → Manage deployments*) |

Then run **Actions → Deploy OCE Apps Script**. The workflow runs the tests, pushes `apps-script/` with `--force` (removing the v1 files from the project) and updates the existing deployment, so the `/exec` URL stays the same.

**Option B: by hand.** Delete the old `.gs` files from the project, create one file per `apps-script/*.gs` file with the same name, and replace the manifest (`appsscript.json`, visible after *Project Settings → Show manifest*).

## 2. First run

In the Apps Script editor, select **`oceSetup`** and press **Run**. Authorise the requested scopes (Sheets, triggers, external requests). The execution log shows:

- the spreadsheet URL (for v1 users, your existing *OCE — Source Intelligence Data* spreadsheet, upgraded in place)
- the **API key** for the dashboard
- the **webhook key** for Resend
- the number of v1 triggers removed (the every-minute `runOceMissionBatch` triggers)

v1 missions are migrated as `PAUSED`. Resume them from the dashboard if you want them to keep collecting under v2's budgets.

Run **`oceHealthCheck`** at any time to see what is still missing.

## 3. Web app

*Deploy → Manage deployments → edit (pencil) → Version: New version*, with *Execute as: **Me*** and *Who has access: **Anyone***. Anonymous access is required for unsubscribe links and webhooks. Every other action requires the API key.

## 4. Dashboard

GitHub Pages publishes `web/` on every push to `main` (*Deploy OCE Pages UI* workflow). Open it, go to **Settings** and enter the `/exec` URL and the API key. They are stored only in that browser's local storage.

## 5. Script Properties (secrets)

*Project Settings → Script Properties*:

| Property | Needed for |
|---|---|
| `OCE_API_KEY`, `OCE_SIGNING_SECRET`, `OCE_WEBHOOK_KEY` | Created by `oceSetup`. Rotate the API key with `oceRotateApiKey()` |
| `OCE_SEARCH_PROVIDER` = `BRAVE`, `OCE_SEARCH_API_KEY` | Much better discovery (Brave Search API; a free tier exists) |
| `RESEND_API_KEY` | Delivery through Resend |
| `OCE_TEST_RECIPIENT` | Your own address for test sends |
| `OCE_PRODUCTION_APPROVED` | Set by `oceApproveProduction()`. Do not type it by hand |
| `OCE_DELIVERY_ENDPOINT`, `OCE_DELIVERY_TOKEN` | Only when `DELIVERY_PROVIDER=ENDPOINT` (your own relay) |

## Local development

```bash
npm test          # 27 tests against a mock Apps Script runtime
npm run check     # syntax + duplicate-global check
npm run dev       # dashboard + real backend code on http://localhost:8787 with demo data
```
