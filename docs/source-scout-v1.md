# OCE Source Scout V1

## Purpose

Source Scout is a separate LEGO block around the stable OCE public URL collector. Its job is to discover and organize candidate public URLs; it does not replace or modify the URL scraper.

## Flow

```text
Seed URLs
   ↓
Existing OCE Collector
   ↓
Discovered labelled links
   ↓
URL normalization
   ↓
Duplicate removal
   ↓
Priority scoring
   ↓
Local source queue
   ↓
Manual/controlled collection
```

## V1 behavior

- Accepts one or more public HTTP/HTTPS seed URLs.
- Uses the existing collector endpoint to inspect each seed.
- Discovers one link level from each seed.
- Removes fragments, query strings, duplicates, and obvious static assets.
- Can restrict discovery to the seed domains.
- Scores candidate URLs using topic terms and useful source-path indicators such as `contact`, `about`, `directory`, `members`, `supplier`, and `organization`.
- Caps a scouting run at 100 new sources.
- Stores the queue in the current browser's local storage.
- Exports the queue as JSON.
- Does not automatically scrape the discovered queue.
- Does not import contacts or grant marketing consent.

## Why V1 is intentionally local

The first Scout release avoids introducing another backend or database while the collector is being stabilized. This keeps the working `UrlScraper.gs` unchanged and makes the new block easy to test and remove independently.

The next evolution can move the queue into the OCE workbook or a dedicated source registry once the discovery rules are proven.

## Safety boundaries

Source Scout must not:

- bypass login or access controls;
- bypass CAPTCHAs or paywalls;
- harvest credentials;
- treat public visibility as marketing consent;
- automatically send campaigns;
- recursively crawl without explicit limits.

## Future versions

### V1.1

- durable source registry;
- queue status lifecycle;
- retry policy;
- scan history;
- domain-level rate limits;
- sitemap discovery where appropriate.

### V2

A reviewed search/discovery provider can be added as another discovery adapter:

```text
Search Adapter ─┐
Directory Adapter ─┼→ Source Registry → Scrape Queue → OCE Collector
Sitemap Adapter ──┘
Manual Seeds ─────┘
```

The user experience should remain simple even as the internal discovery system becomes more capable.
