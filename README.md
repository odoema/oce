# OCE — Odoch Campaign Engine

OCE is a consent-aware campaign operations engine built around Google Sheets and Google Apps Script.

## Current release

**V1.3 — Controlled contact ingestion foundation**

Included:

- contact normalization and email validation;
- Uganda phone normalization;
- duplicate handling;
- consent filtering and suppression support;
- provenance/source fields;
- controlled CSV and Google Sheets ingestion;
- source registry and import-run audit trail;
- segmentation and campaign queueing;
- configurable batch size (default 250);
- holiday/weekend controls;
- Kampala timezone support;
- pause/resume safety switch;
- hourly scheduler framework;
- dashboard and send log;
- provider-neutral delivery boundary;
- DRY_RUN / TEST / PRODUCTION delivery modes;
- idempotency key based on queue ID;
- provider message ID and retry-attempt fields;
- Resend integration boundary without storing provider credentials in GitHub or Sheets.

### Important safety state

Production sending is **not enabled**. The default delivery mode is **DRY_RUN** and the global `SEND_ENABLED` switch is `FALSE`. Newly ingested records default to `consent_status=NO`, so they cannot enter a campaign queue until valid consent is explicitly recorded.

## V1.3 import workflow

1. Open the OCE Google Sheet.
2. Extensions → Apps Script.
3. Add `apps-script/Contact_Import.gs`.
4. Run **Initialize / Repair Workbook** and then **Setup Import Engine**.
5. Register an authorized source in `SOURCE_CONFIG`.
6. Import an approved CSV with `importCsvText()` or an authorized Google Sheet with `importFromGoogleSheet()`.
7. Review the `IMPORT` tab.
8. Run **Normalize & Import Contacts**.
9. Run **Validate Contacts**.
10. Only contacts with valid email, explicit consent, active status, and no suppression can enter a campaign queue.

### About web scraping

OCE does **not** perform unrestricted web scraping. The V1.3 ingestion layer deliberately uses controlled exports/API data/Google Sheets. A future public-source connector can be added only after the source is reviewed for authorization, terms, robots policy, privacy, and lawful marketing use. Private pages, login bypass, CAPTCHA bypass, credential harvesting, and indiscriminate personal-data collection are out of scope.

## V1.2/V1.3 deployment

Do not place provider API keys in GitHub, campaign sheets, or contact exports. Configure the external delivery endpoint only after its authentication and unsubscribe/suppression handling are ready.

## Repository structure

```text
oce/
├── apps-script/
│   ├── Code.gs
│   ├── Contact_Import.gs
│   ├── DeliveryAdapter.gs
│   ├── V12_Migration.gs
│   └── appsscript.json
├── config/
│   └── settings.example.json
├── docs/
│   ├── architecture.md
│   ├── database.md
│   ├── deployment.md
│   ├── provider-resend.md
│   ├── security.md
│   └── v1.2-rollout.md
├── tests/
│   └── README.md
├── .github/workflows/validate.yml
├── .gitignore
└── README.md
```

## Data policy

Only authorized/consented contact data should be imported. Do not bypass access controls or collect private personal information. Do not commit live contact exports, credentials, API keys, service-account files, or secrets.

## Roadmap

1. Controlled contact ingestion — complete.
2. Provider-neutral delivery boundary — complete.
3. Controlled Resend delivery endpoint — next.
4. Unsubscribe/bounce/complaint lifecycle processing.
5. Campaign analytics and delivery metrics.
6. Stronger holiday calendar management.
7. Automated tests and CI validation.
8. Optional reviewed public-source connectors.
