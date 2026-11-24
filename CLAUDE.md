# Notes for AI assistants working on OCE

- The user guide lives in `web/manual.js` (rendered by `web/help.html`). Any change a user can see — a button, field, tab, setting, default or workflow — must update `web/manual.js` in the same change. `npm test` (tests/manual.test.js) fails until it does. See `docs/manual.md`.
- Releases: bump the version everywhere listed in `docs/manual.md`, add `CHANGELOG.md` and `whatsNew` entries.
- Never commit keys. Secrets live in Apps Script Script Properties.
