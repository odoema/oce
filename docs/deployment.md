# Deployment

## Google Apps Script

1. Create/open the Google Sheet used by OCE.
2. Open **Extensions → Apps Script**.
3. Copy `apps-script/Code.gs` into the Apps Script project.
4. Copy the contents of `apps-script/appsscript.json` into the project manifest.
5. Save and run `setupOCE()` once to authorize and initialize the workbook.
6. Keep `SEND_ENABLED=FALSE` while testing.
7. Load only authorized/consented contacts into `IMPORT`.
8. Validate contacts and test segmentation/queue behavior.
9. Connect and test the production delivery adapter.
10. Enable sending only after unsubscribe, bounce, suppression, rate-limit and provider-policy handling is verified.

## GitHub

This repository is the source-control layer. Never store live contact exports, API keys, Google service-account credentials, OAuth secrets, or other production credentials here.
