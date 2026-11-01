# Resend Provider Adapter

OCE V1.2 introduces a provider-neutral delivery boundary with Resend as the first production adapter.

## Design

Google Apps Script remains the campaign control plane. The delivery provider is responsible only for delivery and provider-side lifecycle events.

```text
Google Sheet
   |
   v
OCE campaign + queue
   |
   v
Delivery Adapter
   |
   v
Resend
   |
   +--> delivered / bounced / complained / failed
   |
   v
OCE SEND_LOG + SUPPRESSION
```

## Safety

- `SEND_ENABLED` remains `FALSE` until the operator completes validation.
- Only contacts with explicit consent are eligible.
- Suppressed and unsubscribed contacts must never be queued.
- Provider credentials must never be stored in GitHub or in spreadsheet cells.
- The application batch size is 250, but provider quotas and rate limits remain authoritative.
- Production marketing messages must contain a clear unsubscribe mechanism.

## Resend integration boundary

The Apps Script adapter should call a small external delivery endpoint rather than embedding provider secrets in Apps Script source. The endpoint can be hosted as a protected serverless function and supplied through a secret-managed deployment.

The adapter contract is:

```text
sendBatch(campaign, recipients) -> provider message identifiers + per-recipient result
recordLifecycleEvent(event) -> update SEND_LOG / SUPPRESSION
```

The first implementation should support:

1. dry-run mode;
2. one-recipient test mode;
3. provider delivery;
4. idempotency keys;
5. retry with bounded backoff;
6. bounce/complaint suppression;
7. unsubscribe processing;
8. provider response logging without storing secrets.

## Current account check

The connected Resend account currently has an active sending configuration and one configured domain. OCE should not assume that the configured sender is suitable; the operator must choose a verified sender address before production activation.
