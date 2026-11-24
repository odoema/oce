# OCE — Odoch Campaign Engine

OCE finds organisations on the public web, extracts their contact details, lets you review them, and sends campaigns only to contacts you have a lawful basis to reach. It runs on Google Apps Script and Google Sheets with a static dashboard, so there are no servers to run and nothing to pay for until you send at volume.

```text
Objective ─► Discover ─► Collect ─► Extract ─► Review ─► Contacts ─► Segment ─► Campaign ─► Deliver
"Audit firms   search +    polite     e-mails,   you        lawful      rules      DRY_RUN →   Resend, with
 in Uganda"    registers   crawler    phones,    approve    basis       (AND)      TEST →      unsubscribe,
                                      orgs                  recorded               PRODUCTION  bounces, caps
```

## Current release — v2.1.0

v2.1 adds **sitemap seeding** (directory sites often list every member page in `sitemap.xml`) and honours **`noindex`/`nofollow`** robots meta tags and `X-Robots-Tag` headers. v2 made the README's original promise work end to end and hardens every step:

| Area | v1 | v2 |
|---|---|---|
| Data | Two spreadsheets. The campaign half used `getActive()`, which is `null` in a standalone script, so it never worked | One spreadsheet with header-mapped tables, batched writes and in-place migration of v1 data |
| Crawler | Every page queued 25 links with no depth, domain or mission limit. Pages were fetched twice. Stuck items never recovered | Page budget, depth limit, per-domain cap, same-site rule, robots.txt + crawl-delay, parallel fetching, retries with backoff, stuck-lease recovery, HTML only |
| Storage | Full page text and table JSON in cells (50k-char cell limit → failures) | Compact results; every cell write is size-safe and protected against formula injection |
| Extraction | Regex on text, Uganda-only phones | mailto/tel links, Cloudflare-protected e-mails, `[at]/[dot]` obfuscation, JSON-LD `@graph`, organisation and address heuristics, E.164 phones, junk filters, confidence score |
| Contacts | One row per sighting, duplicates everywhere | De-duplicated candidates (by e-mail, phone or organisation) with corroboration across sources |
| Consent | Stated in docs, not enforced | Review gate, lawful basis recorded on approval, eligibility enforced again at send time |
| Delivery | Empty stub, two conflicting modules | DRY_RUN / TEST / PRODUCTION, Resend batch API with idempotency, daily caps, sending window, weekends, holidays, retries, signed one-click unsubscribe (RFC 8058), bounce and complaint webhook, suppression list |
| Scheduling | Trigger every minute, forever (uses up the 90 min/day quota) | One 5-minute tick that removes itself when idle |
| Security | Anyone with the URL could start missions or use the script as an open fetch proxy | API key on every action, rate limiting, signed tokens, secrets only in Script Properties |
| UI | `styles.css` empty; no review or campaign screens | Dashboard with Overview, Missions, Review, Contacts, Campaigns and Settings |
| Quality | Syntax check only | 27 tests on a mock Apps Script runtime + duplicate-global check in CI |

## Quick start

1. **Deploy the code.** Run the *Deploy OCE Apps Script* workflow, or copy `apps-script/*` into an Apps Script project. Then run **`oceSetup()`** once from the editor. It creates or migrates the spreadsheet, removes the old v1 triggers and prints your **API key**.
2. **Publish the web app.** Go to *Deploy → Manage deployments*, edit the existing deployment, choose a new version, set *Execute as: Me* and *Who has access: Anyone*. Updating the existing deployment keeps the `/exec` URL the dashboard already uses.
3. **Open the dashboard** (GitHub Pages, `web/`). Go to Settings and paste the `/exec` URL and the API key.
4. **Start a mission**, for example *"Audit firms in Kampala, Uganda"*. Collection runs in the background every 5 minutes.
5. **Review** the candidates and approve the ones you may contact, recording the lawful basis.
6. **Campaigns**: write the message, preview it, switch `DELIVERY_MODE` to `TEST`, send yourself a test, then go to production (see [docs/delivery.md](docs/delivery.md)).

Try it locally with no Google account: `npm run dev`, then open <http://localhost:8787>. This runs the real Apps Script code in a mock runtime against a small fake website.

## Repository layout

```text
apps-script/          Google Apps Script project (one global scope; files load in name order)
  00_Config.gs        version, schema, settings, secrets
  01_Store.gs         spreadsheet + header-mapped tables with batched writes, event log
  02_Util.gs          URL canonicalisation, domains, crypto, phone/e-mail normalisation
  10_Fetcher.gs       parallel polite fetching, robots.txt, redirects, content checks
  11_Extractor.gs     page → intelligence + contact candidates, link scoring
  12_Frontier.gs      persistent crawl queue: budgets, leases, retries
  13_Worker.gs        time-boxed collection rounds
  14_Sitemaps.gs      sitemap.xml seeding (robots-declared, index + gzip, capped, paced)
  20_Discovery.gs     search providers (Brave, Bing RSS) + curated registers
  21_Missions.gs      mission lifecycle and progress
  22_Scheduler.gs     self-disabling 5-minute trigger
  30_Contacts.gs      candidate de-duplication, review gate, contacts, CSV import, suppression
  31_Campaigns.gs     segments, campaigns, audience queue, templating, unsubscribe tokens
  32_Delivery.gs      guarded sending, Resend/endpoint providers, webhooks
  40_Api.gs           authenticated JSON API for the dashboard
  41_Setup.gs         oceSetup, health check, production approval, menu
  50_Migration.gs     v1 → v2 in-place upgrade
web/                  static dashboard (GitHub Pages)
tests/                mock Apps Script runtime, test suite, local dev server
docs/                 architecture, deployment, delivery, security, operations
```

## Safety principles

- **Public sources only.** OCE never bypasses login, CAPTCHA, paywalls or access controls, and it respects robots.txt.
- **Public visibility is not consent.** Collected contacts stay `PENDING` until a person approves them and records the lawful basis.
- **Sending is off by default.** Production needs `DELIVERY_MODE=PRODUCTION`, `SEND_ENABLED=TRUE` *and* an explicit `oceApproveProduction()` run by the owner.
- **Every marketing e-mail** carries a signed one-click unsubscribe link and your postal address. Unsubscribes, hard bounces and complaints are suppressed permanently.
- **Secrets never live in Git or in the spreadsheet.**

See [docs/security.md](docs/security.md) for the compliance checklist.

## Roadmap

1. Per-site directory pagination heuristics.
2. Double opt-in campaign type (turn `LEGITIMATE_INTEREST` contacts into `CONSENT`).
3. Open and click analytics in the dashboard (the webhook already records the events).
4. Optional BigQuery/Supabase storage adapter for lists beyond ~50k rows.
