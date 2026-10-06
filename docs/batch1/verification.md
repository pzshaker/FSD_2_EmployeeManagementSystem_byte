# Batch 1 verification — 6 October 2026

## Automated checks

`npm test`: 7 passed, 0 failed. Existing database/authentication/CRUD checks still pass. The new frontend test checks `/`, `/login`, all static assets, unauthenticated API protection, unknown API JSON errors, and absence of Batch 2 routes. `node --check public/app.js` passes.

## Browser checks

Used the Codex in-app browser against an isolated Express server on port 3107 with an in-memory SQLite database, a disposable administrator, and seed records. The development database and credentials were never opened or changed. The test server was stopped after verification.

1. Real APIs: valid sign-in with a whitespace-sensitive password, invalid credentials, required-field validation, Show/Hide, session restoration after reload, and confirmed logout followed by an unauthenticated reload. Logout after reload obtains a fresh in-memory token from the existing endpoint.
2. Directory states: populated, successful empty result, five-second skeleton loading, initial failure/retry, refresh failure retaining records, and session-expiry guidance. Controlled responses provided these scenarios without modifying development records.
3. Errors: controlled 403, 413, 415, 429 with a 42-second Retry-After, failed logout, and failed startup followed by retry. A stopped test server verified actual network-failure feedback. Failed requests did not report success.
4. Responsive/accessibility: 1440 × 960 desktop and 390 × 844 mobile screenshots, table/card transformation, long text without horizontal overflow, safe text rendering of HTML-looking names, keyboard Enter menu opening, Escape focus restoration, and outside-click dismissal. Disabled CRUD controls are visible and described.
5. Assets: local sign-in orbit SVGs loaded at natural widths 270/174/16; the local administrator avatar loaded at 38 px. The reduced-motion media rule was inspected in the browser stylesheet; OS-level reduced-motion emulation and a screen-reader audit were not performed.

## Screenshots

- [Desktop directory](directory-desktop.png)
- [Mobile directory](directory-mobile.png)
- [Desktop sign-in](sign-in-desktop.png)
- [Mobile sign-in](sign-in-mobile.png)

## Known gaps

Add/edit/delete intentionally remain disabled for Batch 2. No employee detail routes, search, filtering, deployment, or submission were added. Fonts use the permitted system fallback when Inter is unavailable. Browser failure scenarios were checked manually; they are not a persistent automated browser suite. The authentication API and schema were unchanged; the only server addition serves the frontend.
