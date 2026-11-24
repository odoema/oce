# Architecture

OCE uses Google Sheets as its data layer, Google Apps Script for logic and scheduling, and a static web dashboard for operators.

```text
 Dashboard (GitHub Pages) ──HTTPS JSON (API key)──►  Apps Script web app (40_Api)
                                                          │
            ┌──────────────────────────┬─────────────────┼────────────────────┬──────────────────┐
            ▼                          ▼                 ▼                    ▼                  ▼
      21_Missions              13_Worker (tick)     30_Contacts          31_Campaigns       32_Delivery (tick)
      20_Discovery         12_Frontier 10_Fetcher   review gate          segments, render   Resend / endpoint
                                11_Extractor        suppression          unsubscribe        webhooks
            └──────────────────────────┴──────── 01_Store (one spreadsheet) ────────┴──────────────────┘
```

## Data model (one spreadsheet)

| Sheet | Purpose | Key |
|---|---|---|
| `SETTINGS` | Operator settings (non-secret) | `key` |
| `MISSIONS` | One row per mission: objective, budgets, status, counters | `mission_id` |
| `SOURCE_REGISTRY` | Every URL OCE has ever seen, with scan stats | `canonical_url` |
| `SOURCE_QUEUE` | Crawl frontier per mission | `queue_id`; unique (`mission_id`, `canonical_url`) |
| `SOURCE_RESULTS` | One compact row per fetch (no full page bodies) | `result_id` |
| `CANDIDATES` | De-duplicated contact evidence awaiting review | `dedupe_key` (`e:` e-mail, `p:` phone, `o:` organisation\|site) |
| `CONTACTS` | Approved/imported audience with lawful basis and consent | `email` |
| `SEGMENTS` | Audience rules; rows with the same `segment_id` are combined with AND | `segment_id` |
| `CAMPAIGNS` | Content, sender, schedule, counters | `campaign_id` |
| `SEND_QUEUE` | One row per (campaign, contact) | `send_id` |
| `SEND_LOG` | Delivery and lifecycle events (SENT, SIMULATED, BOUNCED…) | — |
| `SUPPRESSION` | Permanent do-not-contact list | `email` |
| `HOLIDAYS` | Dates with no sending | `date` |
| `EVENTS` | Operational log shown in the dashboard | — |

Tables are addressed by **header name**, not column position, so you can add or reorder columns in the sheet. Each execution reads a table once, changes it in memory and writes it back with as few `setValues` calls as possible.

## Collection

1. **Discovery** is free and keyless by default. It reads matching Wikipedia "List of …" pages and Wikidata (official websites of organisations in the country), adds curated registers for the geography, and tries Bing RSS. Results are cached for 6 hours. A Brave API key is optional, never required. It ranks the results (public-sector, directory and topic signals; social and news sites demoted) and adds curated registers that match the geography. Each site contributes at most two seeds.
2. **Frontier.** URLs are canonicalised (tracking parameters, fragments, default ports and `index.*` removed; pagination kept) and queued once per mission. The page budget, depth limit, per-domain cap and same-site rule are enforced when a URL is queued.
3. **Worker.** Each tick runs time-boxed rounds. A round leases up to `CRAWL_BATCH_SIZE` URLs (one per host per round, `CRAWL_PER_HOST_PER_TICK` per tick, one per tick for hosts with a robots crawl-delay of 5 s or more), fetches them in parallel and follows redirects itself, re-checking each hop. It extracts the page, saves the result and candidates, scores outgoing links and saves everything to the sheet.
4. **Sitemaps.** When a seed page is collected, OCE also reads that site's sitemaps (declared in robots.txt, otherwise the standard paths), up to 12 files and 100 URLs per site. The best 40 URLs are queued at depth 1, once per site per mission.
5. **Failures.** 429 and 5xx responses and timeouts retry after 5, 30 and 180 minutes. 401/403/451, login walls and bot challenges are marked `BLOCKED`. Non-HTML responses are `SKIPPED`. If an execution is killed mid-round, its leases expire after 10 minutes and the URLs are queued again.

## Contact pipeline

`CANDIDATES (PENDING)` → operator review → `CONTACTS` with `lawful_basis` and `consent_status` → eligibility check (again at send time) → `SEND_QUEUE`.

A contact is eligible when it is `ACTIVE`, not on the suppression list, and has `consent_status=YES`, or has `lawful_basis=LEGITIMATE_INTEREST` while `ALLOW_LEGITIMATE_INTEREST=TRUE`.

## Scheduling

A single trigger, `oceTick`, runs every 5 minutes. Each tick collects pages if a mission is running, then delivers if a campaign is active. If neither has work, the trigger deletes itself. Starting a mission or activating a campaign recreates it.

## Limits worth knowing

- Apps Script consumer accounts allow 90 trigger-minutes per day and 20,000 URL fetches per day. Workspace accounts allow 6 hours per day and 100,000 fetches.
- A spreadsheet holds 10 million cells. Because OCE stores compact rows, that is roughly 100k–150k queue/result rows in total. Archive old missions' rows when they pile up.
