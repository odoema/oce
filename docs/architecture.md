# OCE Architecture

OCE (Odoch Campaign Engine) uses Google Sheets as the operational data layer and Google Apps Script as the orchestration layer.

## Flow

1. Authorized/consented contact data enters `IMPORT`.
2. OCE normalizes email and Uganda phone formats.
3. Consent and suppression checks run before a record enters `CONTACTS`.
4. `SEGMENTS` defines targeting rules.
5. `CAMPAIGNS` defines message content and scheduling policy.
6. `QUEUE` creates campaign batches, defaulting to 250 contacts per batch.
7. `HOLIDAYS` and sending-window rules prevent inappropriate dispatch times.
8. `SEND_LOG` records delivery outcomes.
9. `DASHBOARD` exposes operational counts.

## Delivery boundary

V1.1 deliberately does not send email. A production delivery adapter must be connected and tested before `SEND_ENABLED` is turned on.

The adapter should:
- use a legitimate transactional/marketing email provider;
- send only to contacts with appropriate consent;
- process unsubscribe and bounce events;
- write provider message IDs and outcomes to `SEND_LOG`;
- update suppression records for hard bounces and unsubscribes;
- respect provider rate limits and sending policies.
