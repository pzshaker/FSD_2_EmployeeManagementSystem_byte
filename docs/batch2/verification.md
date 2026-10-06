# Batch 2 verification — 6 October 2026

## Result and design references

Employee creation and editing use the existing POST/PATCH APIs with JSON and an in-memory CSRF token. Delete remains disabled for Batch 3. No backend, schema, dependency, or development-data changes were made.

Inspected the connected [Figma file](https://www.figma.com/design/iod7P6nbE7SuZWxqV6mmFk) through MCP design context and reference screenshots for frames 03, 04, 09, 10, 12, 18, 19, 21, 24, and 25. Matched the 666 px desktop dialog, two-column grid, 40 px side padding, labels/fields, hints/errors, metadata and footer; mobile forms use single columns and a bottom action bar. Creation/update confirmations retain their separate wording and dimensions. New employees appear first in mobile cards; desktop preserves API order.

Existing directory differences from Figma (toolbar, subtitle, card detail layout and avatar palette) remain unchanged. Fonts retain Batch 1's permitted system fallback when Inter is unavailable. Form focus outlines are intentional accessibility states absent from the static mock.

## Checks run

`npm test` with the existing bundled Playwright module enabled: **19 passed, 0 failed, 0 skipped** (7 existing checks, 11 browser scenarios, and their parent browser test). `node --check public/app.js` and `node --check test/employee-forms.test.js` pass. Without optional browser tooling enabled, the 7 server tests pass and the browser test is explicitly skipped.

The browser suite starts an isolated Express server on a dynamically allocated loopback port with an in-memory SQLite database and disposable administrator. The server, browser and database close in `finally`. It never reads `.env`, opens development records, runs account setup against the development database, or seeds development data.

1. **Real API saves:** desktop/mobile create and edit; trimmed text and lowercase email; JSON/CSRF request headers; updated count and refreshed records; stable ID/creation date; safe rendering of HTML-looking text; empty-directory Add; no DELETE requests.
2. **Validation and failures:** whitespace-only values for each required field, invalid email, Unicode length limits at 100/101 and email at 254/255; real duplicate email and missing-record responses; controlled 400/403/413/415/429/500, aborted network requests and malformed success responses. Failed saves retain values, restore controls and do not display success. Arbitrary error-body text is not displayed.
3. **Session and request recovery:** actual expired session returns to login and restores the draft after reauthentication; token retrieval after reload; genuine stale-token rejection followed by an explicit successful retry; no localStorage/sessionStorage use. A failed logout from the mobile editor keeps feedback visible and values intact.
4. **Pending and refresh races:** duplicate submission and Escape dismissal blocked during a held write; confirmed save distinguished from a failed list refresh; delayed pre-save list response cannot overwrite the post-save list.
5. **Responsive/accessibility:** 1440×960 desktop, 390×844 mobile, 320×568 narrow layout and 390×500 reduced viewport. Checked native dialog background isolation, Tab/Shift+Tab, first-invalid-field focus, Escape focus restoration, visible controls, no narrow horizontal overflow, final field above the footer, reduced-motion CSS and loaded avatar geometry. Native dialog navigation may move to browser chrome but does not focus the background page.

## Re-run browser regression checks

Use an existing Playwright installation and installed Chrome. No package was added to this project. On this workstation, the verification command was:

```powershell
$env:BYTE_PLAYWRIGHT_MODULE = 'C:/Users/Philopateer.Zaki/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
$env:BYTE_SCREENSHOTS = 'docs/batch2'
npm test
node --check public/app.js
node --check test/employee-forms.test.js
```

On another machine, set `BYTE_PLAYWRIGHT_MODULE` to that machine's Playwright `index.mjs`. `BYTE_SCREENSHOTS` is optional. The suite lives in `test/employee-forms.test.js` and does not require a running development server.

## Screenshot evidence

Screenshots contain disposable test records and are captured at viewport size. Tests deliberately exercise long/Unicode records; sample names, counts and dates differ from Figma's mock data.

| State | Desktop | Mobile |
|---|---|---|
| Add form | [Desktop](add-desktop.png) | [Mobile](add-mobile.png) |
| Edit form | [Desktop](edit-desktop.png) | [Mobile](edit-mobile.png) |
| Duplicate email | [Desktop](duplicate-desktop.png) | [Mobile](duplicate-mobile.png) |
| Save failure | [Desktop](failure-desktop.png) | [Mobile](failure-mobile.png) |
| Confirmed create/update | [Created](created-desktop.png), [Updated](saved-desktop.png) | [Created](created-mobile.png), [Updated](saved-mobile.png) |

[320 px validation and scrolling](validation-320.png).

## Remaining limits

Chrome was tested with resized browser viewports, not a physical phone keyboard, iOS/Safari or a screen reader. The form uses dynamic viewport sizing, `visualViewport` resize/scroll handling and safe-area padding; actual device keyboard behavior remains unverified. Drafts intentionally disappear on page reload. Delete is intentionally unimplemented in the frontend until Batch 3. Deployment and submission remain separate work.
