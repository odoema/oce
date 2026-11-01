# OCE Public Source Collector

The collector is LEGO Block 1 of OCE: a controlled public-page discovery layer.

## Operator experience

The intended experience is deliberately simple:

**URL → Scan → Results**

The operator should not be asked for an Apps Script URL, backend token, deployment setting or other infrastructure detail.

## Architecture

The public GitHub Pages interface is only the presentation layer. Backend configuration and secrets belong to the infrastructure layer.

Current flow:

`OCE Pages UI → Collector Gateway → Public webpage → Structured preview`

The Collector Gateway is responsible for connecting the public UI to the Apps Script collector or a future dedicated collector service. A browser-facing secret must never be placed in `web/app.js` or another public GitHub Pages asset.

## Collector safeguards

- HTTP/HTTPS only.
- Localhost, loopback, private IPv4 ranges and link-local targets are blocked.
- Redirects are followed only after the destination is validated.
- Response size is bounded.
- No login, CAPTCHA, paywall or access-control bypass is implemented.
- Public discovery does not establish marketing consent.
- Source URL and collection time are retained as provenance.
- New discovered contacts must remain outside campaign eligibility until they pass the OCE consent and suppression controls.

## Deployment boundary

The current Apps Script implementation still uses `OCE_SCRAPER_TOKEN` as its backend authentication mechanism. That secret must remain in Apps Script Script Properties and must never be copied into the public UI.

Before the simplified Pages UI is connected to a live production collector, deploy a Collector Gateway that can authenticate to the backend without exposing a secret to the browser. The gateway may initially be a small controlled service and can later be replaced without changing the operator experience.

## Source policy

A source can be scanned when its content is publicly accessible and the operator is authorized to use the information for the intended purpose. Robots policies, site terms, privacy requirements and applicable law must be reviewed before operational collection.

MAKORA and other sites can be handled by the same collector when they are brought into scope; no source-specific bypass is required or intended.

## Current boundary

This block is for discovery and review. Approved-record import remains a separate controlled step and must write only to the OCE `IMPORT` layer, defaulting new records to `NO_CONSENT`. Production campaign eligibility remains controlled by the existing OCE consent and suppression gates.
