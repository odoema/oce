# Security and compliance

OCE supports **permission-based** marketing. Its software controls make compliant use the easy path, but they do not replace your legal obligations. Check the rules where your recipients are. In Uganda that means the *Data Protection and Privacy Act, 2019* and its 2021 Regulations, including registration with the PDPO. Many recipients will also fall under GDPR, CAN-SPAM, Kenya's DPA and similar laws.

## Collection controls (enforced in code)

- Only public HTTP/HTTPS pages. Private, local and metadata hosts are blocked.
- robots.txt is honoured by default (`RESPECT_ROBOTS`), including `Crawl-delay`. So are robots meta tags and `X-Robots-Tag`: `noindex` pages yield no contact data, and links on `nofollow` pages are not followed.
- Login walls, HTTP 401/403/451 and bot challenges are recorded as `BLOCKED` and never retried around.
- Social networks are excluded from crawling. Per-host politeness limits apply.
- OCE identifies itself honestly: `User-Agent: OCE-PublicCollector/2.0`.

## Consent and lawful basis (enforced in code)

- Collected data is **evidence**: `consent_status=NOT_ESTABLISHED`, `review_status=PENDING`.
- Approval records a `lawful_basis` (`CONSENT`, `LEGITIMATE_INTEREST`, `CONTRACT`, `NONE`). Recording `CONSENT` requires a `consent_source`, meaning where and how consent was given.
- `LEGITIMATE_INTEREST` (B2B outreach to role addresses) is **off by default** (`ALLOW_LEGITIMATE_INTEREST=FALSE`). Turn it on only after a documented balancing test, and keep messages relevant to the recipient's professional role.
- CSV imports never upgrade consent silently: a blank consent column leaves existing consent unchanged.
- Opt-outs (unsubscribe, hard bounce, complaint, manual) are permanent and are checked again at send time.

## Application security

- Every API action except `health` and `unsubscribe` requires `OCE_API_KEY`, compared in constant time and rate-limited per minute. Webhooks require `OCE_WEBHOOK_KEY`.
- Unsubscribe links carry `base64url(email|campaign).HMAC-SHA256` signed with `OCE_SIGNING_SECRET`.
- Secrets live only in Script Properties. The dashboard API can report whether a secret is set, never its value.
- Scraped text is escaped in the dashboard. Spreadsheet cells are protected against formula injection (`=`, `+`, `-`, `@`) and capped below the 50k-character cell limit.
- The dashboard keeps the API key in the operator's browser storage. Use a trusted device and *Forget on this device* on shared machines, and rotate the key with `oceRotateApiKey()` if it is exposed.

## Repository hygiene

- No live contact data, exports or keys in Git. CI refuses common secret file names and Resend or Brave key patterns.
- Consider making the repository private. The code is safe to publish, but your operational choices (catalogue, objectives) may not be.
