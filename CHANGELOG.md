# Changelog

## 2.3.0 — 2026-11-24

### Added
- Public PDF documents (member lists, directories, registers, tender notices) are read. Google Drive converts each PDF to text (scanned PDFs via OCR); the temporary Google Doc is deleted straight away. New file `apps-script/15_Documents.gs`.
- List-aware extraction for documents: every e-mail gets the organisation name and phone from the lines around it, and free-mail domains are not taken as websites.
- PDF links whose name or label suggests a list (member, firms, register, directory, licensed…) are prioritised; other PDFs are ranked low. At most 4 PDFs are converted per background round; larger than 10 MB are skipped.
- Setting `CRAWL_PDFS` (default TRUE). "Inspect a single page" works with PDF links.
- 3 tests.

### Changed
- New OAuth scope `drive.file` (only files OCE creates). The owner must re-authorise once after deploying: run `oceSetup` in the Apps Script editor and click Allow.

## 2.2.1 — 2026-11-24

### Fixed
- A browser that remembered the address of an older deployment talked to retired v1 code ("URL is required", "Not connected"). The dashboard now checks a saved address once per visit and switches to the current deployment automatically.

### Added
- One-click connect for new browsers and phones: Settings → "Connect another browser or phone" copies a personal link (`#connect=…`). Opening it connects that browser and removes the key from the address bar; the part after `#` is never sent to any server.
- The assistant notices an unconnected browser and walks through connecting it; it accepts the key or the connect link.

## 2.2.0 — 2026-11-24

### Added
- Free, keyless discovery. Missions find websites from matching Wikipedia "List of …" pages and Wikidata organisations with an official website, scoped to the country. No search API key, account or payment. Results are cached for 6 hours. Brave Search stays optional.
- Interactive guide built into the dashboard (`web/help.html`, content in `web/manual.js`): animated walkthroughs of each tab, an objective checker, a lawful-basis helper, a go-live checklist, a plain-language settings reference and troubleshooting. Sidebar "Help & guide" link and a "How this works" link on every page.
- OCE assistant (`web/assistant.js`): a friendly step-by-step helper in the dashboard ("Ask OCE", bottom right, opens by itself on the first visit). It asks one question at a time with suggestions and does the work through the normal API: finds contacts (checks the objective, previews sources, starts and runs the mission), reviews contacts one by one after asking the lawful basis, drafts and previews a campaign from a template, imports a CSV (with consent), reports status, and answers questions from the guide. Rule-based: no AI service, no cost. Shared logic in `web/guide-logic.js`.
- `tests/manual.test.js` keeps the guide in step with the app: version, "What's new", tab coverage, button and field names, and the full settings list are all checked in CI.

### Changed
- Dashboard default web app address now points at the live deployment.
- Missions start from up to 20 seed websites (was 10).
- Removed "add a search key" warnings from the dashboard, setup and health check.

## 2.1.0 — 2026-11-24

### Added
- Sitemap seeding: when a mission's seed page is collected, OCE reads that site's sitemaps (robots.txt `Sitemap:` lines first, then `/sitemap.xml`, `/sitemap_index.xml`, `/sitemap-index.xml`). It follows one level of sitemap index, reads `.xml.gz` files, and stops after 12 files or 100 URLs per site. The 40 best-scored URLs are queued at depth 1. Fetches obey robots.txt and per-host pacing, and run once per site per mission. Can be switched off with the setting `CRAWL_USE_SITEMAPS`.
- Robots meta tags and `X-Robots-Tag`. A page marked `noindex` is recorded as `SKIPPED` and no contact data is kept from it, but its links are still followed. `nofollow` stops link-following from that page.
- 4 tests (27 in total).

Ideas taken from PR #2 ("intelligent queue bridge"), rebuilt on the v2 fetcher. PR #2's per-candidate profiling was left out because it costs several extra fetches per search result.

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
- Mock Apps Script runtime, 27 tests, duplicate-global check, local dev server, CI.
