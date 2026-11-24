# Tests

The Apps Script code runs unchanged inside a mock runtime (`gas-runtime.js`). It provides in-memory `SpreadsheetApp` (with the 50k cell limit enforced), `UrlFetchApp` with programmable routes, `PropertiesService`, `CacheService`, `LockService`, `ScriptApp` triggers and `Utilities` crypto and date functions.

```bash
npm test        # node --test tests/oce.test.js
npm run check   # every file parses; no duplicate globals across .gs files
npm run dev     # http://localhost:8787 — dashboard + real backend + fake demo website
```

The suite covers:

- URL canonicalisation and the public-host guard
- Phone and e-mail normalisation
- Extraction: mailto, Cloudflare, obfuscated addresses, JSON-LD, junk filtering
- Organisation names from titles and city detection
- robots.txt groups, wildcards and crawl-delay
- A full mission: budget, depth, robots, social/asset/login exclusion, 503 retry, de-duplication across pages, completion, trigger self-disable
- Recovery of stale leases
- Login walls, challenges, non-HTML and 403 pages
- The 50k cell limit and formula injection
- The review gate and lawful-basis eligibility
- Segments and DRY_RUN with no network calls
- Production gating, Resend batching, idempotency, 429 retry and daily limit
- Sending window, weekends and holidays
- Signed unsubscribe (GET and RFC 8058 POST); tampering rejected; opt-outs cannot be reactivated
- Resend bounce and complaint webhooks
- CSV consent rules
- API authentication and POST-only writes; secret values never returned
- Discovery ranking, deny-list and site diversity
- v1 → v2 migration
- Politeness: per-host spacing (1 s or Crawl-delay) and per-tick caps

When the real Apps Script services behave differently from the mock (for example quotas or exact `fetchAll` error semantics), the code handles both: see the `fetchAll` fallback in `10_Fetcher.gs`.
