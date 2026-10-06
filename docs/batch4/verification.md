# Batch 4 final frontend verification — 6 October 2026

## Result

The existing frontend scope is polished and verified against the real local Express backend. Desktop and mobile flows cover sign-in, list, create, edit, deletion cancellation, confirmed deletion, sign-out and unauthenticated access. Test servers run on dynamic loopback ports with disposable administrators and in-memory SQLite databases. Development records, credentials and `.env` were not opened or changed by browser verification. No deployment, dependency, API, authentication-policy, database or schema changes were made.

Reviewed AGENTS.md, screens.md, README.md, the entire frontend, the Express API/authentication flow and the verification reports/tests from Batches 1–3. Inspected connected Figma MCP design context and screenshots for **all 29 frames** in the [approved Figma file](https://www.figma.com/design/iod7P6nbE7SuZWxqV6mmFk). Screenshots were visually compared with the rendered browser screens; this was not an automated pixel-diff test.

## Changes and design decisions

1. **Visual consistency:** corrected desktop sign-in placement, mobile sign-in card/fields/copy, directory spacing, table columns and row sizing, compact mobile employee cards, avatar palette, account disclosure, empty/load-error panels, and amber rejected-request feedback. Reused local SVGs and downloaded the Figma empty-state symbol. Form input errors now occupy layout space instead of overlapping the next row or hint.
2. **Responsive behavior:** retained 666 px desktop add/edit dialogs, 620 px deletion confirmation, full-screen mobile forms with fixed bottom actions and the inset mobile deletion sheet. Desktop dialogs scroll within the available viewport; narrow/short screens wrap long identities. Viewport resize now scrolls the focused mobile input into view after applying the new height, preventing it from being covered by the footer.
3. **Keyboard and feedback:** Escape closes an open account disclosure without also closing the parent editor. Existing labels, modal focus containment/restoration, visible focus and reduced-motion behavior remain. Success notices are noninteractive and do not intercept pointer input; Refresh directory is below the list and aligned away from the desktop notice.
4. **Request correctness:** logout now requires its expected `204`, rejecting even an unexpected `200` with `{ data: null }`. DELETE already requires `204` and returns without parsing JSON. Added stale-authentication guards before/after asynchronous authentication requests, matched sign-in Unicode length validation, and retained rate-limit feedback for deletion. Successful saves still require a valid returned employee; failed saves/deletions retain context.

All mobile records remain scrollable rather than reproducing Figma's sample-only “+ N more employees” placeholder. Employee identity, dates and counts come from the backend. The existing Refresh directory recovery control remains below the list. Required email/context appears in deletion prompts; user drafts remain available after failures. Session expiry goes directly to sign-in with guidance and restores the draft/selection after authentication, following the already approved flow rather than introducing a separate intermediate page. Missing records stay in their originating prompt with a route back through Cancel/Keep employee. System-font fallback is retained when Inter is unavailable, as permitted by screens.md. Keyboard focus outlines are intentional accessibility states absent from the static mock.

## Checks run

- **`npm test` with existing Playwright enabled: 36 passed, 0 failed, 0 skipped.** Includes existing server checks, create/edit and deletion regression suites, and eight final browser scenarios plus their parent test.
- **`node --check`: all 18 JavaScript files in `public`, `src`, `scripts` and `test` pass.** No separate frontend build, lint or formatter check is configured.
- **Final browser suite alone: 9 passed, 0 failed, 0 skipped.** Captures the final screenshots below using installed Chrome; no package was added.

1. **Real local API flows:** unmocked desktop and mobile sign-in → list → create → edit → cancel deletion → delete → reload → sign-out. Asserted persisted changes, stable employee ID/creation date, API-confirmed feedback/counts, logout CSRF retrieval after reload, unchanged browser session deadline after token retrieval, HttpOnly/Strict cookie attributes, and `401` for protected reads/deletion after sign-out.
2. **Failure handling:** actual invalid credentials, duplicate email, missing employee, expired/revoked session and stale CSRF rejection/recovery. Controlled initial-load and refresh `500`, startup/network failure, malformed logout, unexpected deletion/save responses, and `400`/`403`/`404`/`413`/`415`/`429` feedback are covered across the suites. Failed refreshes retain records; failed writes retain values/context without success. Rate-limit feedback uses Retry-After.
3. **Pending and races:** held login/save/delete requests reject duplicate submissions; write dialogs cannot be dismissed while pending. Delayed pre-write directory responses cannot overwrite confirmed changes. Login/logout request continuations check the authentication version.
4. **Responsive/accessibility:** screenshots at 1440×960 and 390×844; checks at 320×568, 390×500, 768×1024 and 1024×768, plus deletion's 390×400 viewport. Verified wrapping/no horizontal overflow, native labels, initial/invalid-field focus, Tab/Shift+Tab confinement, Escape restoration, nested account Escape, visible outlines, fixed footer bounds, and a focused field remaining above the footer after viewport shrink. Reduced motion disables transitions and loading animation. All local static images load with expected intrinsic dimensions; desktop warning/empty symbols and mobile administrator geometry are also checked.
5. **Data/security boundaries:** browser tests use isolated data only. Browser storage remains empty, and the frontend contains no localStorage/sessionStorage writes. No browser JavaScript errors occurred. Backend security/database tests remain unchanged and passing.

The full test run exposed a timing-sensitive mobile resize/focus failure. The resize handler was corrected and the regression now verifies a field focused before the viewport shrinks; tests wait for the observable viewport height instead of assuming that the resize event has already run.

## Re-run and start the app

```powershell
$env:BYTE_PLAYWRIGHT_MODULE = 'C:/Users/Philopateer.Zaki/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
npm test
$env:BYTE_SCREENSHOTS = 'docs/batch4'
node --test test/frontend-flow.test.js
```

On another workstation, point BYTE_PLAYWRIGHT_MODULE to its existing Playwright index.mjs and use installed Chrome. Browser suites explicitly skip when the module variable is absent.

For the existing configured development app, run **`npm start`** and open **http://127.0.0.1:3000/**, or the exact APP_ORIGIN if configured differently. Sign in with the existing administrator credentials. There is no frontend build/server setup and no need to repeat administrator creation or seed development data. `npm run dev` enables automatic server restart. Verification servers/browser processes are closed in test cleanup.

## Screenshot evidence and remaining limits

| State | Desktop | Mobile |
|---|---|---|
| Sign-in / directory | [Sign-in](sign-in-desktop.png), [directory](directory-desktop.png) | [Sign-in](sign-in-mobile.png), [directory](directory-mobile.png) |
| Add/edit | [Add](add-desktop.png), [edit](edit-desktop.png) | [Add](add-mobile.png), [edit](edit-mobile.png) |
| Create/update feedback | [Added](created-desktop.png), [saved](saved-desktop.png) | [Added](created-mobile.png), [saved](saved-mobile.png) |
| Deletion | [Prompt](delete-desktop.png), [deleted](deleted-desktop.png) | [Sheet](delete-mobile.png), [deleted](deleted-mobile.png) |
| Empty/error/account | [Empty](empty-desktop.png), [load error](load-error-desktop.png), [account](account-desktop.png) | [Empty](empty-mobile.png), [load error](load-error-mobile.png), [account](account-mobile.png) |

Additional evidence: [invalid sign-in](invalid-sign-in-desktop.png), [session expiry](session-expired-desktop.png), [CSRF rejection](request-rejected-desktop.png), [duplicate email on desktop](duplicate-desktop.png)/[mobile](duplicate-mobile.png), and validation at [320 px](validation-320.png), [390 px](validation-390.png), [768 px](validation-768.png), [1024 px](validation-1024.png) and [1440 px](validation-1440.png).

Failure/recovery comparisons: save failure on [desktop](save-failure-desktop.png)/[mobile](save-failure-mobile.png), deletion failure on [desktop](delete-failure-desktop.png)/[mobile](delete-failure-mobile.png), [mobile CSRF rejection](request-rejected-mobile.png), and [mobile session expiry](session-expired-mobile.png).

Verification used installed desktop Chrome with resized viewports. Physical phone keyboards/safe areas, Safari/iOS, other browser engines and screen-reader output remain unverified. The local backend was tested with disposable data rather than the user's development administrator/database. Deployment and publication were outside this batch. No features beyond the existing scope were added.
