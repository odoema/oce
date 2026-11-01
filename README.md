# OCE — Odoch Campaign Engine

OCE is a consent-aware campaign operations engine built around Google Sheets and Google Apps Script.

## Current release

**V1.1 — Operations foundation**

Included:

- contact normalization;
- email validation;
- Uganda phone normalization;
- duplicate handling;
- consent filtering;
- suppression list support;
- provenance/source fields;
- segmentation;
- campaign queueing;
- configurable batch size (default 250);
- holiday/weekend controls;
- Kampala timezone support;
- pause/resume safety switch;
- hourly scheduler framework;
- dashboard and send log.

### Important

V1.1 does **not** send email yet. The delivery adapter is intentionally disabled until a production provider is connected and compliance controls are tested.

## Repository structure

```text
oce/
├── apps-script/
│   ├── Code.gs
│   └── appsscript.json
├── config/
│   └── settings.example.json
├── docs/
│   ├── architecture.md
│   ├── database.md
│   ├── deployment.md
│   └── security.md
├── tests/
│   └── README.md
├── .gitignore
└── README.md
```

## Data policy

Only authorized/consented contact data should be imported. Do not bypass access controls or collect private personal information. Do not commit live contact exports, credentials, API keys, service-account files, or secrets.

## Roadmap

1. Repository and source-control foundation — current.
2. Provider-neutral delivery interface.
3. Resend production adapter.
4. Unsubscribe/bounce webhook processing.
5. Campaign analytics and delivery metrics.
6. Stronger holiday calendar management.
7. Automated tests and CI validation.
8. Optional multi-provider failover architecture.
