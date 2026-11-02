# OCE Architecture

OCE (Odoch Campaign Engine) uses Google Sheets as the operational data layer and Google Apps Script as the orchestration layer.

## Source discovery and collection flow

```text
Seed URLs / reviewed discovery
        ↓
Source Scout V1
        ↓
Normalize + Deduplicate + Priority Score
        ↓
SOURCE_REGISTRY
        ↓
SOURCE_QUEUE
        ↓
Existing CollectorGateway / UrlScraper
        ↓
Source Intelligence
        ↓
Contact Intelligence
        ↓
Review / Consent Gate
        ↓
IMPORT → CONTACTS
```

The Source Scout is a discovery block. It does not grant marketing consent and does not automatically send campaigns.

### Source Registry

`SOURCE_REGISTRY` is the persistent catalogue of discovered public sources. It keeps a stable `source_id`, canonical URL, domain, provenance, priority, scan status and queue status so OCE can remember sources across discovery runs.

### Source Queue

`SOURCE_QUEUE` is the controlled work queue for source collection. Queue states are designed around:

`QUEUED → SCRAPING → COMPLETED`

with controlled exits such as `FAILED` and `BLOCKED`.

The queue is deliberately separate from the campaign `QUEUE` so source collection and marketing delivery cannot become accidentally coupled.

## Contact and campaign flow

1. Authorized/consented contact data enters `IMPORT`.
2. OCE normalizes email and Uganda phone formats.
3. Consent and suppression checks run before a record enters `CONTACTS`.
4. `SEGMENTS` defines targeting rules.
5. `CAMPAIGNS` defines message content and scheduling policy.
6. `QUEUE` creates campaign batches, defaulting to 250 contacts per batch.
7. `HOLIDAYS` and sending-window rules prevent inappropriate dispatch times.
8. `SEND_LOG` records delivery outcomes.
9. `DASHBOARD` exposes operational counts.

## Safety boundary

Source discovery and public collection must remain limited to public/authorized pages. OCE must not bypass login controls, CAPTCHAs, paywalls, access controls or collect private data indiscriminately. Public visibility does not establish marketing consent.

## Delivery boundary

V1.1 deliberately does not send email. A production delivery adapter must be connected and tested before `SEND_ENABLED` is turned on.

The adapter should:
- use a legitimate transactional/marketing email provider;
- send only to contacts with appropriate consent;
- process unsubscribe and bounce events;
- write provider message IDs and outcomes to `SEND_LOG`;
- update suppression records for hard bounces and unsubscribes;
- respect provider rate limits and sending policies.
