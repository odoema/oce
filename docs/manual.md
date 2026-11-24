# Keeping the in-app guide up to date

The guide users see at **Help & guide** (`web/help.html`) is drawn from one data file: `web/manual.js`.
Edit that file; never hard-code guide text in `help.html` or `help.js`.

## When CI fails on `tests/manual.test.js`

The test fails on purpose when the app and the guide drift apart. The message names what to fix:

| Message | What changed | Fix in `web/manual.js` |
| --- | --- | --- |
| `web/manual.js version` | You bumped the app version | Set `version` and `updated` |
| `whatsNew[x.y.z]` | New version with no release notes for users | Add 1–3 plain sentences under `whatsNew['x.y.z']` (and a `## x.y.z` section in `CHANGELOG.md`) |
| `dashboard tab "x" has no chapter` | A new tab in the sidebar | Add a chapter with `covers: ['x']` |
| `renamed or removed in the dashboard: …` | A button, field or column label changed | Update the label in `mockScreens` and the chapter's `ui`, and the step text that mentions it |
| `settings missing from the guide` / `no longer exist` / `default differs` | `OCE_DEFAULT_SETTINGS` changed | Add, remove or correct the row in `settings` |
| `stale ?v=` | Version bump missed a cache stamp | Update `?v=` in `index.html` and `help.html` |

## Releasing a version (checklist)

1. Bump the version in `apps-script/00_Config.gs` (two places), `package.json`, the `?v=` stamps in `web/index.html` and `web/help.html`, and `web/manual.js`.
2. Add a `## x.y.z` section to `CHANGELOG.md` (for developers) and `whatsNew['x.y.z']` to `web/manual.js` (for users, plain words).
3. If you added or renamed anything a user clicks, update the matching chapter: its steps, `mockScreens` labels and tips.
4. `npm test` must pass. Merge, then run **Actions → Deploy OCE Apps Script**. The guide itself goes live with GitHub Pages on merge.

## Writing style

Short sentences, the words on the buttons in the dashboard, Kampala time, no jargon. Each step = one action. Tips = what people get wrong.
