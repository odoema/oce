# OCE — Odoch Campaign Engine

OCE is a consent-aware campaign operations engine built around Google Sheets and Google Apps Script.

## Current release

**V1.2 — Delivery boundary and controlled rollout foundation**

Included:

- contact normalization and email validation;
- Uganda phone normalization;
- duplicate handling;
- consent filtering and suppression support;
- provenance/source fields;
- segmentation and campaign queueing;
- configurable batch size (default 250);
- holiday/weekend controls;
- Kampala timezone support;
- pause/resume safety switch;
- hourly scheduler framework;
- dashboard and send log;
- provider-neutral delivery adapter;
- DRY_RUN / TEST / PRODUCTION delivery modes;
- idempotency key based on queue ID;
- provider message ID and retry-attempt fields;
- Resend integration boundary without storing provider credentials in GitHub or Sheets.

### Important safety state

Production sending is **not enabled**. The default delivery mode is **DRY_RUN** and the global `SEND_ENABLED` switch is `FALSE`. The production gate must remain closed until sender authentication, consent, unsubscribe, suppression, bounce/complaint handling, and a controlled test are verified.

## V1.2 deployment

1. Open the OCE Google Sheet.
2. Extensions → Apps Script.
3. Keep the existing `Code.gs` and add `apps-script/DeliveryAdapter.gs`.
4. Add `apps-script/V12_Migration.gs` and run `upgradeOCE12()` once.
5. Run **Initialize / Repair Workbook**.
6. Confirm `DELIVERY_MODE` is `DRY_RUN` and `SEND_ENABLED` is `FALSE`.
7. Do not place provider API keys in GitHub, campaign sheets, or contact exports.
8. Configure the external delivery endpoint only after its authentication and unsubscribe/suppression handling are ready.

The adapter expects the external delivery service to return a `results[]` array containing the queue ID, recipient, result, optional provider message ID, and message. This keeps provider credentials outside the spreadsheet control plane.

## Repository structure

```text
oce/
├── apps-script/
│   ├── Code.gs
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

1. Provider-neutral delivery boundary — complete.
2. Controlled Resend delivery endpoint — next.
3. Unsubscribe/bounce/complaint lifecycle processing.
4. Campaign analytics and delivery metrics.
5. Stronger holiday calendar management.
6. Automated tests and CI validation.
7. Optional multi-provider failover architecture.
