# OCE — Odoch Campaign Engine

OCE is a consent-aware marketing intelligence and campaign operations platform built around modular LEGO blocks. Complexity stays inside the system; the operator experience stays simple.

## Current release

**V1.4 — Source Scout + controlled public-source collection**

### Working foundation

- public URL collector with HTTP/HTTPS validation;
- SSRF/private-network protections;
- bounded redirects and response size;
- public-page HTML, links, tables, metadata and JSON-LD extraction;
- source intelligence and provenance;
- contact indicators and normalized review candidates;
- explicit `NO_CONSENT` default;
- controlled contact ingestion and normalization;
- duplicate handling and suppression support;
- campaign queueing and delivery boundary;
- DRY_RUN / TEST / PRODUCTION delivery modes;
- Resend integration boundary without storing provider credentials in GitHub or Sheets.

### New Source Scout block

Source Scout discovers candidate URLs from public seed pages and places them into an organized browser queue.

```text
Seed URLs → Collector → Link Discovery → Normalize → Deduplicate → Score → Queue
```

The Scout currently:

- accepts multiple public seed URLs;
- discovers one link level;
- removes duplicates and obvious static assets;
- optionally keeps discovery on seed domains;
- scores likely useful sources;
- limits a run to 100 sources;
- persists the queue locally in the browser;
- exports the queue as JSON;
- does not automatically scrape the queue or send campaigns.

See `docs/source-scout-v1.md`.

## Safety state

Production sending remains **disabled**. The delivery mode is controlled independently from source discovery. Newly discovered contact candidates remain review-only and default to `NO_CONSENT`.

Public visibility is not marketing consent. OCE does not bypass authentication, CAPTCHA, paywalls, access controls, or other restrictions.

## Repository structure

```text
oce/
├── apps-script/
│   ├── Code.gs
│   ├── DeliveryAdapter.gs
│   ├── UrlScraper.gs
│   ├── CollectorGateway.gs
│   ├── V12_Migration.gs
│   └── appsscript.json
├── docs/
│   ├── architecture.md
│   ├── database.md
│   ├── deployment.md
│   ├── provider-resend.md
│   ├── security.md
│   ├── v1.2-rollout.md
│   └── source-scout-v1.md
├── web/
│   ├── index.html
│   ├── app.js
│   ├── scout.js
│   └── styles.css
├── config/
│   └── settings.example.json
├── tests/
│   └── README.md
└── .github/workflows/
```

## Architecture rule

> Build complex capabilities as independent LEGO blocks, but give the user the simplest possible experience.

The stable URL scraper is treated as an ingestion foundation. New capabilities should wrap around it rather than repeatedly rewriting it.

## Roadmap

1. Stable public URL collection — complete.
2. Source intelligence — complete.
3. Contact intelligence — foundation complete.
4. Source Scout V1 — complete.
5. Durable Source Registry and persistent Scrape Queue.
6. Search/directory/sitemap discovery adapters.
7. Consent-aware contact import and review workflow.
8. Campaign analytics and delivery lifecycle.
9. National marketing intelligence dashboard.

## Rollback marker

Main has been restored to the last known stable Mission Control baseline for recovery and verification.
