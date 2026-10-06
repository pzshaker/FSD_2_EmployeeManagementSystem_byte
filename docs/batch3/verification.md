# Batch 3 deletion verification — 6 October 2026

## Result

Desktop rows and mobile cards now support deletion through the existing bodyless DELETE API with an in-memory CSRF token. A confirmed `204` removes the record and updates directory counts; no optimistic removal or success occurs. Pending requests block repeat submission and dismissal. Failed requests retain the prompt and selected identity, except session expiry: sign-in restores the selection in memory and requires explicit confirmation again.

Inspected connected Figma MCP design context and screenshots for [05 — Delete confirmation](https://www.figma.com/design/iod7P6nbE7SuZWxqV6mmFk?node-id=4-525), [13 — Directory / Employee deleted](https://www.figma.com/design/iod7P6nbE7SuZWxqV6mmFk?node-id=13-392), [20 — Delete confirmation / Mobile](https://www.figma.com/design/iod7P6nbE7SuZWxqV6mmFk?node-id=21-160), and [22 — Directory / Employee deleted / Mobile](https://www.figma.com/design/iod7P6nbE7SuZWxqV6mmFk?node-id=21-250). Downloaded the 48×48 desktop warning SVG through Figma MCP and verified its local file, loaded image and rendered geometry.

The desktop dialog is 620 px wide at x=510/y=324 in a 1440×960 viewport. The mobile sheet has 12 px side margins, an 18 px bottom inset and a 332 px minimum height at 390×844, reduced for short viewports. Warning colors, action labels, rounded corners and success feedback follow the reference frames. Required employee email and failure feedback can expand the prompt; overflowing content scrolls. Existing directory toolbar, subtitle, card details, avatar palette and system-font fallback remain unchanged from earlier batches.

## Checks run

`npm test` with the existing Playwright module enabled: **27 passed, 0 failed, 0 skipped**. This includes the server checks, the existing create/edit browser suite, and seven deletion scenarios. `node --check` passes for `public/app.js`, `test/employee-deletion.test.js`, `test/employee-forms.test.js`, and `test/frontend.test.js`. The optional deletion suite was also run separately to capture its screenshots.

1. **Confirmed deletion and cancellation:** real API deletion, no request body or JSON content-type header, current CSRF token, updated count, removed record, last-record empty state, cancellation through Keep/Escape without writes, and focus restoration.
2. **Failures and recovery:** controlled 500/404 responses, network abort, unexpected `200` success response, real missing-record `404`, genuine stale-token `403` with explicit retry, and genuine revoked-session `401` followed by sign-in and selection restoration without automatic deletion. No failure reports deletion success.
3. **Pending and race protection:** held write shows Deleting and disables both controls; Escape and programmatic repeat submission cannot dismiss or duplicate it. A delayed pre-deletion directory response cannot restore the removed record.
4. **Responsive and accessible behavior:** desktop 1440×960, mobile 390×844, narrow 320×568 and short 390×400; long names/emails wrap without horizontal overflow; action buttons remain reachable by scrolling. Native dialog keyboard containment, initial Keep focus, cancellation/success focus, reduced-motion CSS, and empty browser storage are checked. No browser JavaScript errors occurred.

Every browser run uses a disposable administrator, an in-memory SQLite database and an isolated Express server on a dynamic loopback port. Development records, `.env`, authentication policy and database schemas were not modified. No application dependency was added.

## Re-run

```powershell
$env:BYTE_PLAYWRIGHT_MODULE = 'C:/Users/Philopateer.Zaki/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
npm test
$env:BYTE_SCREENSHOTS = 'docs/batch3'
node --test test/employee-deletion.test.js
```

On another workstation, use its existing Playwright `index.mjs` and installed Chrome. Without the module variable, optional browser suites explicitly skip. No extra install or development-data seeding is required.

## Screenshot evidence and limits

| State | Desktop | Mobile |
|---|---|---|
| Delete confirmation | [Dialog](delete-desktop.png) | [Sheet](delete-mobile.png) |
| Confirmed deletion | [Directory](deleted-desktop.png) | [Directory](deleted-mobile.png) |
| Failure retained | [Server failure](delete-failure-500.png) | [Server failure](delete-failure-mobile.png) |

Additional evidence: [missing record](delete-failure-404.png), [network failure](delete-failure-network.png), [unexpected response](delete-failure-unexpected.png), and [320 px long identity](delete-narrow.png). Samples, counts and names differ from Figma mock data.

Verification used desktop Chrome with resized viewports; physical phones, Safari/iOS and screen-reader output remain unverified. Deletion changes have not been deployed. Final polish and full-flow verification are reserved for Batch 4.
