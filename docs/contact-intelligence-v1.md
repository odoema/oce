# OCE Contact Intelligence V1

## Purpose

Contact Intelligence is the next LEGO block after public source collection and source intelligence.

Its job is to identify **public contact candidates** and preserve enough provenance for a human to review them before any import or campaign use.

## Pipeline

```text
Public URL
  -> Source Collector
  -> Source Intelligence
  -> Contact Indicators
  -> Normalization
  -> Evidence + Confidence
  -> Human Review
  -> Controlled Import
```

## Candidate types

V1 identifies:

- Email addresses
- Telephone numbers
- Contact-page links

Signals may come from:

- `mailto:` links
- `tel:` links
- visible page text
- JSON-LD `email`
- JSON-LD `telephone`
- JSON-LD `contactPoint`

## Provenance

Every contact candidate keeps:

- `kind`
- `normalized`
- `source`
- `confidence`
- `source_url`
- `consent_status`
- `review_status`

The evidence source is deliberately visible in the review table. This makes the system auditable and makes it easier to reject weak matches.

## Consent rule

A public contact indicator is **not** marketing consent.

All discovered candidates remain:

```text
consent_status = NO_CONSENT
review_status = PENDING
```

No automatic campaign import is performed by this block.

## Normalization

Email addresses are trimmed and lower-cased.

Ugandan mobile numbers are normalized to `+256...` where the number can be confidently recognized as a Ugandan mobile number. Other telephone values are cleaned without inventing a country code.

## Confidence

- **HIGH** — explicit `mailto:`, `tel:`, or structured JSON-LD contact field
- **MEDIUM** — matching contact pattern found in visible page text

Confidence is a review aid, not proof of identity or consent.

## Safety boundaries

The collector remains limited to public/authorized pages. It must not bypass:

- authentication
- CAPTCHAs
- paywalls
- access controls
- anti-bot restrictions

HTTP 401/403/429 and server errors are surfaced as source conditions rather than bypassed.

## Next block

The next LEGO block is **Controlled Review & Import**. It should provide explicit approval, duplicate checks, provenance preservation, consent handling, and a controlled hand-off into `IMPORT` without automatically sending campaigns.
