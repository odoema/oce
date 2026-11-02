# OCE Source Intelligence — Phase 2

Source Intelligence is the second OCE LEGO block after the working public Source Collector.

## Flow

`URL → Scan → Source Intelligence → Review → Consent Gate → Import`

## Current implementation

The browser builds a review-only intelligence layer from the collector response. It can identify:

- organization/business name from JSON-LD or page title
- structured-data types
- public website URL
- public address when supplied as structured data
- email indicators
- telephone indicators
- likely contact/about/location pages
- collection timestamp
- source URL
- consent state, always defaulting to `NO_CONSENT`

## Safety boundary

Source visibility does not equal permission to market. Discovery does not automatically create a marketing contact, subscribe a person, or send a campaign.

The next controlled block is normalization and explicit review/import into `IMPORT` and `CONTACTS`.

## Deployment

The Source Intelligence UI is part of the GitHub Pages frontend. It consumes the existing collector endpoint and therefore does not require a new backend deployment for the first phase of this block.
