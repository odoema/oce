# OCE Public Source Collector

The collector provides a controlled public-page discovery layer for OCE.

## Deployment

1. Add `apps-script/UrlScraper.gs` to the same Google Apps Script project as OCE.
2. In Apps Script Project Settings → Script properties, create `OCE_SCRAPER_TOKEN` with a long random value. Never put this value in GitHub.
3. Deploy the Apps Script project as a Web app.
4. Keep the web-app URL private until the collector has been tested.
5. Open the OCE Pages UI and enter the Web App URL and token in the session fields.
6. Scan a public URL and review the result.

## Security model

- HTTP/HTTPS only.
- Localhost, loopback, private IPv4 ranges and link-local targets are blocked.
- Redirects are followed only after the destination is validated.
- Response size is bounded.
- The endpoint requires the script token.
- The UI does not contain a permanent token.
- No login, CAPTCHA, paywall or access-control bypass is implemented.
- Public discovery does not establish marketing consent.

## Source policy

A source can be scanned when its content is publicly accessible and the operator is authorized to use the information for the intended purpose. Robots policies, site terms, privacy requirements and applicable law must be reviewed before operational collection.

MAKORA and other sites can therefore be handled by the same collector when they are brought into scope; no source-specific bypass is required or intended.

## Current boundary

The current Apps Script collector is a preview/discovery endpoint. The final approved-record import action should remain behind the same authenticated endpoint and must write only to the OCE IMPORT sheet, defaulting new records to `NO` consent. Production campaign eligibility remains controlled by the existing OCE consent and suppression gates.
