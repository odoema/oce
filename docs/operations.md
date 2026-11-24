# Operations runbook

## Daily routine

1. **Overview:** check the KPIs and Recent activity (errors appear in red).
2. **Review:** approve or reject new candidates. Sort by confidence; anything below `MIN_CANDIDATE_CONFIDENCE` lands in *Low quality*.
3. **Campaigns:** check pending, sent and failed counts and the delivery banner.

## Useful editor functions

| Function | Use |
|---|---|
| `oceSetup()` | Install, repair or upgrade. Safe to run repeatedly |
| `oceHealthCheck()` | What is configured and what is missing |
| `oceShowApiKey()` / `oceRotateApiKey()` | Dashboard access |
| `oceApproveProduction()` / `oceRevokeProduction()` | Production delivery gate |
| `oceMenuRunWorker()` | Collect for about 1 minute now |
| `oceMenuRunDelivery()` | Run one delivery pass now |
| `oceMenuEnableAutomation()` / `oceMenuDisableAutomation()` | Scheduler trigger |

## Troubleshooting

| Symptom | Likely cause → fix |
|---|---|
| Dashboard: *Unauthorized* | Wrong API key. Run `oceShowApiKey()` |
| Dashboard: *did not return JSON* | Wrong URL, or the web app is not deployed for *Anyone*. Redeploy a new version |
| Mission finds few sources | No search key. Add `OCE_SEARCH_API_KEY` (Brave), or add starting URLs under *Options* |
| Many `BLOCKED` pages | The site disallows crawlers or requires login. This is respected by design |
| Mission ends quickly | Page budget or depth reached. Raise `max_pages` or `max_depth` on a new mission |
| Collection stalls | Run `oceHealthCheck`. Check that automation is on and `CRAWL_ENABLED=TRUE`, and look in *Executions* for quota errors |
| `Service invoked too many times` | Daily UrlFetch or trigger quota reached. Lower `CRAWL_BATCH_SIZE` or the page budgets |
| Campaign auto-paused | The campaign's `notes` explain why (missing sender, postal address or web app URL) |
| Sends stuck in `PENDING` | Outside the sending window, weekend, holiday, daily limit reached or production not approved (see the Campaigns banner) |

## Housekeeping

- `SOURCE_RESULTS` and `EVENTS` grow fastest. Archive or delete rows older than 90 days now and then.
- Finished missions can be left as they are. Their queue rows are what de-duplicate future crawls within the same mission only.
