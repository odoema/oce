# Delivery

## Modes

| `DELIVERY_MODE` | What happens |
|---|---|
| `DRY_RUN` (default) | Active campaigns are rendered and logged as `SIMULATED`. Nothing leaves Google. |
| `TEST` | Automatic sending is off. **Send test to me** e-mails up to 3 rendered samples to `OCE_TEST_RECIPIENT`. |
| `PRODUCTION` | Real sending, but only if all of these hold: `SEND_ENABLED=TRUE`, `oceApproveProduction()` has been run, the provider is configured, the campaign has a sender and a postal address, and the web app URL is known (for unsubscribe links). |

## Go-live checklist

1. Verify your sending domain in Resend (SPF and DKIM; add DMARC at least `p=none`).
2. Set Script Properties `RESEND_API_KEY` and `OCE_TEST_RECIPIENT`.
3. In Settings, set `DEFAULT_FROM_EMAIL` (on the verified domain), `DEFAULT_FROM_NAME`, `DEFAULT_REPLY_TO` and `SENDER_POSTAL_ADDRESS`.
4. Set `DAILY_SEND_LIMIT` to your plan's allowance (the Resend free plan allows 100 per day). Note that other apps using the same Resend account, such as the MBA reminders, share that quota.
5. In Resend, add a webhook for `email.delivered`, `email.bounced`, `email.complained`, `email.opened` and `email.clicked` pointing to
   `<your /exec URL>?action=webhook&provider=resend&key=<OCE_WEBHOOK_KEY>`.
6. Set `DELIVERY_MODE=TEST`, open the campaign and choose **Send test to me**. Check the rendering, the links and the unsubscribe link (use a second address for that).
7. Run `oceApproveProduction()` in the editor, then set `DELIVERY_MODE=PRODUCTION` and `SEND_ENABLED=TRUE`.
8. Activate the campaign. Each tick sends up to `SEND_BATCH_SIZE` messages inside the sending window, within the daily limit and the campaign's `daily_cap`.

To stop everything immediately, set `SEND_ENABLED=FALSE` or run `oceRevokeProduction()`.

## Personalisation

Placeholders: `{{first_name}}`, `{{last_name}}`, `{{full_name}}`, `{{organization}}`, `{{role}}`, `{{location}}`, `{{country}}`, `{{email}}`, `{{sender_name}}`, `{{sender_address}}`, `{{unsubscribe_url}}`. A fallback goes after a pipe: `{{first_name|there}}`. Values are HTML-escaped. If the body does not contain `{{unsubscribe_url}}`, OCE appends a footer with the unsubscribe link and your postal address.

## What OCE handles for you

- **Idempotency:** each Resend batch carries an `Idempotency-Key` derived from its send IDs, so a retried request cannot send twice.
- **Retries:** 429 and 5xx responses and network errors retry after 10, 60 and 360 minutes. Validation errors fail immediately and are logged.
- **Unsubscribe:** `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers (RFC 8058, which Gmail and Yahoo require for bulk senders), plus a visible link. Tokens are HMAC-signed, so they cannot be forged or edited.
- **Suppression:** unsubscribes, hard bounces and complaints are added to `SUPPRESSION`, pending sends to those addresses are cancelled, and the address can never be reactivated from the dashboard.
- **Eligibility at send time:** a contact that changed after it was queued (unsubscribed, consent withdrawn) is skipped.

## Own relay (`DELIVERY_PROVIDER=ENDPOINT`)

OCE POSTs `{version, campaign_id, messages:[{idempotency_key, from, to, reply_to, subject, html, text, headers}]}` with the header `X-OCE-Token: <OCE_DELIVERY_TOKEN>`. It expects `{results:[{idempotency_key, result: SENT|ACCEPTED|RETRY|FAILED, provider_message_id, message}]}` in return.
