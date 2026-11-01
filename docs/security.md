# Security and Compliance

OCE is designed for authorized contact data and permission-based marketing.

## Required controls

- Do not bypass authentication, access controls, robots restrictions, paywalls, CAPTCHAs, or technical barriers when collecting data.
- Do not collect private personal information without a lawful and appropriate basis.
- Prefer first-party opt-in forms, customer-provided lists, and permitted APIs.
- Keep `SEND_ENABLED` off until delivery controls are verified.
- Maintain a suppression list and honor unsubscribe requests promptly.
- Protect API keys and service credentials outside Git.
- Keep live contact data out of GitHub.
- Log campaign and delivery outcomes without unnecessarily storing sensitive content.
- Follow applicable email, privacy, and data-protection requirements for the jurisdictions where recipients are located.

## Public repository warning

OCE should preferably be stored in a **private GitHub repository** while it is under active development. If the repository is public, do not place secrets or real contact data in it.
