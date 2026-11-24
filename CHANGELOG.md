# Changelog

## 2.0.0 — 2026-11-24

Rewrite of the engine so the documented workflow works end to end.

### Fixed
- The campaign half (contacts, import, campaigns, sending) called `SpreadsheetApp.getActive()`, which is `null` in the standalone project, so none of it could run. Everything now uses one data spreadsheet.
- The crawler queued 25 links per page with no limits, which made queues grow without end. Mission page budget, depth, per-domain cap and same-site rule are now enforced.
- Contact Intelligence fetched every page a second time. Extraction now happens in one pass.
- Queue items stuck in `SCRAPING` after a timeout were never retried. Leases now expire and are recovered.
- Full page text and table JSON written to cells broke the 50k-character cell limit. Results are now compact and size-safe.
- An every-minute trigger used up the daily trigger quota, and a second trigger ran a stale deployment version alongside it. Replaced by one self-disabling 5-minute trigger, and `oceSetup` removes the old ones.
- Public `doGet` let anyone start missions, run the worker or fetch arbitrary URLs. All actions now need an API key.
- The source canonicaliser stripped query strings, losing directory pagination. Queries are now kept and only tracking parameters removed.
- JSON-LD address bug (`obj.addressLocality`). Phone extraction was limited to Uganda formats.
- Docs claimed robots.txt support that did not exist. It is now implemented.
- The dashboard stylesheet was empty.

### Added
- Parallel polite fetcher (robots.txt with crawl-delay, manual redirect validation, HTML-only, charset detection, login and challenge detection, retries with backoff).
- Extraction of Cloudflare-protected and obfuscated e-mails, JSON-LD `@graph`, organisation and address heuristics, categories, confidence scoring and link scoring.
- De-duplicated candidates, a review gate with lawful basis, contacts, CSV import, segments, campaigns and templating.
- Delivery: DRY_RUN, TEST and PRODUCTION modes, a Resend batch provider and a custom endpoint provider, idempotency, caps, sending window, holidays, signed one-click unsubscribe (RFC 8058), and a bounce/complaint webhook with suppression.
- Dashboard with Overview, Missions, Review, Contacts, Campaigns and Settings.
- In-place v1 → v2 migration, `oceHealthCheck`, production approval gate.
- Mock Apps Script runtime, 23 tests, duplicate-global check, local dev server, CI.
